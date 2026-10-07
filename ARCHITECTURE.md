# 上岸助手 — 系统架构设计

> 版本 v0.1 · 2026-09-10
> 依据：`IMPLEMENTATION.md`（唯一需求与规则依据）、`demo.html`（视觉与交互基线）
> 本文只回答一个问题：**这套东西怎么切分、怎么长、怎么不烂**。业务规则的数值口径一律不在本文重述，以 IMPLEMENTATION.md 为准。

---

## 1. 架构目标与约束

先明确这套系统真正难的地方在哪，架构是为这些难点服务的：

| # | 难点 | 架构应对 |
|---|---|---|
| 1 | **计时不能靠定时器**：手机锁屏后 JS 被冻结，`setInterval` 累加必然走偏 | 计时状态机独立成 hook，只存「时间戳 + 分段累计」，剩余时间永远现算 |
| 2 | **日期口径必须唯一**：UTC 存储 + Asia/Shanghai 切日，两种口径混用必出错 | 时区换算收敛到一个模块，归属日期冗余落库，聚合只认冗余列 |
| 3 | **业务规则要能被反复验证**：XP 曲线、连续天数、12 枚徽章、三层时长线 | 规则全部写成**不碰数据库的纯函数**，可脱离环境单测 |
| 4 | **单用户但多设备**：手机计时中途电脑打开，数据不能打架 | 计时以服务端时间为准；写入幂等；乐观更新 + 服务端为准 |
| 5 | **要能长大**：今天不做重复任务规则、社交、月报，明天可能要做 | 设置走键值表、徽章走规则表、图表走隔离层、数据源走 Prisma provider |

**明确不做的事**（防止架构过度设计）：不做多租户、不做 CRDT、不做事件溯源、不引入状态管理库、不引入 GraphQL/tRPC、不上消息队列。单用户个人工具，任何为「规模」付的复杂度都是负债。

---

## 2. 分层结构

四层，依赖方向单向向下，**不允许反向依赖**：

```
┌──────────────────────────────────────────────────────────┐
│ L1 表现层  src/app/**/page.tsx · src/components/**        │
│    · 服务端组件负责「取数 + 鉴权」，客户端组件负责「交互」      │
│    · 不含业务规则，不含 SQL                                │
└───────────────────────────┬──────────────────────────────┘
                            │ 只通过 L2 的 API / L3 的 service 取数
┌───────────────────────────▼──────────────────────────────┐
│ L2 接口层  src/app/api/**/route.ts                        │
│    · 极薄：解析 → 校验(zod) → 调 service → 序列化          │
│    · 统一响应契约与错误码，统一会话守卫                      │
│    · 禁止在这里写业务判断（唯一例外：鉴权与参数合法性）        │
└───────────────────────────┬──────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────┐
│ L3 领域 + 服务  src/lib/domain/**  ·  src/lib/server/**    │
│    ┌──────────────────────┬──────────────────────────┐   │
│    │ domain/ 纯函数        │ server/ 有副作用          │   │
│    │ time level streak    │ db session settings      │   │
│    │ stats achievements   │ bootstrap backup         │   │
│    │ 无 IO · 可单测 · 可复用 │ 只有这里能碰 Prisma       │   │
│    └──────────────────────┴──────────────────────────┘   │
└───────────────────────────┬──────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────┐
│ L4 数据层  prisma/schema.prisma → SQLite                  │
└──────────────────────────────────────────────────────────┘
```

**这条依赖规则的价值**：`domain/` 里没有一个 `import { prisma }`。所以「连续 21 天该不该解锁徽章」「Lv5 需要多少 XP」这类问题可以用 20 行脚本在毫秒级验证，不需要起数据库、不需要起浏览器。这是整个架构里回报最高的一条约束。

### 目录地图

```
src/
├── app/
│   ├── layout.tsx                 根布局：主题、字体、Toast 容器
│   ├── globals.css                设计令牌（Tailwind v4 @theme）
│   ├── login/page.tsx
│   ├── onboarding/page.tsx        首次引导（设密码 → 考试日期 → 科目 → 目标）
│   ├── (app)/                     已登录壳：顶部倒计时条 + 底部导航 + 快捷键
│   │   ├── layout.tsx
│   │   ├── page.tsx               今日
│   │   ├── stats/page.tsx
│   │   ├── achievements/page.tsx
│   │   └── settings/page.tsx
│   └── api/                       见 §4
├── components/
│   ├── ui/                        Card Button Chip ProgressBar Modal Toast Sheet Segmented
│   ├── today/                     CountdownBadge GoalCard PomodoroCard RecordList ManualEntry
│   ├── stats/                     WeekChartCard HeatmapCard SubjectShareCard SubjectTotalCard
│   ├── report/                    ReportCard ReportDialog  ← 750×1000 导出
│   ├── achievements/              LevelCard BadgeWall UnlockToast
│   └── charts/                    ★ 图表隔离层（见 §6.2）
├── hooks/
│   ├── usePomodoro.ts             ★ 计时状态机（见 §5.1）
│   ├── useOutbox.ts               离线提交队列
│   ├── useWakeLock.ts             屏幕常亮
│   ├── useHotkeys.ts              空格 / N / 1-4
│   └── useAutoRefresh.ts          跨设备同步：回前台/可见时拉最新
└── lib/
    ├── domain/                    纯函数，零 IO
    ├── server/                    唯一能访问 Prisma 的地方
    ├── api-client.ts              浏览器侧 fetch 封装（统一错误、重试）
    └── types.ts                   前后端共享 DTO 与枚举
```

---

## 3. 数据模型与「日期三件套」

模型见 `prisma/schema.prisma`（严格对齐 IMPLEMENTATION.md §3）。这里只讲设计意图。

### 3.1 归属日期为什么冗余存储

每条 `FocusSession` / `CompletedItem` 都同时存两列：

- `startedAt` / `createdAt` —— UTC 时间戳，用于排序、算时长、显示具体时刻
- `localDate` —— `YYYY-MM-DD` 字符串，**按 Asia/Shanghai 算好的归属日期**

为什么冗余？因为「当日时长」「近 7 天」「连续天数」「热力图」这四类查询全都按归属日期聚合。如果每次都在 SQL 里做时区换算，会出现两个问题：一是 SQLite / Postgres 的时间函数行为不一致，迁移时要重写；二是 serverless 环境默认 UTC，一旦某处漏了换算就是静默错一天的数据污染。冗余一列字符串，代价是写入时多算一次，收益是**所有聚合都是无脑的 `GROUP BY localDate`**。

`FocusSession.localDate` 由服务端在写入时计算，**不信任客户端传来的日期**（客户端只传 `startedAt` 和时长）。

### 3.2 Setting 用键值表而不是宽表

设置项会一直加（周起始日、自动顺延开关、番茄钟参数、密码 hash、锁定计数……）。用 `key/value` 表 + JSON 值 + 代码侧默认值合并：

```ts
// lib/server/settings.ts
const DEFAULTS: AppSettings = { examDate: '2027-12-18', dailyGoalMinutes: 480, ... }
export async function getSettings(): Promise<AppSettings>          // DEFAULTS 兜底合并
export async function updateSettings(patch: Partial<AppSettings>)  // 只写 patch 的键
```

加一个设置项 = 在 `DEFAULTS` 加一行 + 在设置页加一个控件，**不动 schema、不写 migration**。这是刻意为「持续迭代」留的口子。

### 3.3 删除策略

| 对象 | 策略 | 原因 |
|---|---|---|
| 科目 | 软删除（`archivedAt`） | 历史统计不能出现「未知科目」 |
| 完成记录 | 物理删除 + 前端确认 | 记错了就该干净地消失 |
| 专注记录 | 物理删除 | 同上；自动备份兜底 |

---

## 4. 接口层契约

### 4.1 统一响应

```ts
type Ok<T>  = { ok: true;  data: T }
type Err    = { ok: false; error: { code: ErrorCode; message: string; details?: unknown } }
```

`ErrorCode`：`UNAUTHORIZED` `ONBOARDING_REQUIRED` `VALIDATION_FAILED` `NOT_FOUND` `RATE_LIMITED` `CONFLICT` `INTERNAL`。客户端只按 `code` 分支，不解析 message。

### 4.2 路由清单

完全按 IMPLEMENTATION.md §5 实现。要点补充：

- **鉴权在中间件 + 处理器双层**：中间件用 jose 验 JWT 签名（Edge 可用，不查库）做快速拦截与页面重定向；处理器内 `requireSession()` 做二次确认。中间件只是优化，不是安全边界。
- **幂等**：`POST /api/focus-sessions` 接受客户端生成的 `clientId`（UUID），落库时对 `(clientId)` 做唯一校验 —— 断网重连补交时不会重复入库。这是离线队列能安全重试的前提。
- **校验**：zod schema 定义在 `lib/schemas.ts`，路由和客户端共享同一份类型。
- **统计接口不新增**：`/api/stats/summary` 的 `range=all` 结果同时喂给「科目占比（全部）」与「科目总时长」，避免三份口径漂移（IMPLEMENTATION.md §4.6 已定）。

### 4.3 成就与等级：写在服务端的理由

`POST /api/focus-sessions` 成功落库后，服务端立即：

```
落库 → 取该用户最新统计快照 → domain/achievements.evaluate(ctx) → 新解锁的写入 Achievement 表 → 随响应返回
```

响应里带上 `unlocked: Achievement[]`，前端拿到就弹窗。放在服务端的理由：解锁状态是**持久事实**，不是视图状态。放前端会出现「两台设备各自弹一次」或「清缓存后丢失」。前端只负责表演。

---

## 5. 三个关键机制

### 5.1 计时状态机（`hooks/usePomodoro.ts`）

这是全项目最容易写错、也最值得写对的地方。

**内部状态**（全部是可序列化的数字/字符串）：

```ts
type Phase = 'idle' | 'running' | 'paused' | 'done'
type PomodoroState = {
  phase: Phase
  subjectId: number | null
  plannedSeconds: number
  accumulatedSeconds: number   // 已结算的分段合计
  segmentStartedAt: number | null  // 当前分段的起点（epoch ms），paused/idle 时为 null
  pausedSeconds: number
  startedAtIso: string | null  // 打开时间，提交时作为 startedAt
}
const elapsedSeconds = accumulated + (segmentStartedAt ? (Date.now() - segmentStartedAt)/1000 : 0)
```

**关键性质**：屏幕上显示什么，永远是 `f(now, state)` 的纯计算结果。所以：

- 锁屏 20 分钟 → 回前台 `Date.now()` 变了 → 一算就是对的，不需要「补跑定时器」
- 暂停 = `accumulated += now - segmentStartedAt; segmentStartedAt = null`
- 恢复 = `segmentStartedAt = now`
- 完成判定只要 `elapsedSeconds >= plannedSeconds`，在任何一次 tick / `visibilitychange` / 用户交互时都可能触发

**持久化**：整个 state 存 `localStorage`，页面刷新/误关不丢。恢复时如果 `phase === 'running'`，直接用现存时间戳继续算 —— 天然支持「断网续跑」。

**提交与离线**：`done` 或中断时构造 payload 交给 `useOutbox`。`useOutbox` 把待提交任务存 localStorage，`online` 事件或下次加载时重试，靠 `clientId` 保证幂等。番茄钟本身**不依赖网络**，这是 IMPLEMENTATION.md §7.5 的要求。

**提醒**：完成时读 `Notification.permission`，`granted` 且安全上下文才发通知，否则静默只弹页面 Modal —— 降级路径不报错、不提示「通知失败」。

### 5.2 时区与切日（`lib/domain/time.ts`）

零依赖，全部基于 `Intl.DateTimeFormat` 的 `timeZone: 'Asia/Shanghai'`：

```ts
localDateOf(d: Date): string          // → 'YYYY-MM-DD'，所有归属日期的唯一来源
todayLocalDate(): string
addDays(dateStr, n): string           // 纯字符串日期运算，避免 Date 的时区陷阱
eachDate(from, to): string[]
startOfWeek(dateStr, weekStart): string
rangeDatesFor(range): string[]        // '7d' | '30d' | 'week' | 'month' | 'all'
```

**纪律**：任何地方需要「今天是几号」，只允许调 `todayLocalDate()`。禁止 `new Date().toISOString().slice(0,10)`（那是 UTC 日期，晚上 8 点后在国内会错一天），禁止 `toLocaleDateString()` 直接参与逻辑。

### 5.3 连续打卡天数的口径（一处需要明确的设计决策）

需求文档定义了「当日 ≥1h 即算打卡」，但没定义**当天还没学够时，连续天数怎么显示**。直接实现「从今天往回数」会导致每天零点一过，连续天数归零，第二天学够 1h 才恢复 —— 数字每天跳一次变，既是 bug 观感也是激励灾难。

采用的规则：

> 从今天往回数连续达标天数；**若今天尚未达标，则从昨天开始数**（当天视为「宽限中」，不算断）。

这样 12 天就是稳定的 12 天，今天学够了就变 13，没学够到明天零点才变。规则落在 `domain/streak.ts` 并写进单测。热力图与成就判定同样复用这个函数，保证三处口径永不漂移。

---

## 6. 扩展点设计

架构的「可扩展」不体现在目录多漂亮，而体现在**加一个需求时要改几个文件**。

### 6.1 加一枚徽章 = 加一条数据

`domain/achievements.ts` 是表驱动的：

```ts
export const BADGES: BadgeDef[] = [
  { key: 'first_focus', name: '初来乍到', desc: '首次专注打卡', icon: '初',
    color: '#059669', test: c => c.totalSessions >= 1 },
  ...
]
export function evaluate(ctx): string[]  // 返回本次新解锁的 key
```

`ctx` 是一个**预聚合的统计快照**（累计分钟、每日分钟映射、单日峰值、科目数、当前/最长连续天数、2h 连续天数、首次开始时刻…），由 `server/` 侧一次性查出。加徽章只写一条 `test`，不碰查询、不碰 UI。徽章墙由 `BADGES` 自动渲染。

### 6.2 图表隔离层

4 个图表（周/月柱状、热力图、占比条、战报环形图）全部收敛在 `components/charts/`，对外只暴露数据接口：

```tsx
<StackedBarChart data={DayBucket[]} series={SeriesDef[]} onPickDay={...} />
<Heatmap data={HeatCell[]} levels={LevelDef[]} />
<ShareBars data={{label,value,color}[]} />
<Donut data={{label,value,color}[]} centerLabel={...} />
```

MVP 用**手写 SVG/CSS** 实现（对齐 demo 观感、零依赖、样式完全可控、SSR 友好）。若日后需要缩放/复杂交互，把 ECharts 塞进这个文件夹、保持同样的 props 即可，页面层零改动。**这是对 IMPLEMENTATION.md 技术选型的一处偏差，理由与回退路径见 §8 决策记录 D3。**

### 6.3 其他预留

| 需求 | 预留方式 | 改动面 |
|---|---|---|
| 重复任务规则（隔天/每周） | `Setting` 存规则数组，domain 加 `matchRule(rule, date)` | 1 个函数 + 1 个 UI |
| 部署到 Vercel | Prisma provider 换 postgres，`DATABASE_URL` 换 Neon | schema 1 行 |
| 月度报告 | `domain/stats.ts` 已有桶聚合，加 `range='month'` | 复用 |
| 多用户 | 现在所有 service 签名都带 `userId` 占位（当前恒为 `1`） | 加表 + 中间件 |

「service 函数签名预留 userId」成本几乎为零，但把「以后要多用户」从一个伤筋动骨的改造降级成加一层过滤条件。

### 6.4 数据安全

- 启动时 `bootstrap()`：确保预置科目存在、触发按自然天去重的自动备份（`backups/YYYY-MM-DD.json`，保留 30 份）。
- `GET /api/backup/export` 导出全量 JSON；`POST /api/backup/import` 全量覆盖（事务内先清后写 + 确认弹窗）。
- schema 变更一律走 Prisma migration。

---

## 7. 请求时序（两个代表性流程）

**A. 提交一个番茄钟（含成就解锁）**

```
PomodoroCard ──done──▶ useOutbox.enqueue(payload) ──▶ POST /api/focus-sessions
  ├─ 中间件：验 JWT ──▶ 401/放行
  ├─ route.ts：zod 校验 + requireSession()
  ├─ server/focus.ts：算 localDate(Asia/Shanghai) → 幂等判重(clientId) → 落库
  ├─ server/stats.ts：查统计快照
  ├─ domain/achievements.evaluate(snapshot) → 新解锁 keys → 写 Achievement
  └─ 响应 { data: { session, unlocked: [...] } }
        │
        ├─ 前端：Toast 提示已记录 + UnlockToast 逐枚弹窗（此时才动画）
        ├─ 前端：router.refresh() 拉最新服务端数据（目标进度/连续天数/等级）
        └─ 失败：留在 outbox，下次 online 重试（幂等保护）
```

**B. 打开统计页**

```
stats/page.tsx (Server Component)
  ├─ middleware 已验票
  ├─ Promise.all([ summary(range), heatmap(months), share(range) ])  ← 并行，服务端直连 service，无 HTTP 往返
  └─ 把纯数据交给客户端图表组件渲染
```
服务端组件直连 service（而非 fetch 自己的 API）是关键：少一次网络往返、少一次序列化，且类型端到端免费。

---

## 8. 决策记录

| # | 决策 | 理由 | 回退成本 |
|---|---|---|---|
| D1 | 业务规则全部纯函数化，`domain/` 禁止 import prisma | 可单测、可客户端复用、口径唯一 | — |
| D2 | 归属日期冗余成 `localDate` 字符串列 | 聚合无脑化，绕开跨库/跨环境时区陷阱 | 低 |
| D3 | 图表 MVP 手写 SVG，不用 ECharts | 4 个静态图表不值得 1MB 依赖 + SSR 适配成本；`components/charts/` 接口不变即可换回 | 低（隔离层已就位） |
| D4 | 设置走键值表 + 代码默认值，不做宽表 | 加设置项零 migration | 低 |
| D5 | 成就解锁判定放服务端 | 解锁是持久事实，非视图状态 | — |
| D6 | 番茄钟状态机独立成 hook，UI 只做渲染 | 计时正确性是第一风险点，必须与 UI 解耦才能单独验证 | — |
| D7 | 页面用服务端组件取数 + 客户端组件交互的混合模式 | 首屏无瀑布、交互不失灵活 | 中 |
| D8 | 连续天数「当天未达标则从昨天数」 | 避免零点跳变，保护激励效果 | — |
| D9 | service 签名预留 userId | 零成本降低未来多用户改造成本 | — |
| D10 | 登录锁定状态存 Setting 表而非内存 | 进程重启后锁定仍生效 | — |

---

## 9. 架构层面的验收标准

1. `domain/` 下任意文件可被 `scripts/selftest.ts` 直接 import 并断言，不连数据库。
2. 全局搜索 `toISOString().slice(0,10)` 结果为 0。
3. 全局搜索 `import { prisma }` 只出现在 `src/lib/server/` 内。
4. 新增一枚徽章只改 `domain/achievements.ts` 一个文件。
5. 新增一个设置项不产生 migration。
6. 手机锁屏 20 分钟后回前台，番茄钟剩余时间准确减少 20 分钟。
7. 未登录访问任意页面/接口得到重定向或 401，而非 500 或白屏。

---

**下一步**：按本设计实现 MVP（脚手架 → 数据层 → domain → API → 页面），验证结果记入交付说明。
