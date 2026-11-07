# AGENTS.md — 德州扑克网页版（poker-cc）

给接手本项目的 AI agent / 开发者的上下文。完整讨论记录见 `docs/context/2026-11-06-session.md`；原始方案见 `德州扑克网页版实施方案_v4.docx`；本阶段设计与计划见 `docs/superpowers/`。

## 项目是什么

家人朋友自用的德州扑克网页游戏：多人 / 单挑，可混入电脑玩家（初级 / 高级 × 五种风格），每手牌记录到数据库，大厅可回放，并对玩家本人的决策做「近似 GTO」复盘 + 大模型解说。界面中文，支持电脑和手机竖屏。

## 已确认的决策（不要推翻，除非用户明确要求）

- **部署**：香港 / 海外轻量服务器 + 域名 + Let's Encrypt（免 ICP 备案；PWA / Wake Lock 需要 HTTPS）。
- **单进程**：HTTP + WebSocket + AI 在同一个 Node 进程；**不用 Redis**。
- **数据库**：PostgreSQL，通过 **Drizzle**（不是 Prisma）。开发用 PGlite（npm 内置的 PostgreSQL，目录 `data/pglite`），上线用正式 PostgreSQL（`DATABASE_URL`）。
- **账号**：用户名 + 密码（argon2id）+ 一次性邀请码注册；显示名（牌桌上的名字）唯一。管理员只能用服务器命令创建。旧的昵称登录已删除。
- **复盘分析**：本地「近似 GTO」（翻前范围表 + 翻后对手范围推断 + 蒙特卡洛胜率 + EV 比较）给数字和判定，大模型（OpenAI 兼容接口：DeepSeek / 通义 / 智谱）只负责解说；不接求解器、不做 CFR。
- **AI**：初级（规则）+ 高级（范围表 + 胜率 + EV），五种风格预设：紧凶 tag、松凶 lag、岩石 nit、跟注站 station、疯子 maniac。顶级 AI 在阶段 4。

## 进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 规则引擎 + 属性测试 | 完成 |
| 2 | 单桌可玩闭环、匿名登录、初级 AI | 完成 |
| 2+ | 牌谱记录 / 回放、近似 GTO 复盘 + 大模型解说、AI 难度 × 风格、昵称登录、PostgreSQL | 完成（2026-11-06 合并到 main） |
| M1 | 账号与安全（注册 / 登录 / 改密码 / 邀请码 / 管理员页与命令 / 登录限流 / 令牌版本） | 完成 |
| M2 | 正式部署（Docker + Caddy + PostgreSQL + 备份；手册 `deploy/RUNBOOK.md`） | 代码完成，待在服务器上首次部署 |
| M3 | 自动分析 + 个人中心（红黄绿统计、趋势）+ 大模型水平评估 | 未开始 |
| M4 | 钱包 / 托管 / 自助补码 / 现金局规则 + 牌局可靠性 | 未开始 |
| M5 | Sit & Go 锦标赛 + 死按钮 + 大盲前注 | 未开始 |
| 房主 | 房主开始 / 暂停、增删座位、永久邀请码 | 完成 |
| 复盘+ | 个人复盘（「我的」页：统计 / 趋势 / 一键分析 / 整体评估）+ 管理页「玩家」统计 | 完成（feat/player-review，待合并） |

本轮总方案（M1–M5）见 `docs/superpowers/plans/2026-11-07-phase3-accounts-wallet-tournament-deploy.md`：顺序 M1→M2→M3→M4→M5，同时修掉上一轮 23 个暂缓小问题。顶级 AI、PWA 等仍在更后面的阶段。

## 代码结构（pnpm workspace）

| 路径 | 职责 |
|---|---|
| `packages/poker-core` | 纯函数引擎。一手牌 = `HandStarted`（含牌序）+ `Action[]`，`reduce` 可重放；`projectView(state, seat)` 是**唯一**对外视图投影（真人、观战、AI 同用，不含他人未亮底牌和牌序）；`buildReplayFrames` 生成回放帧；`log` / `PlayerView.history` 是公开动作日志 |
| `packages/strategy` | 起手牌类别与范围解析、位置、近似 GTO 翻前表、`equityVsRanges`、`inferRanges`、`scoreOptions` / `evaluateDecision` / `analyzeHand`；`summarizeDecisions` 汇总个人决策并做漏洞归类（`classifyLeak`）。纯计算无 IO |
| `packages/ai` | `getBot(level, style)`、`makeBeginnerBot` / `makeAdvancedBot`、`BOT_STYLES`、`simulate`、`collectStats`；`@poker/ai/styles` 子路径给前端用（不把 strategy 打进浏览器） |
| `apps/server` | Colyseus 0.18 只做房间 / 传输（**不用 Schema 共享状态**，每个客户端单独推送投影后的视图）；`TableActor` 每桌串行；`api/`（Express 路由，`mountApi(app, deps)` 依赖注入，可用内存库测试；`HttpError` + 统一错误处理）；`accounts/`（名字规则、注册登录、限流）；`db/`（Drizzle schema、PGlite / pg、迁移在 `drizzle/`）；`history/`、`analysis/`（含 `batch.ts` 一键分析后台队列）、`stats/`（时长、玩家统计、管理汇总）、`coach/`（整体评估）、`llm.ts`；`accounts/activity.ts`（登录 / 在线）；`cli.ts`（管理员命令） |
| `apps/web` | React 19 + Vite + Tailwind 4；`Felt` 牌桌组件（牌桌页和回放页共用）、`History`、`Replay`、`AnalysisPanel`、`BotPicker` |

主要接口：`POST /api/auth/register|login|password`，`GET /api/me`，`/api/admin/*`（邀请码、用户、重置密码；仅管理员），`GET/POST /api/tables`，`GET /api/hands`（游标分页 `before=<endedAt>|<handId>`），`GET /api/hands/:id`（回放帧，非参与者 403），`POST/GET /api/hands/:id/analysis`；个人复盘 `GET /api/me/stats?range=`、`GET /api/me/trend?days=`、`POST/GET /api/me/analyze-all`、`POST/GET /api/me/reports`；管理页玩家统计 `GET /api/admin/players`、`GET /api/admin/players/:id/reports`。

## 运行与测试

- Node 24（`pnpm env use --global 24`；Windows 上 pnpm 全局 bin `C:\Users\jiasu\AppData\Local\pnpm\bin` 需在 PATH，`pnpm setup` 后重开终端）。
- `pnpm install` · `pnpm test`（约 225 项）· `pnpm test:perf`（两个计时测试，机器空闲时跑）· `pnpm typecheck` · `pnpm sim:ai`（AI 验收，约 10 分钟）。
- 管理员命令：`pnpm --filter @poker/server admin create-admin <用户名> [显示名]` / `promote <用户名>` / `invite [数量] [有效天数]` / `invite-permanent <邀请码>` / `invite-revoke <邀请码>` / `reset-password <用户名>`（会打开 `PGLITE_DIR` 或 `DATABASE_URL` 指向的库，服务端在运行时用的是同一个库就会因目录锁被拒绝，先停服务或用 HTTP 管理页）。
- 生产：`deploy/`（Dockerfile、docker-compose.yml、Caddyfile、backup.sh、RUNBOOK.md）。服务端用 `pnpm --filter @poker/server build` 打成 `apps/server/dist/{index,cli}.js`，生产时同源托管前端（`WEB_DIR`），迁移目录 `MIGRATIONS_DIR`。
- 开发：`pnpm dev:server`（2567）+ `pnpm dev:web`（**5174，strictPort**），打开 http://localhost:5174 。
- 环境变量：`PORT`、`JWT_SECRET`（上线必设）、`DATABASE_URL`、`PGLITE_DIR`、`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_DAILY_LIMIT`、`LLM_BATCH_DAILY_LIMIT`（一键分析每人每日解说上限，默认 200）；前端 `VITE_SERVER_URL`。

### 端口与数据目录（本机常同时跑另一个项目 `D:\DSH\card`）

| 实例 | 服务端 | 前端 | 数据目录 |
|---|---|---|---|
| 用户手动（`pnpm dev:*`） | 2567 | 5174 | `data/pglite` |
| Agent 预览（`.claude/launch.json`） | 2575 | 5175 | `data/pglite-preview` |
| 另一项目 `D:\DSH\card` | 2568 / 8081 | 5173 | 它自己的目录 |

**PGlite 同一目录只能被一个进程打开**——两个进程同开会把库写坏（2026-11-06 发生过，坏库留在 `data/pglite-broken-2026-11-06`）。`createDb` 现在写 `.server.lock` 并拒绝第二个活进程。Agent **不要**用用户的 `data/pglite` 或端口 2567 / 5174；也不要停掉用户自己开的进程。

## 约定

- 先写测试再写实现（Vitest + fast-check），看到失败再改；修 bug 先写复现测试。
- 提交信息英文、祈使句；末尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`（由 Claude 提交时）。只在用户要求时提交 / 推送。
- 本机 git 未配置全局身份：提交时用 `git -c user.name=jiasu -c user.email=<用户邮箱> commit ...`。
- 文件在 Windows 上会被 git 转成 CRLF；脚本化替换前先统一换行。
- 隐私红线：牌序、他人未亮底牌绝不发给前端或大模型；所有对外数据都走 `projectView`。

## 实现中的关键取舍（详细理由见会话记录）

- 回放帧在发新街 / 全下发完时截断公共牌、隐藏结果，避免提前看到河牌。
- 加注 EV 的跟注后底池用 `pot + invest + (to - currentBet)`（规格文档原公式会重复计算已存在的下注）。
- 风格预设数值已按模拟调过（见 `packages/ai/src/styles.ts`），与规格文档初始表不同。
- 高级 AI 在无范围表的翻前局面（溜入池、4-bet+）用牌力 / 类别规则而非蒙特卡洛。
- 大模型步骤原子认领（双击只调用一次；失败 / 限额 / 卡住 60 秒可重试）；每日限额先扣后调用。
- 旧匿名 token（`anon-` 开头）一律拒绝，需重新登录。

## 已知但暂缓的问题

- 未配置大模型时分析过的牌，后加 Key 后没有补拿解说的按钮；无效分页游标返回第一页而非 400。（复盘登录过期跳转、名字规范化、建桌参数校验已在 M1 修复。）
- 复盘计算在服务端主线程（约 37 ms / 手）；关机时不等待未写完的牌谱。
- 无障碍细节（弹窗 Esc、tabpanel、aria-current）；预翻前全下的回放在跟注帧就显示亮牌。
- 计时测试已移出 `pnpm test`，改用 `pnpm test:perf`。
