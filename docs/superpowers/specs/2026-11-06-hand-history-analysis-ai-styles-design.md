# 牌谱记录、复盘分析与 AI 风格 — 设计文档

日期：2026-11-06
状态：待审阅
前置：阶段 1+2 已完成（引擎、初级 AI、单桌闭环、匿名登录），见 `德州扑克网页版实施方案_v4.docx`。

## 1. 目标

| 用户需求 | 本设计的交付 |
|---|---|
| 每手牌记录下来，回到大厅可回看 | PostgreSQL 存完整事件日志；大厅「我的牌谱」列表 + 逐步回放 |
| 按 GTO 分析操作是否合适 | 本地「近似 GTO」决策评估（数字和判定）+ 大模型解说 |
| 设置 AI 水平与风格 | 初级 / 高级两档 × 五种风格预设，每个电脑单独选 |

成功标准：

1. 打完一手牌后，它出现在该玩家的「我的牌谱」里，服务重启后仍在。
2. 回放可以逐步前进、后退、跳转，看到的内容与当时在牌桌上看到的一致：只有自己的底牌和当时亮出的牌。
3. 点「分析」后，本地分析在 3 秒内返回。你的每个决策点都有判定（合理 / 可以更好 / 失误）、估计亏损（bb）、建议操作和理由。配置了大模型时，随后补上解说。
4. 加电脑时可以选难度和风格。高级 AI 对初级 AI 在 6 人桌跑 2 万手，bb/100 显著为正（95% 置信区间不含 0）。

## 2. 已确认的决策

- 分析方案：范围表 + 范围胜率的「近似 GTO」，由大模型负责解说；不接求解器，不做 CFR。
- 存储：现在就接入 PostgreSQL。开发期用 PGlite（npm 依赖内置的 PostgreSQL，数据目录 `data/`），上线用正式 PostgreSQL。ORM 用 **Drizzle**，替代原方案中的 Prisma，因为 Drizzle 原生同时支持两者。
- 身份：昵称即身份（昵称唯一，同一昵称登录拿回同一个 playerId）。已知并接受：知道昵称就能登录成该人。正式账号仍留在阶段 3。
- 范围：牌谱只对参与者可见；复盘只分析本人的决策；观战的牌局不计入个人牌谱。
- 大模型：OpenAI 兼容接口（DeepSeek / 通义 / 智谱），Key 只放服务端；未配置时本地分析照常可用。
- 高级 AI 本次一起做（与分析共用 strategy 包）；顶级 AI 仍在阶段 4。

## 3. 架构总览

```
packages/poker-core   （已有）规则引擎、视图投影
packages/strategy     （新）范围表、对手范围推断、蒙特卡洛胜率、决策评估  —— 纯计算，无 IO
packages/ai           （扩展）风格参数；初级按风格缩放；新增高级 AI（依赖 strategy）
apps/server
  src/db/             （新）Drizzle schema、PGlite/pg 连接、迁移
  src/history/        （新）牌谱写入、列表、回放帧生成
  src/analysis/       （新）调用 strategy 做分析、调用大模型、缓存
  src/llm.ts          （新）OpenAI 兼容客户端
apps/web
  components/Felt     （从 TablePage 拆出）只读/可交互两用的牌桌画面
  components/History  （新）我的牌谱列表
  components/Replay   （新）回放 + 分析标注
  components/BotPicker（新）难度/风格选择框
```

## 4. 数据库（第 1 段）

### 4.1 连接

- `DATABASE_URL` 未设置：使用 PGlite，数据目录 `data/pglite`（加入 `.gitignore`）。
- `DATABASE_URL` 已设置：使用 `pg` 连接正式 PostgreSQL。
- 两者共用同一套 Drizzle schema 和迁移文件（`drizzle-kit generate` 生成，服务启动时自动执行迁移）。

### 4.2 表结构

`players`

| 列 | 类型 | 说明 |
|---|---|---|
| id | text PK | `p_<uuid>` |
| nickname | text unique | 去掉首尾空格后比较；大小写敏感 |
| created_at | timestamptz | |

`hands`

| 列 | 类型 | 说明 |
|---|---|---|
| id | text PK | 与引擎的 handId 相同（`<tableId>-<handNo>`） |
| table_id / table_name | text | |
| hand_no | int | |
| small_blind / big_blind / max_seats / button | int | |
| seats | jsonb | `[{seat, playerId, name, isBot, botLevel?, botStyle?, startStack}]` |
| events | jsonb | 完整 `HandEvent[]`，**含牌序**，只在服务端使用 |
| result | jsonb | `HandResult` |
| started_at / ended_at | timestamptz | |

`hand_players`（主键 hand_id + player_id；索引 player_id, ended_at desc）

| 列 | 类型 | 说明 |
|---|---|---|
| hand_id | text FK | |
| player_id | text | 真人是 players.id，电脑是 bot id |
| seat | int | |
| net | int | 本手净输赢 |
| ended_at | timestamptz | 冗余字段，供列表排序 |

`hand_analyses`（主键 hand_id + player_id）

| 列 | 类型 | 说明 |
|---|---|---|
| hand_id / player_id | text | |
| engine_version | int | 分析算法版本，升级后旧缓存失效 |
| decisions | jsonb | `DecisionReport[]`（见 6.4） |
| llm_text | text null | 大模型解说 |
| llm_status | text | `pending` / `ok` / `failed` / `disabled` / `limited` |
| created_at | timestamptz | |

`llm_usage`（主键 player_id + day）：`count int`，用于每日限额。

### 4.3 写入

- `TableActor` 已有 `onHandComplete(events, state)` 回调。`TableRoom` 在回调里调用 `history.saveHand(...)`，异步执行（不阻塞 actor 的串行队列）。失败时记录错误日志并重试 2 次，仍失败则丢弃该手（不影响牌局）。
- 座位快照（名字、是否电脑、难度、风格）在牌局开始时由 actor 记录，随回调一起传出。为此给 `onHandComplete` 增加一个 `seats` 参数。
- 电脑之间的牌局同样写入，用于以后检验 AI。

### 4.4 身份变更

- `POST /api/auth/anon` 改为 `POST /api/auth/nickname`：按昵称查找或创建 `players` 行，返回该行的 id 作为 playerId，并签发 JWT。旧的随机 playerId 逻辑删除。
- 同一昵称在两个设备同时登录，视为同一个人（与现在同一人开两个标签页的行为一致）。

## 5. 牌谱接口与回放（第 2 段）

### 5.1 接口（均需 `Authorization: Bearer <jwt>`）

- `GET /api/hands?before=<游标>&limit=20`（游标为 `"<ended_at ISO>|<hand_id>"`，响应带 `next`，避免结束时间相同的两手牌重复或遗漏） → `[{handId, tableName, endedAt, bigBlind, seat, holeCards, board, net, analyzed}]`。
  - `holeCards` 是请求者自己的底牌；`board` 是该手最终的公共牌。
- `GET /api/hands/:id` → `{ hand: {tableName, bigBlind, seats(名字/是否电脑/难度/风格)}, frames: ReplayFrame[] }`。
  - 请求者不是参与者时返回 403。
  - `ReplayFrame` 是 `start` / `action`（带公开动作日志条目）/ `street`（带新发的公共牌）三种之一，每种都带 `view`。服务端从 `events` 逐步重放，每个 Action 之后生成一帧；发新街时额外生成一帧；第 0 帧是发完底牌、下完盲注的状态。说明文字（如「电脑2号 加注到 60」「翻牌：K♠ 9♥ 5♣」）由前端按座位名生成。
  - 为此 `PlayerView` 增加公开的动作历史 `history`（谁在哪条街做了什么），高级 AI 也依赖它推断对手范围。
  - 每帧的 `view` 都是 `projectView(state, 请求者座位)`，与在牌桌上看到的一致。
- `POST /api/hands/:id/analysis` → 返回（或计算并缓存）分析结果，见第 6、7 节。

### 5.2 界面

- 大厅新增标签页：「牌桌」|「我的牌谱」。牌谱列表一次加载 20 条，滚动到底继续加载。
  - 每行显示：时间、牌桌名、我的底牌、公共牌、输赢（绿 / 红）、「已分析」标记。
- 回放页路由 `#/hand/<handId>`：
  - 复用拆出来的 `Felt` 组件，以只读方式渲染。
  - 播放控制：⏮ ◀ ▶/⏸ ▶ ⏭，自动播放每步间隔 1.2 秒。
  - 动作列表：桌面端在右侧，手机端在下方；点击跳到对应帧。
  - 分析标注：决策点前面显示 🟢 / 🟡 / 🔴，展开后显示数字、建议、理由和大模型解说。
- 牌桌页的结果条上加「在牌谱里查看」链接，跳到 `#/hand/<上一手 handId>`。

## 6. strategy 包：近似 GTO 分析（第 3 段）

### 6.1 ranges

- 169 个起手牌类别（`AA`、`AKs`、`AKo`…），范围 = `Map<类别, 权重 0..1>`；支持解析 `TT+, AQs+, A5s-A2s, KJo` 等写法。
- 内置近似 GTO 翻前表，按「桌型 × 位置 × 情境」组织：
  - 桌型：`hu`（2 人）、`6max`（3–6 人）、`9max`（7–9 人），按本手实际参与人数选择。
  - 位置：按本手人数从按钮推算（UTG、UTG+1、MP、LJ、HJ、CO、BTN、SB、BB）。
  - 情境：`rfi`（首个加注入池）；`vsOpen[开池位置]`（再加注 / 跟注）；`vs3bet`（再加注 / 跟注）。
- 表是根据公开的常见近似思路自行编写的，标注为「近似」，不搬用任何商业软件的数据。
- 未覆盖的情境（例如多次溜入池、面对四次加注）回退为「按胜率 + 底池赔率」评估，并在报告中注明。

### 6.2 rangeModel（对手范围推断）

- 翻前：按对手的动作查 6.1 的表。没有对应表时，用「溜入池范围」（中等宽度）。
- 翻后：先把对手范围内每个组合按「对当前公共牌的强度」分档：成牌强度百分位 + 是否有同花或顺子听牌。然后按动作调整权重：
  - 下注 / 加注：保留强度前 X% 和听牌，再留 Y% 的弱牌作诈唬（X、Y 随下注尺度变化）；
  - 跟注：强度在中段的权重最高，最弱和最强的降权；
  - 过牌：最强的 20% 降权到 0.3。
- 输出的仍是带权组合（考虑卡牌移除）。

### 6.3 equity

- 蒙特卡洛：主角手牌 vs 一个或多个带权范围，按权重抽对手组合，排除已知的牌，随机发完剩余公共牌。
- 默认 4000 次迭代；输入随机种子，结果可复现，便于测试。
- 直接在主线程运行，单个局面目标 < 10 ms。基准测试超过 20 ms 时，再改用 worker_threads（本次不做）。

### 6.4 evaluateDecision

输入：决策时刻的 `PlayerView`（主角视角）、各对手推断出的范围、主角实际采取的动作。
输出 `DecisionReport`：

```ts
{
  street, actionSeq,
  heroAction: PlayerAction,
  recommended: PlayerAction,           // 期望收益最高或范围表频率最高的动作
  options: { action, ev?: number, freq?: number }[], // ev 单位 bb；freq 是翻前表频率
  equity?: number, potOdds?: number, mdf?: number,
  evLossBb: number,                    // 最优选项 EV − 实际选项 EV，≥ 0
  verdict: 'good' | 'ok' | 'mistake',
  reasons: string[],                   // 2–3 条中文理由
  method: 'chart' | 'ev' | 'fallback'
}
```

- 翻前（method = chart）：查表得到 fold / call / raise 的频率。
  - 实际动作的频率 ≥ 0.3 → good；0.05–0.3 → ok；< 0.05 → mistake。
  - evLossBb 按偏离程度给经验值：ok 记 0.5，mistake 记 1.5，在报告里标为「估计」。
- 翻后，面对下注（method = ev）：
  - EV(fold) = 0；
  - EV(call) = 胜率 × (底池 + 跟注额) − 跟注额；
  - EV(raise) = 对手弃牌率 × 当前底池 + (1 − 对手弃牌率) × (对加注后跟注范围的胜率 × 最终底池 − 加注投入)。对手弃牌率由 6.2 的范围中「强度低于跟注门槛的组合权重」估计。
- 翻后，没人下注：比较过牌（EV ≈ 胜率 × 底池 × 实现率 0.9）与 ½、⅔、1 倍底池下注三种尺度。
- 判定：evLossBb < 0.5 → good；0.5–2 → ok；> 2 → mistake。
- 只分析主角的决策点；全下后不再有决策的街不评估。

### 6.5 局限（在界面上写明）

翻后部分不是求解器级别的精确结果：对手范围靠经验规则推断，下注尺度也只比较少数几档。界面标题写「近似 GTO 分析」，并在说明里注明。

## 7. 大模型解说（第 4 段）

- `src/llm.ts`：调用 `POST {LLM_BASE_URL}/chat/completions`，配置项 `LLM_API_KEY`、`LLM_MODEL`，超时 30 秒。
- 流程：`POST /api/hands/:id/analysis` 先计算并保存本地分析，立刻返回（`llm_status = pending`）；随后在后台调用大模型，完成后更新记录。前端每 2 秒轮询一次，最多轮询 40 秒，拿到解说后显示。
- 发送内容：主角的底牌、公共牌、每一步动作、亮出的牌，加上 `DecisionReport` 里的数字。**未亮出的对手底牌绝不发送。** 系统提示要求「基于给定数字解说，不得自行编造胜率或牌面」，回答使用中文，不超过 600 字。
- 返回内容：去掉 HTML 标签，截断到 2000 字。
- 限额：每个玩家每天最多 30 次（`LLM_DAILY_LIMIT`），超过后返回 `llm_status = limited`。
- 未配置 Key：`llm_status = disabled`，界面显示「未配置大模型，仅显示本地分析」。

## 8. AI 难度与风格（第 5 段）

### 8.1 风格参数

```ts
interface BotStyle {
  id: 'tag' | 'lag' | 'nit' | 'station' | 'maniac';
  looseness: number;   // 入池范围缩放，1 = 标准
  aggression: number;  // 加注 / 下注相对跟注的倾向
  bluff: number;       // 诈唬频率倍数
  stickiness: number;  // 面对下注时跟到底的倾向
  sizing: number;      // 下注尺度倍数
}
```

| 预设 | looseness | aggression | bluff | stickiness | sizing |
|---|---|---|---|---|---|
| 紧凶 TAG | 0.9 | 1.3 | 1.0 | 0.9 | 1.0 |
| 松凶 LAG | 1.4 | 1.5 | 1.4 | 1.0 | 1.1 |
| 岩石 | 0.6 | 0.7 | 0.3 | 0.7 | 0.9 |
| 跟注站 | 1.5 | 0.5 | 0.4 | 1.8 | 0.8 |
| 疯子 | 2.0 | 2.2 | 2.5 | 1.2 | 1.4 |

（数值是初始值，会在批量模拟中调整，让每种风格的 VPIP / PFR 落在对应风格的典型区间。）

### 8.2 两档实现

- `getBot(level, style)` 返回对应实例。
- 初级：现有 `beginnerBot` 的阈值和概率按风格参数缩放，新手毛病保留。
- 高级（新）：
  - 翻前用 6.1 的表，按 looseness 放宽或收紧，按 aggression 调整「再加注 / 跟注」的比例；
  - 翻后：用 6.2 推断对手范围，用 6.3 算胜率（1500 次迭代），用 6.4 的 EV 公式选动作；同等 EV 下按风格倾向选；诈唬频率和下注尺度由风格决定。
  - 只接收 `PlayerView`。
- 牌桌上的电脑名显示为「电脑3号 · 高级·松凶」，牌谱座位信息里记录难度和风格。

### 8.3 界面与协议

- `addBot` 消息增加 `{ level, style | 'random' }` 字段，服务端校验取值。
- 点「+ 电脑」弹出选择框：难度（初级 / 高级）和风格（五种预设 + 随机），默认「高级 · 随机」。
- 建桌表单增加「电脑难度」「电脑风格」两个选项，应用到初始电脑。

## 9. 测试

- strategy：
  - 范围解析（各种写法）、范围表合法性（权重在 0..1 之间、类别合法）；
  - equity 与已知数值对照：AA 对 KK 约 81–82%，AKs 对 QQ 约 46%，误差在 ±1.5% 以内；
  - 卡牌移除正确；
  - evaluateDecision 在构造局面上的判定：明显该弃的牌却跟注应判 mistake，坚果牌被下注时跟注或加注应判 good；
  - equity 的基准测试 < 10 ms。
- server：
  - PGlite 上的仓储测试：写入、列表分页、参与者权限（非参与者返回 403）；
  - 回放帧不泄露底牌（属性测试：对随机牌局的每一帧，检查只有请求者自己的底牌和亮出的牌）；
  - 分析接口的缓存行为；
  - 大模型客户端用假服务器测试超时、错误、限额。
- ai：每种风格跑 2 万手，统计 VPIP / PFR 落在目标区间；高级 AI 对初级 AI 的 bb/100 及 95% 置信区间。
- 浏览器验收：打几手 → 大厅看到牌谱 → 回放前进后退 → 分析（有 Key 和无 Key 两种情况）→ 加不同风格的电脑；手机竖屏下的回放页布局。

## 10. 不在本次范围

正式账号（用户名 + 密码 + 邀请码）、钱包与托管、锦标赛、顶级 AI、分析电脑的决策、牌谱筛选和搜索、导出 / 分享牌谱、worker_threads。
