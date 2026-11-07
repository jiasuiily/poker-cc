# 个人复盘（一键分析 + 整体评估）与管理员玩家统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 玩家在「我的」页一键补齐所有牌局的本地分析和大模型解说、生成与上次对比的整体评估；管理员在管理页看到每位玩家的在线、登录、手数、时长和复盘统计。

**Architecture:** 纯统计放在 `packages/strategy`（`summarizeDecisions`，无 IO）；服务端新增 `stats/`（时长、玩家统计、管理汇总）、`analysis/batch.ts`（进程内后台队列）、`coach/`（整体评估）、`accounts/activity.ts`（登录与在线）；单手分析拆成可复用的两步。前端新增「我的」标签和管理页「玩家」区，趋势图用纯 SVG。

**Tech Stack:** TypeScript、Vitest + fast-check、Drizzle（PGlite / PostgreSQL）、Express、Colyseus 0.18、React 19 + Tailwind 4。

**Spec:** `docs/superpowers/specs/2026-11-07-player-review-admin-stats-design.md`

## Global Constraints

- 批量解说每人每日上限 `LLM_BATCH_DAILY_LIMIT`，默认 200；单手点击解说仍为 `LLM_DAILY_LIMIT`（默认 30）；整体评估每人每日 3 次（`REPORT_DAILY_LIMIT = 3`）。
- 整体评估最少 30 个决策点（`MIN_REPORT_DECISIONS = 30`），不足返回 400「再多打几手（至少 30 个决策点）」，不调用大模型。
- 每日额度超出返回 429「今天的整体分析次数已用完」；未配置大模型返回 503「未配置大模型」。
- 整体评估 `pending` 超过 120 秒可重新生成；整体评估大模型超时 60 秒；输出经 `sanitizeLlmText` 截断到 4000 字。
- 在线 = 正连着牌桌，或 `last_seen_at` 在 5 分钟内；`last_seen_at` 同一用户 60 秒内最多写一次。
- 游戏时长：相邻两手间隔 < 15 分钟算同一段。
- 日期按 Asia/Shanghai；趋势默认最近 30 天。
- 不引入图表库；不加 Redis、不加新进程。
- 隐私：发给大模型的只有本人的决策和他当时看得到的信息；管理员不能看别人的回放 / 单手分析。
- 迁移用 `pnpm --filter @poker/server db:generate` 生成，手写的数据回填追加在同一文件末尾（`--> statement-breakpoint` 分隔）。
- 提交信息英文祈使句，末尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；本机提交用 `git -c user.name=jiasu -c user.email=jineven01@gmail.com commit`。只提交不推送，推送 / 部署等用户确认。
- 不碰用户的 `data/pglite`、端口 2567 / 5174；预览用 2575 / 5175 + `data/pglite-preview`（CLI 的 `PGLITE_DIR` 用绝对路径 `D:\claudecode\card\data\pglite-preview`）。

## Review Focus

1. **没有任何牌局的新玩家**：「我的」页不报错，显示 0；一键分析按钮禁用；生成整体分析返回 400 提示。→ Task 5、Task 6 测试。
2. **未配置大模型**：一键分析只做本地分析，进度 `reason: 'disabled'`；整体分析返回 503；页面显示提示而不是空白。→ Task 4、Task 6 测试。
3. **整体评估生成中服务重启**：`pending` 行卡住，120 秒后能重新生成，不会永远「生成中」。→ Task 6 测试。
4. **一键分析运行时，玩家又单独点了同一手的分析**：同一手只调用一次大模型。→ Task 4 测试。
5. **北京时间 23:30 打的牌**：趋势图算在当天，不算到前一天（UTC）。→ Task 5 测试。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `packages/strategy/src/summary.ts`（新） | `classifyLeak`、`summarizeDecisions`、`LEAK_NAMES` |
| `apps/server/src/db/schema.ts` + `drizzle/0003_*.sql` | `players` 三列、`coach_reports`、`llm_usage.kind` |
| `apps/server/src/accounts/activity.ts`（新） | 登录记录、`touchSeen` 节流、牌桌在线计数 |
| `apps/server/src/analysis/quota.ts`（新） | `takeQuota(db, playerId, kind, limit)` |
| `apps/server/src/analysis/service.ts`（改） | 拆出 `ensureLocalAnalysis` / `claimAndExplain` |
| `apps/server/src/analysis/batch.ts`（新） | `BatchRunner` |
| `apps/server/src/stats/sessions.ts`（新） | `playSessions` |
| `apps/server/src/stats/player.ts`（新） | `loadDecisionInputs`、`playerStats`、`playerTrend` |
| `apps/server/src/stats/admin.ts`（新） | `adminPlayers` |
| `apps/server/src/coach/prompt.ts`、`coach/service.ts`（新） | 整体评估提示词与流程 |
| `apps/server/src/api/me.ts`（新）、`api/admin.ts`（改）、`api/index.ts`（改） | 新接口 |
| `apps/web/src/components/me/{Me,TrendChart,BatchPanel,ReportsPanel}.tsx`（新） | 「我的」页 |
| `apps/web/src/components/AdminPlayers.tsx`（新） | 管理页「玩家」区 |

---

### Task 1: 决策统计与漏洞归类（strategy 纯函数）

**Files:**
- Create: `packages/strategy/src/summary.ts`
- Modify: `packages/strategy/src/index.ts`（`export * from './summary.js'`）
- Test: `packages/strategy/test/summary.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LeakKind = 'preflopLoose' | 'preflopTight' | 'callTooWide' | 'foldTooMuch' | 'passive' | 'aggressive' | 'sizing';
  export const LEAK_NAMES: Record<LeakKind, string>; // 翻前入池过松 / 翻前过紧 / 跟注过宽 / 弃牌过多 / 过于被动 / 过度激进 / 下注尺度
  export type DecisionStreet = 'preflop' | 'flop' | 'turn' | 'river';
  export interface DecisionInput { handId: string; endedAt: string; bigBlind: number; decisions: DecisionReport[] }
  export interface StatsExample { handId: string; street: DecisionStreet; actionSeq: number; heroAction: PlayerAction; recommended: PlayerAction; evLossBb: number; reasons: string[] }
  export interface PlayerStats {
    hands: number; decisions: number; good: number; ok: number; mistake: number;
    evLossPerHand: number;
    byStreet: Record<DecisionStreet, { decisions: number; mistakes: number }>;
    leaks: { kind: LeakKind; count: number; evLossBb: number }[]; // count > 0 only, sorted by evLossBb desc
    examples: StatsExample[]; // verdict !== 'good', top 5 by evLossBb desc
  }
  export function classifyLeak(d: DecisionReport): LeakKind | null;
  export function summarizeDecisions(hands: DecisionInput[]): PlayerStats;
  ```

- [ ] **Step 1: Write the failing tests** — 用一个 `dec(street, hero, rec, verdict, loss)` 工厂造 `DecisionReport`：
  - `classifyLeak`：`good` → `null`；翻前 call/raise vs fold → `preflopLoose`；翻前 fold vs call → `preflopTight`；翻后 call vs fold → `callTooWide`；翻后 fold vs raise → `foldTooMuch`；check vs raise → `passive`；call vs raise（翻后）→ `passive`；raise vs check → `aggressive`；raise to 60 vs raise to 30 → `sizing`。
  - `summarizeDecisions`：3 手（1 手无决策）共 5 个决策 → `hands 3, decisions 5`、各判定计数、`evLossPerHand = 总损失 / 3`、`byStreet.flop` 计数、`leaks` 按损失降序且不含 0 次、`examples` 最多 5 个且不含 `good`；空数组 → 全 0、`evLossPerHand 0`。
- [ ] **Step 2: Run** `pnpm --filter @poker/strategy exec vitest run test/summary.test.ts` — Expected: FAIL（模块不存在）。
- [ ] **Step 3: Implement** `summary.ts`。归类顺序：先判 `good` → null；翻前两类；同为 raise 且金额不同 → `sizing`；hero raise → `aggressive`；rec raise 且 hero 为 check/call → `passive`；翻后 hero call & rec fold → `callTooWide`；hero fold & rec ≠ fold → `foldTooMuch`；其余 null。
- [ ] **Step 4: Run** 同上 — Expected: PASS；`pnpm --filter @poker/strategy typecheck` 通过。
- [ ] **Step 5: Commit** `Add decision summary and leak classification`

---

### Task 2: 数据库变更与登录 / 在线记录

**Files:**
- Modify: `apps/server/src/db/schema.ts`、`apps/server/drizzle/`（生成 0003）
- Create: `apps/server/src/accounts/activity.ts`
- Modify: `apps/server/src/api/auth.ts`（登录 / 注册成功后 `recordLogin`）、`apps/server/src/api/middleware.ts`（`requireUser` 成功后 `touchSeen`，不 await，错误只记日志）、`apps/server/src/rooms/TableRoom.ts`（`onJoin` → `tableJoined` + `touchSeen`；`onLeave` → `tableLeft`）
- Test: `apps/server/test/activity.test.ts`、`apps/server/test/db.test.ts`（迁移后 `llm_usage` 旧行 `kind = 'hand'`）

**Interfaces:**
- Produces（schema）：`players.lastLoginAt / loginCount / lastSeenAt`；`coachReports` 表（`id, playerId, createdAt, status, stats jsonb, text`，部分唯一索引 `coach_reports_one_pending on (player_id) where status = 'pending'`）；`llmUsage.kind text not null default 'hand'`，主键 `(player_id, day, kind)`。
- Produces（activity.ts）：
  ```ts
  export async function recordLogin(db: Db, playerId: string): Promise<void>; // login_count+1, last_login_at=now, last_seen_at=now
  export async function touchSeen(db: Db, playerId: string, now?: number): Promise<void>; // 60 s in-memory throttle per player
  export function tableJoined(playerId: string): void;
  export function tableLeft(playerId: string): void;
  export function isAtTable(playerId: string): boolean;
  export const ONLINE_WINDOW_MS = 5 * 60_000;
  ```

- [ ] **Step 1: Write the failing tests**：注册后 `login_count = 1`；成功登录 → 2 且 `last_login_at` 更新；错误密码登录不变（走 `/api/auth/login`，用 `api.test.ts` 的 `start()` 方式）；`touchSeen` 同一用户 30 秒内第二次不写库、61 秒后写（传 `now`）；`tableJoined` 两次 + `tableLeft` 一次 → 仍 `isAtTable`，再 `tableLeft` → false。
- [ ] **Step 2: Run** `pnpm --filter @poker/server exec vitest run test/activity.test.ts` — Expected: FAIL。
- [ ] **Step 3: Implement** schema 变更 → `pnpm --filter @poker/server db:generate` → 检查生成的 SQL 对旧 `llm_usage` 行可执行（加列带默认值后再换主键）→ `activity.ts` → 三处接入。
- [ ] **Step 4: Run** `pnpm --filter @poker/server exec vitest run` — Expected: 全部 PASS（含旧测试）。
- [ ] **Step 5: Commit** `Record logins, last activity and table presence`

---

### Task 3: 拆分单手分析并按用途计额度

**Files:**
- Create: `apps/server/src/analysis/quota.ts`
- Modify: `apps/server/src/analysis/service.ts`、`apps/server/src/llm.ts`
- Test: `apps/server/test/analysis.test.ts`（原有测试必须不改断言地通过）、`apps/server/test/llm.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `llmUsage.kind`。
- Produces:
  ```ts
  // quota.ts
  export type UsageKind = 'hand' | 'batch' | 'report';
  export async function takeQuota(db: Db, playerId: string, kind: UsageKind, limit: number): Promise<boolean>;
  export async function usedToday(db: Db, playerId: string, kind: UsageKind): Promise<number>;
  // service.ts
  export async function ensureLocalAnalysis(db: Db, handId: string, playerId: string): Promise<'ok' | 'forbidden' | 'not_found'>;
  export async function claimAndExplain(
    db: Db, llm: LlmClient | null, handId: string, playerId: string,
    quota: { kind: UsageKind; limit: number }, timeoutMs?: number,
  ): Promise<{ outcome: 'started' | 'busy' | 'limited' | 'disabled'; job?: Promise<void> }>;
  // requestAnalysis 签名不变，内部调用上面两个（kind 'hand'）
  // llm.ts
  export function sanitizeLlmText(s: string, maxChars?: number): string; // default 2000
  // LlmClient.explain(system, user, signal, opts?: { maxTokens?: number; maxChars?: number })
  ```
  `busy` = 已是 `ok` 或新鲜的 `pending`（不重复调用）。

- [ ] **Step 1: Write the failing tests**：`takeQuota` 的 `hand` 与 `batch` 计数互不影响（hand 用满 30 后 batch 仍可用）；`claimAndExplain` 对已 `ok` 的手返回 `busy` 且不调用 llm；`llm === null` → `disabled`；`sanitizeLlmText('x'.repeat(5000), 4000)` 长度 4000。
- [ ] **Step 2: Run** `pnpm --filter @poker/server exec vitest run test/analysis.test.ts test/llm.test.ts` — Expected: 新测试 FAIL。
- [ ] **Step 3: Implement** 把 `requestAnalysis` 第 1 步移到 `ensureLocalAnalysis`、第 2 步移到 `claimAndExplain`；`takeQuota` 移到 `quota.ts` 并加 `kind`。
- [ ] **Step 4: Run** 同上 + 全量 server 测试 — Expected: PASS。
- [ ] **Step 5: Commit** `Split hand analysis into reusable steps with per-purpose quotas`

---

### Task 4: 一键分析后台队列与接口

**Files:**
- Create: `apps/server/src/analysis/batch.ts`、`apps/server/src/api/me.ts`
- Modify: `apps/server/src/api/index.ts`（`ApiDeps` 加 `llmBatchDailyLimit: number`；`mountApi` 里 `new BatchRunner(...)`；挂 `app.use('/api/me', meRoutes(deps, runner))`，放在现有 `meRoute` 之后）、`apps/server/src/index.ts`（读 `LLM_BATCH_DAILY_LIMIT`，默认 200）、`deploy/.env.example`（加该变量和注释）、`apps/server/test/api.test.ts` 与 `production.test.ts` 的 deps
- Test: `apps/server/test/batch.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `ensureLocalAnalysis`、`claimAndExplain`。
- Produces:
  ```ts
  export interface BatchProgress { running: boolean; hands: number; localDone: number; llmDone: number; llmQueued: number; llmSkipped: number; reason: 'limit' | 'disabled' | null }
  export class BatchRunner {
    constructor(opts: { db: () => Promise<Db>; llm: LlmClient | null; dailyLimit: number; timeoutMs?: number });
    start(playerId: string): Promise<BatchProgress>;   // already running → current progress
    progress(playerId: string): Promise<BatchProgress>; // counts from the DB + in-memory job state
    idle(playerId: string): Promise<void>;              // resolves when the job ends (tests)
  }
  ```
  路由：`POST /api/me/analyze-all` → `start`；`GET /api/me/analyze-all` → `progress`（都要登录）。
  解说顺序：按 `hand_players.ended_at` 从新到旧；每手之间 `await new Promise(setImmediate)`；一次一手，等上一手的 `job` 完成再下一手。

- [ ] **Step 1: Write the failing tests**（沿用 `analysis.test.ts` 的 `hand()` / `fakeLlm()` 造 4 手）：
  - 全新 → `idle` 后 4 手都有本地分析且 `llmDone 4`、`llm` 调用 4 次；再 `start` → 调用次数仍 4。
  - `dailyLimit 2` → `llmDone 2, llmSkipped 2, reason 'limit'`。
  - `llm null` → `localDone 4, llmDone 0, reason 'disabled'`。
  - 同一玩家连续两次 `start` 不 await → 只有一个任务（调用次数 = 手数）。
  - **Review Focus 4**：`start` 后立即对其中一手 `requestAnalysis`（kind hand）→ 该手 llm 只被调用 1 次。
  - 中断后续跑：第一个 runner 跑完 2 手后丢弃（用 `dailyLimit 2`），新 runner `dailyLimit` 足够 → 只再调用 2 次。
  - **Review Focus 1**：没有牌局的玩家 → `hands 0`，`running false`。
- [ ] **Step 2: Run** `pnpm --filter @poker/server exec vitest run test/batch.test.ts` — Expected: FAIL。
- [ ] **Step 3: Implement** `batch.ts`、`api/me.ts` 的两个路由、deps 接线。
- [ ] **Step 4: Run** 全量 server 测试 + `pnpm --filter @poker/server typecheck` — Expected: PASS。
- [ ] **Step 5: Commit** `Add one-click analysis of all hands as a background queue`

---

### Task 5: 玩家统计、趋势与游戏时长

**Files:**
- Create: `apps/server/src/stats/sessions.ts`、`apps/server/src/stats/player.ts`
- Modify: `apps/server/src/api/me.ts`（`GET /stats`、`GET /trend`）
- Test: `apps/server/test/stats.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `summarizeDecisions`、`DecisionInput`、`PlayerStats`。
- Produces:
  ```ts
  export function playSessions(hands: { startedAt: Date; endedAt: Date }[], gapMs?: number): { sessions: number; seconds: number }; // gap default 15 min
  export type StatsRange = '7d' | '30d' | 'all';
  export async function loadDecisionInputs(db: Db, playerId: string, sinceMs?: number): Promise<DecisionInput[]>;
  export async function playerStats(db: Db, playerId: string, range: StatsRange, now?: number): Promise<PlayerStats & { unanalyzed: number }>;
  export interface TrendDay { day: string; hands: number; good: number; ok: number; mistake: number } // day = YYYY-MM-DD Asia/Shanghai
  export async function playerTrend(db: Db, playerId: string, days: number, now?: number): Promise<TrendDay[]>; // only days with analyzed hands, ascending
  ```
  路由：`range` 不是三者之一 → 400；`days` 非 1–365 整数 → 400（默认 30）。

- [ ] **Step 1: Write the failing tests**：
  - `playSessions`：间隔 14 分钟 → 1 段；16 分钟 → 2 段；单手 → 时长 = 该手时长；空 → `{0, 0}`。
  - `playerStats`：存 3 手、分析 2 手 → `hands 2`、`unanalyzed 1`；`range '7d'` 排除 8 天前的手。
  - **Review Focus 5**：一手 `endedAt = 2026-11-07T15:30:00Z`（北京 23:30）→ `playerTrend` 的 `day` 为 `2026-11-07`；另一手 `2026-11-07T16:30:00Z` → `2026-11-08`。
  - **Review Focus 1**：无牌局玩家 → `hands 0, unanalyzed 0`，`trend []`。
  - 路由：`/api/me/stats?range=1y` → 400；未登录 → 401。
- [ ] **Step 2: Run** `pnpm --filter @poker/server exec vitest run test/stats.test.ts` — Expected: FAIL。
- [ ] **Step 3: Implement**（`hand_analyses` join `hand_players` join `hands` 取 `decisions`、`ended_at`、`big_blind`；聚合在 JS 里做）。
- [ ] **Step 4: Run** 同上 — Expected: PASS。
- [ ] **Step 5: Commit** `Add player stats, daily trend and play-time sessions`

---

### Task 6: 整体评估

**Files:**
- Create: `apps/server/src/coach/prompt.ts`、`apps/server/src/coach/service.ts`
- Modify: `apps/server/src/api/me.ts`（`POST /reports`、`GET /reports`）
- Test: `apps/server/test/coach.test.ts`

**Interfaces:**
- Consumes: Task 1 `summarizeDecisions`；Task 3 `takeQuota`、`ensureLocalAnalysis`；Task 5 `loadDecisionInputs`；`loadHandForPlayer`、`buildReplayFrames`。
- Produces:
  ```ts
  // prompt.ts
  export interface ExampleView { handId: string; street: DecisionStreet; heroCards: string[]; board: string[]; heroAction: string; recommended: string; evLossBb: number; reasons: string[] }
  export function describeExample(events: HandEvent[], heroSeat: number, d: StatsExample): ExampleView; // board cut at d.street, from hero-projected frames only
  export const COACH_SYSTEM_PROMPT: string; // 中文；整体水平一段、改进 3 点（各引用一个例子手 id）、有上次时写「与上次相比」
  export function buildCoachPrompt(stats: PlayerStats, examples: ExampleView[], previous: { stats: PlayerStats; text: string; createdAt: string } | null): { system: string; user: string };
  // service.ts
  export const REPORT_DAILY_LIMIT = 3, MIN_REPORT_DECISIONS = 30, STALE_REPORT_SECONDS = 120;
  export interface CoachReport { id: string; createdAt: string; status: 'pending' | 'ok' | 'failed'; stats: PlayerStats; text: string | null }
  export async function createReport(db: Db, llm: LlmClient | null, playerId: string, opts?: { timeoutMs?: number }): Promise<{ report: CoachReport; job: Promise<void> }>; // throws HttpError 400 / 429 / 503 / 409（已有新鲜 pending）
  export async function listReports(db: Db, playerId: string): Promise<CoachReport[]>; // newest first
  ```
  流程按 spec 5.3：补本地分析（不调大模型）→ 统计 → 不足 30 → 400 → 把超过 120 秒的 `pending` 标 `failed` → 插入 `pending`（唯一索引冲突 → 409「正在生成中」）→ `takeQuota('report', 3)` 失败 → 行标 `failed` 并 429 → 后台 `llm.explain(..., { maxTokens: 2000, maxChars: 4000 })`，超时 60 秒。`llm === null` 在插入前就 503。

- [ ] **Step 1: Write the failing tests**（造 ≥ 30 个决策点：用 `hand()` 存约 12 手）：
  - 决策点不足（2 手）→ 400，llm 未调用。
  - 正常 → 返回 `pending`；`await job` 后 `listReports[0]` 为 `ok` 且有 `text`、`stats.decisions ≥ 30`。
  - 第二份：llm 收到的 `user` 含第一份的 `text` 和「上次」统计数字。
  - 同一天第 4 次 → 429（前 3 次各自 await job）。
  - 双击（两次 `createReport` 不 await）→ 一个成功、一个 409；llm 调用 1 次。
  - **Review Focus 3**：手动插入一行 `pending`、`created_at = now - 121s` → `createReport` 成功；`created_at = now - 30s` → 409。
  - **Review Focus 2**：`llm null` → 503，不插入行。
  - 隐私属性测试（fast-check，随机 `startTable` 牌局 + 随机 hero 座位）：`buildCoachPrompt` 的输出不含任何未亮牌对手底牌的 `cardToString`（参照 `analysis.test.ts` 里单手提示词的同类测试写法）。
- [ ] **Step 2: Run** `pnpm --filter @poker/server exec vitest run test/coach.test.ts` — Expected: FAIL。
- [ ] **Step 3: Implement** `prompt.ts`、`service.ts`、两条路由。
- [ ] **Step 4: Run** 全量 server 测试 — Expected: PASS。
- [ ] **Step 5: Commit** `Add overall coaching reports compared with the previous report`

---

### Task 7: 管理员玩家统计接口

**Files:**
- Create: `apps/server/src/stats/admin.ts`
- Modify: `apps/server/src/api/admin.ts`（`GET /players`、`GET /players/:id/reports`）
- Test: `apps/server/test/adminStats.test.ts`

**Interfaces:**
- Consumes: Task 2 `isAtTable`、`ONLINE_WINDOW_MS`；Task 5 `playSessions`；Task 6 `listReports`。
- Produces:
  ```ts
  export interface AdminPlayerRow { id: string; displayName: string; username: string; online: boolean; lastSeenAt: string | null; lastLoginAt: string | null; loginCount: number; hands: number; playSeconds: number; analyzedHands: number; good: number; ok: number; mistake: number; evLossPerHand: number; reports: number }
  export async function adminPlayers(db: Db, now?: number): Promise<{ total: number; onlineNow: number; active7d: number; players: AdminPlayerRow[] }>; // players sorted by lastSeenAt desc, nulls last
  ```
  只列有用户名的账号；`hands` 来自 `hand_players`（不论是否分析）；`active7d` = `last_seen_at` 在 7 天内。

- [ ] **Step 1: Write the failing tests**：两名玩家、各存若干手（含间隔 > 15 分钟的两段）→ `hands`、`playSeconds`、`analyzedHands`、`loginCount` 与构造数据一致；`last_seen_at = now - 4 min` → `online true`，`now - 6 min` 且不在牌桌 → false，`tableJoined` 后 → true；非管理员访问 `/api/admin/players` → 403；`/api/admin/players/:id/reports` 返回该玩家评估。
- [ ] **Step 2: Run** `pnpm --filter @poker/server exec vitest run test/adminStats.test.ts` — Expected: FAIL。
- [ ] **Step 3: Implement**（每人一次查询取手的起止时间算时长；家庭规模不做分页）。
- [ ] **Step 4: Run** 全量 server 测试 — Expected: PASS。
- [ ] **Step 5: Commit** `Add admin player activity and review statistics`

---

### Task 8: 「我的」页

**Files:**
- Create: `apps/web/src/components/me/Me.tsx`、`me/TrendChart.tsx`、`me/BatchPanel.tsx`、`me/ReportsPanel.tsx`
- Modify: `apps/web/src/net/api.ts`（类型镜像 + `api.me.{stats,trend,analyzeAll,analyzeProgress,reports,createReport}`）、`apps/web/src/App.tsx`（`#/me` → lobby tab `'me'`）、`apps/web/src/components/Lobby.tsx`（第三个标签「我的」）

**Interfaces:**
- Consumes: Task 4–6 的接口与返回类型（前端镜像同名类型 `PlayerStats`、`TrendDay`、`BatchProgress`、`CoachReport`）。
- Produces: `Me({ session, onAuthExpired })`；`TrendChart({ days: TrendDay[] })` 纯 SVG（viewBox 自适应宽度，三条折线：绿 / 黄 / 红占比 0–100%，x 轴为有数据的日期，点击无交互）。

- [ ] **Step 1: Implement** 按 spec 6.3：范围切换 + 统计卡片（含 `LEAK_NAMES` 的中文名——前端自带同一张映射表，不引用 strategy 包）；趋势图；`BatchPanel`（按钮「一键分析（N 手待分析）」，N = `unanalyzed`，0 时禁用；运行中每 2 秒轮询，卸载时停止；`reason` 显示「今日解说额度已用完，明天继续」/「未配置大模型，只做了本地分析」）；`ReportsPanel`（「生成整体分析」，`pending` 时每 3 秒轮询；最新一份全文 + 与上一份的数字对照：失误率、平均 EV 损失、前 3 个漏洞次数；更早的折叠；400 / 429 / 503 的错误文案直接显示服务端消息）。
- [ ] **Step 2: Run** `pnpm --filter @poker/web typecheck` — Expected: PASS。
- [ ] **Step 3: Commit** `Add the 我的 tab: stats, trend, one-click analysis and overall reports`

---

### Task 9: 管理页「玩家」区

**Files:**
- Create: `apps/web/src/components/AdminPlayers.tsx`
- Modify: `apps/web/src/components/Admin.tsx`（在邀请码区上方插入）、`apps/web/src/net/api.ts`（`api.admin.players`、`api.admin.playerReports`、`AdminPlayerRow` 类型）

**Interfaces:**
- Consumes: Task 7 的接口。

- [ ] **Step 1: Implement**：汇总三数字（玩家数 / 在线 / 7 天活跃）；表格列：名字、在线点、最近活跃、最近登录、登录次数、手数、时长（`x 小时 y 分`）、已分析、红黄绿 %、平均 EV 损失、评估数；外层 `overflow-x-auto`；点击行展开该玩家评估（日期、关键数字、全文）。
- [ ] **Step 2: Run** `pnpm --filter @poker/web typecheck` — Expected: PASS。
- [ ] **Step 3: Commit** `Add the admin players section`

---

### Task 10: 端到端验收与文档

**Files:**
- Modify: `AGENTS.md`（进度表加一行「个人复盘 + 管理统计」；接口列表补 `/api/me/*`、`/api/admin/players*`；环境变量补 `LLM_BATCH_DAILY_LIMIT`）

- [ ] **Step 1: Run** `pnpm test` 与 `pnpm typecheck` — Expected: 全部通过。
- [ ] **Step 2: 预览验收**（`.claude/launch.json` 的 server + web；邀请码用 CLI 在 `D:\claudecode\card\data\pglite-preview` 生成）：注册 → 建 1 人 + 2 电脑的桌 → 开始 → 打约 15 手 → 「我的」页看到手数与未分析数 → 一键分析，进度走完（预览未配置大模型时应显示「未配置大模型，只做了本地分析」）→ 生成整体分析（未配置时显示 503 文案；决策不足时显示 400 文案）→ 用管理员账号看「玩家」区数字与「我的」页一致。手机尺寸（mobile 预设）下趋势图和表格可读。
- [ ] **Step 3: Commit** `Document player review and admin stats in AGENTS.md`
- [ ] **Step 4:** 向用户汇报，询问是否推送并部署（部署前先在服务器跑 `deploy/backup.sh`，并确认 `/api/tables` 没有进行中的牌桌）。
