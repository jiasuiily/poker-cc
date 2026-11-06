# poker-cc · 德州扑克网页版

家人朋友自用的德州扑克：多人 / 单挑、电脑玩家（初级 / 高级 × 五种风格）、牌谱回放与近似 GTO 复盘。

## 目录

| 路径 | 内容 |
|---|---|
| `packages/poker-core` | 纯函数规则引擎（事件溯源、边池、视图投影、回放帧） |
| `packages/strategy` | 范围表、对手范围推断、蒙特卡洛胜率、决策评估（复盘与高级 AI 共用） |
| `packages/ai` | 电脑玩家：初级 / 高级，风格预设，批量模拟 |
| `apps/server` | Colyseus + Express 服务端、PostgreSQL（Drizzle）、牌谱与分析接口 |
| `apps/web` | React + Tailwind 前端 |
| `docs/superpowers` | 设计文档与实施计划 |

## 本地运行

需要 Node 24（`pnpm env use --global 24`；第一次用还要执行一次 `pnpm setup` 并重开终端）。

```bash
pnpm install
```

两个终端分别启动服务端（端口 2567）和前端（Vite 默认端口 5173）：

```bash
pnpm dev:server
```

```bash
pnpm dev:web
```

浏览器打开 http://localhost:5173 。同一个昵称会进入同一个身份；牌谱存在 `data/pglite`，重启后仍在。

## 测试与模拟

```bash
pnpm test
```

```bash
pnpm typecheck
```

初级 AI 自对弈（默认 1 万手 6 人）：

```bash
pnpm sim
```

AI 验收：高级 vs 初级的 bb/100 与 95% 置信区间，以及各风格的 VPIP / PFR（默认 2 万手 + 每种风格 5000 手，约 10 分钟）：

```bash
pnpm sim:ai
```

## 环境变量（服务端）

| 变量 | 作用 | 默认 |
|---|---|---|
| `PORT` | 服务端端口 | `2567` |
| `JWT_SECRET` | 登录令牌密钥，**上线必须设置** | 开发用固定值 |
| `DATABASE_URL` | 设置后使用正式 PostgreSQL | 未设置时用 PGlite |
| `PGLITE_DIR` | PGlite 数据目录（一个目录同一时间只能被一个进程打开） | `data/pglite` |
| `LLM_BASE_URL` | OpenAI 兼容接口地址（DeepSeek / 通义 / 智谱） | `https://api.deepseek.com` |
| `LLM_API_KEY` | 大模型 Key；不设置时只显示本地分析 | 无 |
| `LLM_MODEL` | 模型名 | `deepseek-chat` |
| `LLM_DAILY_LIMIT` | 每人每天大模型解说次数 | `30` |

前端可用 `VITE_SERVER_URL` 指定服务端地址（默认同主机名的 2567 端口）。

## 复盘分析说明

「近似 GTO 分析」：翻前对照自写的近似范围表，翻后按对手动作推断范围、用蒙特卡洛胜率比较各选项期望收益，按估计亏损分为 🟢 合理（< 0.5bb）/ 🟡 可以更好（0.5–2bb）/ 🔴 失误（> 2bb）。翻后不是求解器级别的精确结果，仅供参考。大模型只拿到你这一手看得到的信息和本地算出的数字。
