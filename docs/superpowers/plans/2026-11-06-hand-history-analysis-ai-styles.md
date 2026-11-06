# 牌谱记录、复盘分析与 AI 风格 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把每手牌存进 PostgreSQL，在大厅回看；对玩家本人的决策做近似 GTO 分析并由大模型解说；电脑玩家支持初级 / 高级两档难度和五种风格。

**Architecture:**
- 新建纯计算包 `packages/strategy`（范围、位置、翻前表、胜率、对手范围推断、决策评估），复盘分析和高级 AI 共用。
- 服务端新增 `db / history / analysis / llm` 模块，开发期用 PGlite，上线用正式 PostgreSQL，都通过 Drizzle 访问。
- 回放帧由 `poker-core` 的纯函数按观看者视角生成。前端把牌桌画面拆成可复用的 `Felt` 组件，牌桌页和回放页共用。

**Tech Stack:** TypeScript, Node 24, pnpm workspace, Vitest + fast-check, Drizzle ORM + `@electric-sql/pglite` + `pg`, Colyseus 0.18, React 19 + Tailwind 4。

**Spec:** `docs/superpowers/specs/2026-11-06-hand-history-analysis-ai-styles-design.md`（执行者必须同时阅读）

## Global Constraints

- 未亮出的对手底牌、牌序（`events` 里的 `deck`）绝不发给前端或大模型；所有对外的画面都经过 `projectView`。
- 判定门槛：evLossBb < 0.5 → `good`；0.5–2 → `ok`；> 2 → `mistake`。翻前频率 ≥ 0.3 → `good`，0.05–0.3 → `ok`，< 0.05 → `mistake`；翻前 ok 记 0.5bb，mistake 记 1.5bb（「估计」）。
- 胜率默认 4000 次迭代（分析）/ 1500 次（高级 AI）；单个局面目标 < 10 ms。
- 大模型：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_DAILY_LIMIT`（默认 30）；超时 30 秒；回答 ≤ 600 字（提示词要求），存储截断到 2000 字并去掉 HTML。
- 数据库：未设置 `DATABASE_URL` 时用 PGlite，数据目录 `data/pglite`（加入 `.gitignore`）；分析缓存的 `ENGINE_VERSION = 1`。
- 昵称：去首尾空格，长度 1–16，大小写敏感，唯一。
- 界面文案用中文；分析面板标题写「近似 GTO 分析」。
- 每个任务完成都提交一次，提交信息末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 命令约定：`pnpm exec vitest run <path>` 跑单个测试，`pnpm test` 跑全部，`pnpm typecheck` 做类型检查。

## Review Focus

1. **早早弃牌的观看者回放到摊牌**：后面每一帧都不能出现任何对手的底牌，摊牌后也只能出现亮出的牌（Task 1 的属性测试）。
2. **昵称带空格或重复登录**：「小明 」和「小明」是同一人；空昵称、超过 16 字被拒绝；两个设备同时登录拿到同一个 playerId（Task 8 测试）。
3. **数据库写入失败或缓慢**：牌局照常继续，下一手正常开始；`onHandComplete` 回调抛异常不能打断 actor（Task 9 测试）。
4. **没有决策点的一手牌**：盲注后对手全部弃牌，或翻前全下后自动发完。分析返回空列表，界面显示「这手没有需要你决策的地方」（Task 5、Task 12 测试）。
5. **大模型异常**：超时、返回 HTML、500 错误、没配 Key、超出限额，都不影响本地分析，状态分别为 `failed` / `ok`（已清洗）/ `failed` / `disabled` / `limited`。发送给模型的提示词里不含未亮出的对手底牌（Task 10 测试）。

---

## 文件结构

```
packages/poker-core/src/
  types.ts            修改：HandState 增加 log；新增 ActionLogEntry
  hand.ts             修改：applyAction 追加日志
  view.ts             修改：PlayerView 增加 history
  replay.ts           新建：buildReplayFrames
packages/strategy/    新建包 @poker/strategy
  src/handClass.ts    169 类起手牌、组合展开
  src/range.ts        Range 类型与解析
  src/positions.ts    位置推算
  src/charts.ts       翻前近似 GTO 表与情境判定
  src/equity.ts       蒙特卡洛胜率
  src/rangeModel.ts   对手范围推断
  src/evaluate.ts     scoreOptions / evaluateDecision
  src/analyzeHand.ts  从事件日志提取主角决策并评估
  src/index.ts
packages/ai/src/
  styles.ts           新建：BotStyle 与五种预设
  beginner.ts         修改：makeBeginnerBot(style)
  advanced.ts         新建：makeAdvancedBot(style)
  stats.ts            新建：VPIP / PFR 统计
  index.ts            修改：getBot(level, styleId)
  simulate.ts         修改：返回每手净输赢
packages/ai/scripts/sim-ai.ts  新建：高级 vs 初级验收脚本
apps/server/src/
  db/schema.ts db/client.ts   新建
  players.ts                  新建：按昵称查找或创建
  auth.ts                     修改：昵称登录
  history/repo.ts             新建：saveHand / listHands / getHandForPlayer
  analysis/service.ts         新建：分析、缓存、后台解说
  analysis/prompt.ts          新建：提示词构造
  llm.ts                      新建：OpenAI 兼容客户端
  table/TableActor.ts         修改：座位快照、风格、回调容错
  rooms/TableRoom.ts          修改：addBot 参数、写牌谱
  index.ts                    修改：新接口
apps/server/drizzle/          drizzle-kit 生成的迁移
apps/web/src/
  components/Felt.tsx         新建（从 TablePage 拆出）
  components/BotPicker.tsx    新建
  components/History.tsx      新建
  components/Replay.tsx       新建
  components/AnalysisPanel.tsx 新建
  format.ts                   新建：动作 / 牌面的中文文案
  TablePage.tsx Lobby.tsx App.tsx net/api.ts  修改
```

---

### Task 1: 公开动作日志与回放帧（poker-core）

**Files:**
- Modify: `packages/poker-core/src/types.ts`、`hand.ts`、`view.ts`、`index.ts`
- Create: `packages/poker-core/src/replay.ts`
- Test: `packages/poker-core/test/replay.test.ts`，以及修改 `test/properties.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ActionLogEntry {
    seq: number; seat: number; street: 'preflop'|'flop'|'turn'|'river';
    kind: 'fold'|'check'|'call'|'bet'|'raise';
    to: number;        // 动作后该玩家本街的总投入
    allIn: boolean;
  }
  HandState.log: ActionLogEntry[]
  PlayerView.history: ActionLogEntry[]
  type ReplayFrame =
    | { kind: 'start'; view: PlayerView }
    | { kind: 'action'; entry: ActionLogEntry; view: PlayerView }
    | { kind: 'street'; street: 'flop'|'turn'|'river'; cards: Card[]; view: PlayerView };
  function buildReplayFrames(events: HandEvent[], viewerSeat: number | null): ReplayFrame[]
  ```
- `kind`：当 `currentBet === 0` 时的 raise 记为 `bet`。

- [ ] **Step 1: Write the failing tests** `replay.test.ts`：
  - `log records bet vs raise`：3 人局中 seat0 raise to 30 → `log[0]` 是 `{kind:'raise', to:30, street:'preflop'}`；进入翻牌后 seat1 下注 10，日志里是 `kind:'bet'`。
  - `frames: start + one per action + one per new street`：用 helpers 打一手直到河牌全过牌，帧序列的 kind 依次为 start、各 action，并且在 flop / turn / river 首次出现处各插入一个 street 帧（cards 长度分别是 3 / 1 / 1）。
  - `frames hide other hole cards`：`buildReplayFrames(events, 1)` 的每一帧里，seat≠1 的 `hole` 都是 null，直到最后一帧摊牌时才出现亮出的牌。
  - `spectator frames show no hole cards before showdown`：viewerSeat 为 null。
- [ ] **Step 2: Run** `pnpm exec vitest run packages/poker-core/test/replay.test.ts` — Expected: FAIL（`buildReplayFrames` 未定义）。
- [ ] **Step 3: Implement**
  - `applyAction` 在 `actionSeq++` 之前，按动作前的 `street` 追加一条日志；`startHand` 初始化 `log: []`；`projectView` 输出 `history: [...s.log]`。
  - `buildReplayFrames`：先 `startHand`，之后逐个 `applyAction`。每应用一个动作，先推一个 action 帧（用应用后的状态做投影）；如果 `board.length` 增加，再按新增的牌推 street 帧。全下后连续发完多条街时，每条街各推一帧，cards 从 board 中按 3/1/1 切出，三帧的 view 都使用最终状态。
- [ ] **Step 4: 修改 `properties.test.ts`**：增加属性 `replay frames never leak unshown hole cards`，对随机牌局、每个观看者（含 null），检查每一帧的 `view.seats` 只包含观看者自己的底牌，以及 `result.shown` 中的牌（仅最后一帧）。numRuns 500。
- [ ] **Step 5: Run** `pnpm exec vitest run packages/poker-core` — Expected: 全部 PASS（包括原有 24 项）。
- [ ] **Step 6: Commit** `feat(core): public action log and replay frames`

---

### Task 2: strategy 包 — 起手牌类别、范围解析、位置

**Files:**
- Create: `packages/strategy/package.json`（`@poker/strategy`，依赖 `@poker/core: workspace:*`，结构同 `packages/ai`）、`tsconfig.json`、`src/handClass.ts`、`src/range.ts`、`src/positions.ts`、`src/index.ts`
- Modify: `vitest.config.ts` 无需改（已包含 `packages/*/test`）
- Test: `packages/strategy/test/range.test.ts`、`test/positions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type HandClass = string;                       // 'AA' | 'AKs' | 'AKo' …
  const ALL_CLASSES: HandClass[];                // 169 个，按强弱大致排序无要求
  function handClassOf(a: Card, b: Card): HandClass;
  function combosOfClass(c: HandClass): [Card, Card][];   // 对子 6、同花 4、杂色 12
  type Range = Map<HandClass, number>;           // 权重 0..1，缺省 0
  function parseRange(s: string, weight?: number): Range;  // 'TT+, AQs+, A5s-A2s, KJo, 76s'
  function mergeRanges(...rs: Range[]): Range;   // 取 max
  function rangeCombos(r: Range, dead: Iterable<Card>): WeightedCombo[];
  interface WeightedCombo { cards: [Card, Card]; w: number }
  function rangeWidth(r: Range): number;          // 加权组合数 / 1326
  type Position = 'UTG'|'UTG1'|'MP'|'LJ'|'HJ'|'CO'|'BTN'|'SB'|'BB';
  type TableFormat = 'hu' | '6max' | '9max';
  function tableFormat(players: number): TableFormat;     // 2 → hu, 3–6 → 6max, 7–9 → 9max
  function positionsOf(view: Pick<PlayerView,'seats'|'button'|'sbSeat'|'bbSeat'>): Map<number, Position>;
  ```
- 位置规则：BB、SB 按 view 给出；其余从 BB 之后到按钮依次分配。按钮总是 BTN（单挑时按钮就是 SB，记为 `SB`，另一人为 `BB`）；从按钮往前依次是 CO、HJ、LJ、MP、UTG1、UTG，人数不足时从 UTG 一侧开始省略。例：6 人 = UTG, HJ, CO, BTN, SB, BB；9 人 = UTG, UTG1, MP, LJ, HJ, CO, BTN, SB, BB。

- [ ] **Step 1: Write the failing tests**
  - `ALL_CLASSES has 169 entries, combos total 1326`。
  - `handClassOf`：`As Ks` → `AKs`，`Kd As` → `AKo`，`7h 7c` → `77`。
  - `parseRange('TT+')` 含 TT、JJ、QQ、KK、AA，不含 99；`'A5s-A2s'` 恰好 4 类；`'KJo'` 只含杂色；`'AQs+'` 等于 AQs、AKs；非法字符串 `'ZZ'` 抛错。
  - `rangeCombos` 去掉死牌：`parseRange('AA')`，死牌 As → 3 个组合。
  - `positionsOf` 6 人与 9 人的映射（如上），单挑时按钮为 SB。
- [ ] **Step 2: Run** `pnpm exec vitest run packages/strategy` — FAIL。
- [ ] **Step 3: Implement** 上述函数。`pnpm install` 链接新包。
- [ ] **Step 4: Run** 同上 — PASS；`pnpm exec tsc -p packages/strategy --noEmit` 无错误。
- [ ] **Step 5: Commit** `feat(strategy): hand classes, range parsing, positions`

---

### Task 3: 翻前近似 GTO 表与情境判定

**Files:**
- Create: `packages/strategy/src/charts.ts`
- Test: `packages/strategy/test/charts.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `Range / parseRange / positionsOf / tableFormat`；Task 1 的 `PlayerView.history`。
- Produces:
  ```ts
  type PreflopSituation =
    | { kind: 'rfi'; pos: Position }
    | { kind: 'vsOpen'; pos: Position; opener: Position }
    | { kind: 'vs3bet'; pos: Position }
    | { kind: 'other' };                    // 溜入池、四次加注等：交给 fallback
  function preflopSituation(view: PlayerView, seat: number): PreflopSituation;
  interface ChartEntry { raise: Range; call: Range }   // fold = 1 − raise − call
  function chartFor(format: TableFormat, s: PreflopSituation): ChartEntry | null;
  function chartFreq(e: ChartEntry, cls: HandClass): { raise: number; call: number; fold: number };
  ```
- 数据由执行者编写成范围字符串，必须满足以下宽度（`rangeWidth(raise)`，±0.04）：
  - 6max rfi：UTG 0.17、HJ 0.21、CO 0.28、BTN 0.45、SB 0.40；
  - 9max rfi：UTG 0.11、UTG1 0.13、MP 0.15、LJ 0.18、HJ 0.22、CO 0.28、BTN 0.45、SB 0.40；
  - hu：SB（按钮）rfi 0.80；BB vsOpen 的 raise + call 合计 ≈ 0.75。
  - vsOpen 按开池者分组（早位 UTG/UTG1/MP、中位 LJ/HJ、后位 CO/BTN、SB），每组给出再加注范围和跟注范围；BB 的跟注范围比其他位置宽。vs3bet 每种桌型一张表（四次加注约 0.03，跟注约 0.08）。
  - 混合频率用 `parseRange(s, 0.5)` 加 `mergeRanges` 表达。

- [ ] **Step 1: Write the failing tests**
  - 每张表的宽度断言（上面的数值）；所有权重在 0..1 之间，且同一类别 raise + call ≤ 1。
  - `AA` 在每个 rfi 表中 raise = 1；`72o` 在 6max UTG 中 fold = 1。
  - `preflopSituation`：无人入池时轮到 CO → `{rfi, CO}`；UTG 开池后轮到 BTN → `{vsOpen, BTN, opener: UTG}`；主角开池、被再加注后轮到主角 → `{vs3bet}`；有人溜入池 → `{other}`。
- [ ] **Step 2: Run** `pnpm exec vitest run packages/strategy/test/charts.test.ts` — FAIL。
- [ ] **Step 3: Implement** `charts.ts`（数据 + 两个函数）。情境判定只看 `view.history` 中 street 为 preflop 的条目：raise 次数为 0 且没有 call → rfi；raise 1 次 → vsOpen；主角已加注且之后有人再加注 → vs3bet；其余 → other。
- [ ] **Step 4: Run** — PASS。
- [ ] **Step 5: Commit** `feat(strategy): approximate GTO preflop charts`

---

### Task 4: 蒙特卡洛胜率与对手范围推断

**Files:**
- Create: `packages/strategy/src/equity.ts`、`src/rangeModel.ts`
- Test: `packages/strategy/test/equity.test.ts`、`test/rangeModel.test.ts`

**Interfaces:**
- Consumes: Task 2、3；`@poker/core` 的 `evaluate / RandomInt / seededRandomInt`。
- Produces:
  ```ts
  function equityVsRanges(
    hero: [Card, Card], board: Card[], villains: WeightedCombo[][],
    opts?: { iterations?: number; randomInt?: RandomInt }   // 默认 4000、seededRandomInt(1)
  ): number;                                               // 0..1，平局按人数分摊
  type StrengthBucket = { combo: WeightedCombo; pct: number; draw: boolean };
  function bucketize(combos: WeightedCombo[], board: Card[]): StrengthBucket[];  // pct: 0=最弱 1=最强
  function inferRanges(view: PlayerView, heroSeat: number): Map<number, WeightedCombo[]>;
  ```
- `inferRanges`：对每个未弃牌的对手，用 Task 3 的表按他的翻前动作取范围（开池 → 对应位置 rfi.raise；跟注 → vsOpen.call；再加注 → vsOpen.raise；没有表 → 溜入池范围 `22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 64s+, 54s, A9o+, KTo+, QTo+, JTo`）。之后按每条街的动作调整：bet / raise 时，保留 pct ≥ 1 − X 以及 draw 为真的组合，其余组合乘以 Y（尺度 ≤ ½ 池：X=0.45、Y=0.25；½–1 池：X=0.35、Y=0.2；超过 1 池：X=0.25、Y=0.15）；call 时把 pct 在 0.3–0.85 的组合乘 1，其余乘 0.4；check 时把 pct > 0.8 的组合乘 0.3。去掉主角底牌和公共牌冲突的组合。
- 抽样：按权重累积分布二分查找，与已抽出的牌冲突时重抽，最多 20 次，仍失败则跳过该次迭代。

- [ ] **Step 1: Write the failing tests**
  - `AA vs KK preflop ≈ 0.82`（±0.015，iterations 20000）；`AKs vs QQ ≈ 0.46`（±0.015）；`AhKh on Qh Jh Th = 1`（同花顺坚果）。
  - `same seed → same result`。
  - `card removal`：主角 As Ad 对 `parseRange('AA')` 时，组合数为 1。
  - `perf: one spot < 10 ms`：AKo 对 2 个 30% 宽的范围、翻牌圈、4000 次迭代，计时取 5 次的中位数 < 10 ms（CI 环境放宽到 25 ms，用环境变量 `CI` 判断）。
  - `inferRanges`：UTG 开池的对手，翻前范围宽度 ≈ 表宽；他在翻牌圈满池下注后，范围里 pct > 0.75 的权重占比上升到 ≥ 0.6。
- [ ] **Step 2: Run** `pnpm exec vitest run packages/strategy` — FAIL。
- [ ] **Step 3: Implement** 两个文件。
- [ ] **Step 4: Run** — PASS。
- [ ] **Step 5: Commit** `feat(strategy): monte carlo equity and opponent range inference`

---

### Task 5: 决策评估与整手分析

**Files:**
- Create: `packages/strategy/src/evaluate.ts`、`src/analyzeHand.ts`
- Test: `packages/strategy/test/evaluate.test.ts`、`test/analyzeHand.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ActionLogEntry / buildReplayFrames` 所用的重放方式（直接 `startHand` + `applyAction`）；Task 3、4。
- Produces:
  ```ts
  interface OptionScore { action: PlayerAction; ev?: number; freq?: number }   // ev 单位 bb
  interface DecisionReport {
    street: Street; actionSeq: number;
    heroAction: PlayerAction; recommended: PlayerAction;
    options: OptionScore[];
    equity?: number; potOdds?: number; mdf?: number;
    evLossBb: number; verdict: 'good'|'ok'|'mistake';
    reasons: string[];                         // 2–3 条中文
    method: 'chart'|'ev'|'fallback';
  }
  function scoreOptions(view: PlayerView, ranges: Map<number, WeightedCombo[]>,
    opts: { iterations: number; randomInt: RandomInt }): { options: OptionScore[]; equity: number };
  function evaluateDecision(view: PlayerView, heroAction: PlayerAction,
    opts?: { iterations?: number; randomInt?: RandomInt }): DecisionReport;
  function analyzeHand(events: HandEvent[], heroSeat: number,
    opts?: { iterations?: number; seed?: number }): DecisionReport[];
  const ENGINE_VERSION = 1;
  ```
- 公式（照抄规格 6.4）：EV(fold)=0；EV(call)=eq×(pot+toCall)−toCall；EV(raise to R)=fe×pot+(1−fe)×(eq_call×(pot+2×(R−committed))−(R−committed))。fe 取对手范围中 pct 低于 `1 − 0.5×(R/pot)` 的权重占比。没人下注时，EV(check)=eq×pot×0.9，下注尺度比较 ½、⅔、1 倍底池。EV 以 chips 计算后除以大盲。
- 翻前：`chartFor` 能给出表时用 method = chart，否则 method = fallback（走 scoreOptions）。
- `potOdds = toCall / (pot + toCall)`；`mdf = pot / (pot + toCall)`，这里的 pot 指对手下注之前的底池。
- `reasons` 文案示例：「胜率 31%，高于底池赔率 25%，跟注有利」「这个位置的开池范围里没有 K7o」。
- `analyzeHand`：重放事件，对每个 seat === heroSeat 的 Action，在应用之前取 `projectView(state, heroSeat)`，交给 evaluateDecision。seed 固定，保证结果可复现。

- [ ] **Step 1: Write the failing tests**
  - `fold nuts facing bet is mistake`：构造河牌局面，主角坚果，面对满池下注，选择弃牌 → `verdict: 'mistake'`，`recommended.kind !== 'fold'`。
  - `call with 2% equity facing pot bet is mistake`。
  - `call with equity above pot odds is good`：胜率约 45%，面对 ½ 池下注（底池赔率 25%）。
  - `preflop: AA fold from UTG is mistake (method chart)`；`preflop: 72o fold from UTG is good`。
  - `evLossBb >= 0 and options include heroAction`。
  - `analyzeHand returns [] when hero only posted blind and everyone folded`；`returns [] after hero all-in preflop for later streets`（只有翻前那一个决策点）。
  - `deterministic`：同一事件日志调用两次，结果完全相同（deepEqual）。
- [ ] **Step 2: Run** `pnpm exec vitest run packages/strategy` — FAIL。
- [ ] **Step 3: Implement** 两个文件；在 `index.ts` 导出所有公共接口。
- [ ] **Step 4: Run** — PASS；`pnpm typecheck` 无错误。
- [ ] **Step 5: Commit** `feat(strategy): decision evaluation and hand analysis`

---

### Task 6: AI 风格与初级 AI 缩放

**Files:**
- Create: `packages/ai/src/styles.ts`、`src/stats.ts`
- Modify: `packages/ai/src/beginner.ts`、`src/index.ts`、`src/types.ts`、`src/simulate.ts`
- Test: `packages/ai/test/styles.test.ts`，修改 `test/beginner.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type StyleId = 'tag'|'lag'|'nit'|'station'|'maniac';
  interface BotStyle { id: StyleId; looseness: number; aggression: number; bluff: number; stickiness: number; sizing: number }
  const BOT_STYLES: Record<StyleId, BotStyle>;          // 数值照抄规格 8.1 表
  const STYLE_NAMES: Record<StyleId, string>;           // 紧凶 / 松凶 / 岩石 / 跟注站 / 疯子
  function randomStyle(rng: Rng): StyleId;
  function makeBeginnerBot(style: BotStyle): Bot;
  function getBot(level: BotLevel, style: StyleId): Bot;   // 实例按 level+style 缓存
  interface Bot { level: BotLevel; style: StyleId; decide(view, rng): PlayerAction }
  function collectStats(events: HandEvent[], into: Map<number, SeatStats>): void;
  interface SeatStats { hands: number; vpip: number; pfr: number }  // 计数
  // simulate: SimOptions.bots 不变；SimResult 增加 perHandNet: number[][]（[seat][hand]）
  ```
- 初级缩放：入池阈值 0.4 / 0.6 除以 looseness；加注概率乘 aggression（上限 0.95）；诈唬概率乘 bluff；面对下注时跟注概率乘 stickiness；下注尺度乘 sizing。保持 `beginnerBot = makeBeginnerBot(BOT_STYLES.tag)` 导出，兼容现有调用。

- [ ] **Step 1: Write the failing tests**
  - `BOT_STYLES` 五种预设的数值等于规格表。
  - `beginner VPIP ordering`：6 人同风格各自自对弈 3000 手，用 `collectStats` 统计 VPIP，要求 nit < tag < lag < maniac。
  - `getBot('beginner','station')` 返回 style 为 station 的实例。
  - 原有 `plays 5,000 hands…` 测试改用 `makeBeginnerBot(BOT_STYLES.lag)`，仍然通过。
- [ ] **Step 2: Run** `pnpm exec vitest run packages/ai` — FAIL。
- [ ] **Step 3: Implement**。
- [ ] **Step 4: Run** — PASS。
- [ ] **Step 5: Commit** `feat(ai): bot styles and style-scaled beginner bot`

---

### Task 7: 高级 AI 与验收脚本

**Files:**
- Create: `packages/ai/src/advanced.ts`、`packages/ai/scripts/sim-ai.ts`
- Modify: `packages/ai/package.json`（依赖 `@poker/strategy`）、`src/index.ts`、根目录 `package.json`（脚本 `"sim:ai": "tsx packages/ai/scripts/sim-ai.ts"`）
- Test: `packages/ai/test/advanced.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `chartFor / chartFreq / preflopSituation / positionsOf / tableFormat`；Task 4 的 `inferRanges`；Task 5 的 `scoreOptions`；Task 6 的 `BotStyle / Bot`。
- Produces: `function makeAdvancedBot(style: BotStyle): Bot`；`getBot('advanced', style)` 返回它。
- 决策：
  - 翻前：有表时，先把权重按风格调整：raise 乘 looseness×aggression，call 乘 looseness，再截断到 [0,1]。然后用 rng 按 raise / call / fold 频率抽样；加注尺度为开池 2.5bb、再加注 3 倍，再乘 sizing。没有表时走翻后逻辑。
  - 翻后：`scoreOptions`（iterations 1500）；在 EV 最高的选项和 EV 差距 < 0.3bb 的选项中，按风格倾向挑选（aggression 高的偏向加注，stickiness 高的偏向跟注）；以 `0.1 × bluff` 的概率把过牌改成 ½ 池下注。
  - 只能返回 `view.legal` 允许的动作，金额截断到合法区间。
- 验收脚本 `sim-ai.ts [hands=20000]`：6 人桌，座位 0–2 为高级 TAG，3–5 为初级 TAG，每手轮换按钮。输出各组的 bb/100 和 95% 置信区间（`mean ± 1.96 × sd / √n`，基于每手、每组的净输赢），以及每种风格单独 6 人自对弈 5000 手的 VPIP / PFR。

- [ ] **Step 1: Write the failing tests**
  - `advanced bot returns only legal actions over 1000 hands`（3 个高级 + 3 个初级，用 simulate 跑，引擎抛 IllegalActionError 即失败）。
  - `advanced folds 72o UTG and raises AA`（构造 PlayerView）。
  - `advanced calls with nut flush draw getting 4:1`（构造局面：胜率约 35%，底池赔率 20% → 不应弃牌）。
  - `decision time < 30 ms median`（翻牌圈局面，计时 10 次）。
- [ ] **Step 2: Run** `pnpm exec vitest run packages/ai/test/advanced.test.ts` — FAIL。
- [ ] **Step 3: Implement**。
- [ ] **Step 4: Run** — PASS。
- [ ] **Step 5: Run 验收** `pnpm sim:ai 20000` — Expected：高级组 bb/100 > 0，且 95% 置信区间下限 > 0。按需调整 `styles.ts` 的数值，使 VPIP / PFR 落在：TAG 18–28 / 14–24，LAG 28–40 / 22–34，岩石 8–16 / 5–12，跟注站 35–60 / 3–12，疯子 50–85 / 35–70。把最终输出贴进提交信息正文。
- [ ] **Step 6: Commit** `feat(ai): advanced bot using ranges and equity`

---

### Task 8: 数据库与昵称登录

**Files:**
- Create: `apps/server/src/db/schema.ts`、`src/db/client.ts`、`src/players.ts`、`apps/server/drizzle.config.ts`、迁移目录 `apps/server/drizzle/`
- Modify: `apps/server/package.json`（依赖 `drizzle-orm`、`@electric-sql/pglite`、`pg`；开发依赖 `drizzle-kit`、`@types/pg`；脚本 `"db:generate": "drizzle-kit generate"`）、`src/auth.ts`、`src/index.ts`、`.gitignore`（加 `data/`）
- Test: `apps/server/test/players.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // schema.ts：players, hands, handPlayers, handAnalyses, llmUsage —— 列名与类型照抄规格 4.2
  type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;
  function createDb(opts?: { url?: string; dataDir?: string; memory?: boolean }): Promise<Db>;  // 内部执行迁移
  function findOrCreatePlayer(db: Db, nickname: string): Promise<{ id: string; nickname: string }>;
  // auth.ts
  function issueToken(user: AuthUser): Promise<string>;           // 取代 issueAnonToken
  // index.ts：POST /api/auth/nickname {nickname} → {token, playerId, name}；删除 /api/auth/anon
  ```
- `hand_players` 的索引为 `(player_id, ended_at desc, hand_id desc)`。player id 格式为 `p_<uuid>`。
- 同一昵称并发创建：使用 `insert … on conflict (nickname) do nothing`，然后再查询一次。

- [ ] **Step 1: Write the failing tests**（`createDb({memory:true})`）
  - `same nickname returns same id`；`' 小明 '` 与 `'小明'` 是同一 id；`'小明'` 与 `'小明2'` 是不同 id。
  - `rejects empty and >16 chars`（由 `sanitizeName` 抛错）。
  - `concurrent creates resolve to one row`：`Promise.all` 同时调用 10 次，结果 id 全部相同，表里只有 1 行。
- [ ] **Step 2: Run** `pnpm exec vitest run apps/server/test/players.test.ts` — FAIL。
- [ ] **Step 3: Implement**；`pnpm --filter @poker/server db:generate` 生成迁移并提交。
- [ ] **Step 4: Run** — PASS；启动服务（`pnpm dev:server`），用 curl 调用 `POST /api/auth/nickname` 两次，返回同一个 playerId；`data/pglite` 目录被创建。
- [ ] **Step 5: Commit** `feat(server): database, players table, nickname login`

---

### Task 9: 牌谱写入、列表与回放接口

**Files:**
- Create: `apps/server/src/history/repo.ts`
- Modify: `apps/server/src/table/TableActor.ts`、`src/rooms/TableRoom.ts`、`src/index.ts`
- Test: `apps/server/test/history.test.ts`，修改 `test/tableActor.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `buildReplayFrames`；Task 6 的 `StyleId / randomStyle / getBot(level, style)`；Task 8 的 `Db`。
- Produces:
  ```ts
  interface SeatSnapshot { seat: number; playerId: string; name: string; isBot: boolean; botLevel?: BotLevel; botStyle?: StyleId; startStack: number }
  // ActorDeps.onHandComplete 签名改为：
  onHandComplete?: (rec: { events: HandEvent[]; state: HandState; seats: SeatSnapshot[]; tableName: string; startedAt: number; endedAt: number }) => void;
  // TableActor.addBot(seat: number, level?: BotLevel, style?: StyleId | 'random')   默认 'advanced', 'random'
  function saveHand(db: Db, rec: HandRecordInput): Promise<void>;     // 事务：hands + hand_players
  function listHands(db: Db, playerId: string, q: { before?: string; limit?: number }):
    Promise<{ items: HandListItem[]; next: string | null }>;          // before = "<endedAt ISO>|<handId>"
  interface HandListItem { handId: string; tableName: string; endedAt: string; bigBlind: number; seat: number; holeCards: Card[]; board: Card[]; net: number; analyzed: boolean }
  function getHandForPlayer(db: Db, handId: string, playerId: string):
    Promise<{ status: 'ok'; hand: HandMeta; frames: ReplayFrame[] } | { status: 'forbidden' } | { status: 'not_found' }>;
  interface HandMeta { handId: string; tableName: string; bigBlind: number; heroSeat: number; seats: Omit<SeatSnapshot,'startStack'>[] }
  ```
- 接口：`GET /api/hands?before=&limit=`（limit 默认 20，最大 50）；`GET /api/hands/:id` → 403 / 404 / 200。都通过 `Authorization` 头取得 playerId。
- 牌桌视图 `SeatView` 增加 `botLevel?`、`botStyle?`，供前端显示标签。

- [ ] **Step 1: Write the failing tests**
  - `tableActor`：`onHandComplete` 抛异常时，下一手仍然开始（`handNo` 继续增加）——actor 内部用 try/catch 包住回调并调用 `deps.log`。
  - `tableActor`：`addBot(2, 'beginner', 'nit')` 之后，快照的 `botLevel` / `botStyle` 正确；`'random'` 会解析为五种之一。
  - `history`：保存 3 手牌后，`listHands` 按时间倒序返回；limit=2 时 `next` 非空，用它翻到第二页拿到剩下 1 条；结束时间相同的两手牌不会重复也不会遗漏。
  - `history`：非参与者调用 `getHandForPlayer` 得到 `forbidden`；不存在的 id 得到 `not_found`；参与者拿到的帧中，其他座位的 `hole` 在摊牌前都为 null。
  - `history`：`HandListItem.holeCards` 是请求者自己的牌，`net` 等于最终筹码减起始筹码。
- [ ] **Step 2: Run** `pnpm exec vitest run apps/server` — FAIL。
- [ ] **Step 3: Implement**
  - `TableRoom.onCreate` 接收 `db`（通过 `gameServer.define('table', TableRoom, { db })` 传入的默认选项，或模块级单例 `getDb()`，二选一，推荐单例）；`onHandComplete` 调用 `saveHand(...).catch(...)`，失败重试 2 次。
  - 消息 `addBot` 增加 `{ level, style }` 并校验；建桌参数增加 `botLevel`、`botStyle`。
  - `TableActor` 的电脑回合改为 `getBot(o.botLevel, o.botStyle).decide(...)`；`Occupant` 增加 `botStyle`。
- [ ] **Step 4: Run** — PASS；`pnpm typecheck` 无错误。
- [ ] **Step 5: Commit** `feat(server): persist hands, history list and replay API`

---

### Task 10: 分析服务与大模型解说

**Files:**
- Create: `apps/server/src/llm.ts`、`src/analysis/prompt.ts`、`src/analysis/service.ts`
- Modify: `apps/server/src/index.ts`、`apps/server/package.json`（依赖 `@poker/strategy`）
- Test: `apps/server/test/llm.test.ts`、`test/analysis.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `analyzeHand / DecisionReport / ENGINE_VERSION`；Task 9 的 `getHandForPlayer` 所用的权限判定。
- Produces:
  ```ts
  interface LlmClient { explain(system: string, user: string, signal: AbortSignal): Promise<string> }
  function createLlmClient(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): LlmClient | null;  // 缺 Key → null
  function sanitizeLlmText(s: string): string;      // 去 HTML，截断 2000 字
  function buildPrompt(meta: HandMeta, frames: ReplayFrame[], decisions: DecisionReport[]): { system: string; user: string };
  type LlmStatus = 'pending'|'ok'|'failed'|'disabled'|'limited';
  interface AnalysisResponse { decisions: DecisionReport[]; llmStatus: LlmStatus; llmText: string | null }
  function requestAnalysis(db: Db, llm: LlmClient | null, handId: string, playerId: string, env: { dailyLimit: number }):
    Promise<{ status: 'ok'; analysis: AnalysisResponse } | { status: 'forbidden' } | { status: 'not_found' }>;
  function getAnalysis(db: Db, handId: string, playerId: string): Promise<AnalysisResponse | null>;
  ```
- 流程：已有缓存且 `engine_version` 一致时直接返回，否则计算本地分析并写入（`llm_status` 为 `pending` / `disabled` / `limited`）。处于 pending 时，后台调用大模型（30 秒超时，用 AbortController），完成后更新为 `ok` 或 `failed`。限额：在 `llm_usage` 中以 `(player_id, 当天日期 Asia/Shanghai)` 计数，超过 `dailyLimit` 返回 `limited`，不调用大模型。
- 接口：`POST /api/hands/:id/analysis`（触发并返回）、`GET /api/hands/:id/analysis`（轮询；没有分析过返回 404）。
- `buildPrompt` 只使用 `frames` 的最后一帧，以及每帧里已经投影过的信息，因此天然不含未亮出的底牌。system 文本固定为：「你是德州扑克教练。只依据给出的数据点评，不要编造胜率、范围或牌面。用中文，不超过 600 字，先总评再逐个决策点说明。」

- [ ] **Step 1: Write the failing tests**（用本地 `http.createServer` 起假的大模型服务）
  - `llm`：正常返回 → 文本；返回 `<b>好</b><script>x</script>` → 清洗为「好」；HTTP 500 → 抛错；延迟 31 秒 → 超时抛错（用 fake timers，或把超时参数化为 100ms 后测试）；env 没有 Key → `createLlmClient` 返回 null。
  - `analysis`：参与者第一次请求返回 decisions，且 `llmStatus` 为 pending；等后台完成后 `getAnalysis` 返回 ok 和文本；第二次请求不重复调用大模型（假服务器计数为 1）。
  - `analysis`：llm 为 null → `disabled`；第 31 次请求 → `limited`；大模型失败 → `failed`，decisions 仍然存在。
  - `analysis`：`buildPrompt` 的 user 文本不包含任何未亮出对手底牌的字符串（构造一手对手弃牌的牌局，断言 `cardToString` 后的两张牌都不出现）。
  - `analysis`：非参与者 → forbidden。
- [ ] **Step 2: Run** `pnpm exec vitest run apps/server` — FAIL。
- [ ] **Step 3: Implement**。
- [ ] **Step 4: Run** — PASS。
- [ ] **Step 5: Commit** `feat(server): hand analysis with LLM commentary`

---

### Task 11: 前端 — 拆出 Felt、电脑选择框、建桌选项

**Files:**
- Create: `apps/web/src/components/Felt.tsx`、`components/BotPicker.tsx`
- Modify: `apps/web/src/components/TablePage.tsx`、`components/Lobby.tsx`、`components/Login.tsx`、`net/api.ts`
- Test: 浏览器验收（项目暂无前端单测框架，本任务不引入）

**Interfaces:**
- Consumes: Task 8 的 `/api/auth/nickname`；Task 9 的 `SeatView.botLevel / botStyle` 和 `addBot {seat, level, style}`；Task 6 的 `STYLE_NAMES`（前端从 `@poker/ai` 只导入 `styles.ts`，保证不把 strategy 打进前端包，所以要从 `@poker/ai/styles` 子路径导入——在 `packages/ai/package.json` 中加 `"exports": {".": "./src/index.ts", "./styles": "./src/styles.ts"}`）。
- Produces:
  ```ts
  interface FeltSeat { seat: number; name: string; isBot: boolean; badge?: string; stack: number; sittingOut?: boolean; connected?: boolean }
  function Felt(props: {
    maxSeats: number; anchorSeat: number | null; seats: (FeltSeat | null)[]; hand: PlayerView | null;
    deadline?: number | null; timeoutMs?: number; clockOffset?: number;
    onSit?: (seat: number) => void; onAddBot?: (seat: number) => void; onRemoveBot?: (seat: number) => void;  // 不传 = 只读
  }): JSX.Element
  function BotPicker(props: { onPick: (level: BotLevel, style: StyleId | 'random') => void; onClose: () => void }): JSX.Element
  ```
- 座位徽标文案：「高级·松凶」。BotPicker 默认选「高级 · 随机」。建桌表单增加「电脑难度」「电脑风格」两组选择，默认与 BotPicker 相同。
- 登录改为调用 `/api/auth/nickname`，提示文字改为「同一昵称会进入同一个身份」。

- [ ] **Step 1: Implement** `Felt`（把 `TablePage` 里现有的 `Felt / EmptySeat / SeatBox / Countdown` 原样移入并改为上面的 props）与 `BotPicker`，再改造 `TablePage` 使用它们。
- [ ] **Step 2: Run** `pnpm typecheck` 与 `pnpm --filter @poker/web build` — 无错误。
- [ ] **Step 3: 浏览器验收**：启动 server 和 web；用昵称登录 → 建桌（初级 · 岩石，2 个电脑）→ 座位显示「初级·岩石」；点空座位的「+ 电脑」→ 选「高级 · 疯子」→ 座位显示对应标签；退出后用同一昵称重新登录，`playerId` 不变（在 localStorage 中查看）。
- [ ] **Step 4: Commit** `feat(web): reusable felt, bot picker, nickname login`

---

### Task 12: 前端 — 我的牌谱、回放、分析面板

**Files:**
- Create: `apps/web/src/components/History.tsx`、`components/Replay.tsx`、`components/AnalysisPanel.tsx`、`src/format.ts`
- Modify: `apps/web/src/App.tsx`（路由 `#/hand/<id>`）、`components/Lobby.tsx`（标签页）、`components/TablePage.tsx`（结果条链接）、`net/api.ts`

**Interfaces:**
- Consumes: Task 9 的 `GET /api/hands`、`GET /api/hands/:id`（`HandListItem / HandMeta / ReplayFrame`）；Task 10 的 `POST/GET /api/hands/:id/analysis`（`AnalysisResponse / DecisionReport`）；Task 11 的 `Felt`。
- Produces:
  ```ts
  // format.ts
  function cardText(c: Card): string;                                  // 'K♠'
  function actionText(e: ActionLogEntry, name: string): string;        // '电脑2号 加注到 60' / '小明 全下 300'
  function frameLabel(f: ReplayFrame, names: Map<number, string>): string;   // street 帧：'翻牌：K♠ 9♥ 5♣'
  function verdictMark(v: DecisionReport['verdict']): string;          // '🟢' | '🟡' | '🔴'
  ```
- 回放：自动播放每 1.2 秒一步；键盘左右方向键切换上一步 / 下一步。动作列表中，主角的决策帧（`frame.kind === 'action' && entry.seat === heroSeat`）与 `DecisionReport.actionSeq === entry.seq` 对应后标注。
- 分析面板：「近似 GTO 分析」标题下面注明「翻后基于对手范围推断，仅供参考」。点「分析这手牌」→ POST；`llmStatus` 为 pending 时每 2 秒 GET 一次，最多 40 秒；状态文案：disabled「未配置大模型，仅显示本地分析」，limited「今天的解说次数已用完」，failed「解说暂不可用」。decisions 为空时显示「这手没有需要你决策的地方」。
- 大厅：「牌桌」|「我的牌谱」两个标签页；列表滚动到底时用 `next` 继续加载。

- [ ] **Step 1: Implement** 以上组件。
- [ ] **Step 2: Run** `pnpm typecheck`、`pnpm --filter @poker/web build` — 无错误。
- [ ] **Step 3: 浏览器验收**（用 Claude_Browser，或手工）：
  - 打 3 手以上 → 大厅「我的牌谱」里能看到，输赢颜色正确；
  - 打开一手 → ◀ ▶ ⏮ ⏭、自动播放、方向键都可用；在动作列表中点击能跳转；对手的底牌只在摊牌帧出现；
  - 点「分析这手牌」→ 3 秒内显示判定；没配 Key 时显示 disabled 文案；设置假的 `LLM_BASE_URL` 指向本地 mock 时显示解说；
  - 选一手「盲注后大家都弃牌」的牌 → 显示「这手没有需要你决策的地方」；
  - 牌桌结果条的「在牌谱里查看」能打开刚结束的那手牌；
  - 手机竖屏（375×812）下回放页没有横向滚动，动作列表在下方。
- [ ] **Step 4: Commit** `feat(web): hand history, replay and analysis panel`

---

### Task 13: 全量验证

- [ ] **Step 1:** `pnpm test` — 全部 PASS（原有 32 项 + 新增）。
- [ ] **Step 2:** `pnpm typecheck` — 0 错误；`pnpm --filter @poker/web build` 成功。
- [ ] **Step 3:** `pnpm sim:ai 20000` — 高级组 bb/100 的 95% 置信区间下限 > 0；VPIP / PFR 落在 Task 7 的区间内。
- [ ] **Step 4:** 重启服务端后，之前的牌谱仍在（PGlite 持久化）。
- [ ] **Step 5:** 新建 `README.md`，写明本地运行步骤、`LLM_*` / `DATABASE_URL` 环境变量和 `pnpm sim:ai` 的用法。
- [ ] **Step 6: Commit** `docs: README for history, analysis and AI settings`
