# 性能审查报告 — 上岸助手

> 审查对象：`D:\graduate ast`（Next.js 15 + React 19 + Prisma 6 / SQLite）
> 审查视角：性能工程师（速度 / 内存占用 / 可扩展性）
> 日期：2026-09-10
> 状态：**方案已于 2026-09-11 全部落地并验证**，见 §0「实施记录」。
> 文中标注「⚠ 实测修正」的数字，是落地过程中用更忠实的量法测出来后替换掉的 —— 原值偏乐观。

---

## 零、实施记录（2026-09-11）

三批全部落地，**前端返回值与交互零改动**。以下是「改完之后实际量到的」，以及审查阶段测错的三个数字。

### 0.1 三处实测修正（重要：原报告的这三条偏乐观或说错了）

| 原报告说法 | 实际 | 为什么错了 |
|---|---|---|
| P0-2 写入 `2.301ms → 0.022ms`（**105×**） | 真 Prisma 路径 **2.832ms → 0.319ms（8.9×）** | 105× 是用 Python 裸 `sqlite3` 量的。真实写入路径经过 Prisma，每条语句有约 0.3ms 固定开销把比值稀释了。**8.9× 仍然很大**，但 105× 不是用户能感受到的倍数。见 `.workbuddy/verify-write.mjs` |
| §3.5「`busy_timeout` 未设置」 | **Prisma 默认就是 5000ms** | 我读的是 Python `sqlite3` 连接上的值，不是 Prisma 连接的。同理 `foreign_keys` 在 Prisma 下**默认已开**。这两条 PRAGMA 落地后只是显式化，不是收益来源 |
| §3.5「`synchronous = 2 (FULL)」 | 正确（Prisma 确实是 FULL） | 这条没问题，是真正的改动点 |

结论：**P0-2 的真实收益全部来自 WAL + `synchronous=NORMAL`**，`busy_timeout` / `foreign_keys` / `cache_size` 属于「写清楚意图」。这不改变结论，但改变了归因。

### 0.2 P0-1 落地后的实测（`.workbuddy/verify-equiv.ts`）

「打开一次统计页」= 壳层快照 + 柱状图 + 热力图 + 占比：

```
库中 102 行     5.1 ms →  2.8 ms      拉回   408 →     55 行
库中 3,102 行  94.2 ms → 18.0 ms      拉回 12408 →     74 行
库中 50,102 行 3059.6 → 155.4 ms      拉回 200408 →    85 行
```

**「拉回行数与记录数解耦」（200,408 → 85）比墙钟倍数更本质** —— 它意味着这条路径不再随备考年限变差。

### 0.3 P0-3 从「静态分析」升级为「实测」（`.workbuddy/render-probe.tsx`）

原来这条可信度最低（只有机制推断）。落地后用 jsdom 挂载真实的 Provider 链
（Toast > Today > Unlock > Pomodoro），真的开始一次专注，数两个消费者各自重渲染几次：

```
观察窗口 6.2s，番茄钟相位 = running

  消费者                 重渲染次数   每秒
  usePomodoroActions()          1     0.16     ← 应用外壳订阅的就是它
  usePomodoroCtx()              8     1.29     ← 番茄钟卡片订阅的就是它

  CtxKind 相邻渲染间隔(ms)：1006, 1011, 1012, 1004, 1014, 1006   ← 恰好等于 TICK_MS
```

- **外壳**：6.2 秒内只重渲染 1 次（那次还是「空闲→计时」的相位切换），不再是 4 次/秒。
- **卡片**：间隔实测 1006ms，即每个心跳一次；旧的 `TICK_MS=250` 会是 4 次/秒 → **−75%**，与预测一致。
- 顺带证实了 context 拆分的机制：`actions` 只在相位切换时换引用，心跳完全不碰它。

### 0.4 等价性护栏（48 项断言，三种数据规模全过）

统计链路是从「整表物化 + JS 聚合」换成「SQL 聚合」的，**口径漂移会让页面数字静默错掉**。
所以做了两道护栏：

1. **`scripts/selftest.ts` 新增 20 项交叉断言**（146 项总数）：同一条数据分别喂给
   「原始行版」与「聚合入表版」，断言 `stackedByDay` / `subjectTotals` / `buildSnapshot`
   三条路径的输出**逐字相同**，含区间外行的丢弃、空区间图例兜底、已删除科目兜底名。
2. **`.workbuddy/verify-equiv.ts`**：把改造前的 statsService 逻辑与改造后的并排实现，
   对真实库跑 `summaryData ×5 档 / heatmapData ×2 档 / shareData ×3 档 / getSnapshot`，
   深比较完整返回值。**真库 / 3102 行 / 50102 行三种规模，16 项 × 3 = 48 项全过。**

三种规模里包含了两个刻意的边界：50102 行那份数据里有**不存在的科目 id**（验「已删除科目」兜底）
和**未来日期**（验 `all` 档的区间收敛）。

### 0.5 一处「语义无关但确实变了」的行为

`points[].values` 这个字典的**键插入顺序**变了：旧实现取决于「当天记录的写入次序」，
新实现取决于 SQL `GROUP BY` 的输出次序。已确认不会影响任何渲染 —— 全项目对 `values`
的唯一访问是 `values[s.key]` 按键取值（`charts/index.tsx:36/96/193/281/379`），
唯一按序遍历的地方走的是 `series` 数组而不是它的键。验证脚本因此对该字典做键归一化，
并**单独断言「键集合与逐键取值完全相同」**，不掩盖真差异。

另有一处极小改动：`subjectTotalsFromSums` 在同分时按 `subjectId` 升序定序
（旧实现依赖 Map 插入序）。只影响并列项的先后，数值不变。

### 0.6 顺带发现的第 5 处死代码

`getSnapshot` 原本 `Promise.all([listAllSessionLikes(), listSubjectLikes()])` —— 而后者的结果
**从未被使用**：`buildSnapshot(sessions, subjects, today)` 的 `subjects` 形参在函数体里一次都没出现。
即每次取快照都白查一次科目表。改造后该查询直接消失。

---

## 一、结论摘要（审查时点的判断，具体数字见 §0 的实测修正）

按「影响 × 落地成本」排序。前三条是真正的瓶颈，其余是卫生问题。

| # | 问题 | 量级 | 类型 | 证据 |
|---|---|---|---|---|
| **P0-1** | 统计链路把整张 `FocusSession` 物化 4 次，再在 JS 里 reduce | 打开统计页 拉回内存行数 **−92%**；落地后实测见 §0.2 | 速度 / 内存 / 可扩展性 | 实测，`.workbuddy/perf-db.mjs` + §0.2 |
| **P0-2** | SQLite 未开 WAL、`synchronous=FULL` | 每次落库 **2.832ms → 0.319ms（8.9×）** ⚠ 原写 105×，见 §0.1 | 速度 / 并发 | 实测，`.workbuddy/verify-write.mjs` |
| **P0-3** | 番茄钟心跳 250ms + controller 对象每次新建 → 整个应用外壳 4Hz 重渲染 | 外壳 **4 次/秒 → 6.2 秒内 1 次**；卡片 −75% | 速度 / 内存 | **已实测**，`.workbuddy/render-probe.tsx` + §0.3 |
| **P1-1** | `stackedByDay` 用 `dates.includes()` 做区间筛选，O(N×M) | N=30000 时 **2.43ms → 0.59ms**（4.1×） | 速度 | 实测，`.workbuddy/perf-bench.mjs` |
| **P1-2** | 同一请求内重复取 settings / 重复 `getSnapshot` | 统计页 SQL 往返 **15 → 10 次** | 速度 | 实测 |
| **P1-3** | 热力图每次 hover 重渲染全部格子（最长可到 1000+ 个） | hover 帧内 DOM 比对 O(格子数) | 速度 | 静态分析 |
| **P1-4** | `StudyCalendar` 的 `useMemo` 依赖 `pickedDate`，点一格重算整个日历模型 | 每次点击全量重算 | 速度（低） | 静态分析 |
| **P2** | 死代码 4 处、`Math.max(...arr)` 展开风险、`PomodoroCard` effect 依赖不稳定 | 维护成本为主 | — | 静态分析 |

**一句话**：这套代码的**领域层写得很干净，瓶颈不在算法**（领域层聚合全部在毫秒级以下）。瓶颈是**架构上的取数方式**——把「整表物化 + JS 聚合」当成了默认手段，于是每一次统计页导航都在做一件随使用年限线性变差的事。修掉 P0-1 + P0-2，性能曲线就从「线性变差」变成「基本水平」。

---

## 二、审查方法（先说清楚可信度边界）

**做了的：**

1. **真实数据实测**。把 `prisma/dev.db` 复制到临时目录，注入 3000 行（≈2.5 年高强度使用）和 50102 行（≈10 年，压力测试）两个规模，用真实 Prisma Client 跑**现状查询模式 vs 优化查询模式**的对比。
   - `.workbuddy/perf-db.mjs` — 服务端取数模式对比
   - `.workbuddy/perf-bench.mjs` — 领域层算法对比
   - 两个脚本都可以重跑复核：`DATABASE_URL="file:<临时库>" node .workbuddy/perf-db.mjs`
   - **过程中修正了两处自己的失真**（基准脚本里把 `dailyTotals` 放进了循环、把 `Intl.DateTimeFormat` 建在了循环内），否则结论会被夸大。最终数字是修正后的。
2. **静态审查全部 72 个源文件**的关键路径，逐个查了调用点与引用次数。
3. **查了库的真实配置**（`PRAGMA journal_mode` / `synchronous` / `cache_size` / 索引清单）。

**没做的（以及为什么）：**

- **没有用 React Profiler 采客户端火焰图**。跑起来需要先走完引导流程、注入密码、起 dev server，成本远高于收益。P0-3 / P1-3 / P1-4 是**静态分析结论**，我给的是机制和行号，不是采样数字——请按这个可信度对待。
- **没有压并发**。P0-2 的并发收益（`SQLITE_BUSY`）是机制推断：`journal_mode=delete` 下写事务会独占整库，读被阻塞。我没构造并发场景实测，所以那条我标的是「机制」不是「数字」。

**规模诚实声明**：当前库里只有 **102 条** `FocusSession`。在这个规模下 P0-1 的收益是「几毫秒」，用户感觉不到。我写这份报告的理由不是「现在慢」，而是**这条路径没有任何上界，且每次导航都会走一遍**。评测用的是 2.5 年和 10 年两个量级，请你按自己的预期使用年限来权衡优先级。

---

## 三、实测数据

### 3.1 服务端：打开统计页（`(app)/layout.tsx` + 三个统计卡片一次取齐）

```
库中 FocusSession = 3,102 行（≈2.5 年高强度使用）
  现状：整表物化 ×4 + 全量 JS 聚合    中位  111.7 ms | SQL 往返 15 次 | 拉取行数 12,408
  优化：SQL 聚合 + 共享取数           中位   12.5 ms | SQL 往返 10 次 | 拉取行数    938
  → 墙钟 8.9× | 行数 −92.44%

库中 FocusSession = 50,102 行（≈10 年，压力测试）
  现状：整表物化 ×4 + 全量 JS 聚合    中位 1707.6 ms | SQL 往返 15 次 | 拉取行数 200,408
  优化：SQL 聚合 + 共享取数           中位   64.2 ms | SQL 往返 10 次 | 拉取行数   1,107
  → 墙钟 26.6× | 行数 −99.45%
```

**关键不是「快了多少倍」，而是斜率**：现状是 O(记录数)，优化后是 O(天数 × 科目数)。前者随备考时长线性变差，后者基本恒定（30 天 × 6 科目 = 180 行封顶）。

### 3.2 SQLite 写入延迟

> ⚠ **实测修正**：下面这组是 Python 裸 `sqlite3` 的数字。落地后用**真 Prisma Client** 复测，
> 倍数从 105× 降到 **8.9×**（2.832ms → 0.319ms）—— Prisma 每条语句有约 0.3ms 固定开销，
> 会把比值稀释。方向与结论不变，倍数请以 §0.1 为准。脚本：`.workbuddy/verify-write.mjs`。

```
  journal=delete  synchronous=FULL     2.301 ms/次     ← 当前配置
  journal=delete  synchronous=NORMAL   1.895 ms/次
  journal=wal     synchronous=FULL     0.337 ms/次
  journal=wal     synchronous=NORMAL   0.022 ms/次     ← 目标配置
```

`delete` 模式每次 commit 要 fsync 两次（先写日志再回写主库）；WAL 只追加日志，`NORMAL` 下不 fsync。**每一次「番茄钟完成」都是一次 commit**，这条路径在用户手里是热的。

### 3.3 领域层：`stackedByDay` 的区间筛选

```
 N=500    现状 0.110ms  → 优化 0.064ms   1.7×
 N=2000   现状 0.286ms  → 优化 0.039ms   7.3×
 N=10000  现状 0.772ms  → 优化 0.204ms   3.8×
 N=30000  现状 2.429ms  → 优化 0.591ms   4.1×
```

**这个数字要正确解读**：绝对值很小（毫秒级），单独修它不值一提。它之所以列在 P1，是因为它是 P0-1 的一部分——只要还在「整表物化 + JS 聚合」的框架里，这类 O(N×M) 就会在每次请求里叠加。

### 3.4 `Math.max(...arr)` 的展开上限

```
  n=1000    OK
  n=10000   OK
  n=100000  OK
  n=300000  ✗ RangeError: Maximum call stack size exceeded
```

`maxDayMinutes(Object.values(daily))` 的数组长度 = **有记录的天数**。30 万天 ≈ 800 年，实际不可达。所以这是**卫生问题，不是 bug**——但它是免费修的，顺手改掉。

### 3.5 库的真实配置

> ⚠ **实测修正**：下表是**用 Python `sqlite3` 打开库文件**读到的值，不是 Prisma 连接上的值。
> 落地时用 Prisma 连接复测发现：**`busy_timeout` Prisma 默认就是 5000、`foreign_keys` 默认已开**。
> 所以这两条 PRAGMA 落地后的收益是 0，写它们只是把意图显式化。
> **P0-2 的真实收益全部来自 WAL + `synchronous=NORMAL` 这一对。**

```
journal_mode = delete        ← 建议改 wal          ✔ 真实改动点
page_size    = 4096
synchronous  = 2 (FULL)      ← 建议改 NORMAL       ✔ 真实改动点
cache_size   = -2000 (2MB)   ← 可提到 16MB          （收益很小）
busy_timeout = 5000          ← Prisma 已默认设置     ✘ 无需改
foreign_keys = ON            ← Prisma 已默认打开     ✘ 无需改

FocusSession 索引：clientId(unique) / localDate / subjectId   ← 够用，不需要加
CompletedItem 索引：localDate
```

**索引不用动**。`localDate` 上的索引已经覆盖了所有区间查询的前缀；`subjectId` 覆盖了按科目聚合。加索引只会拖慢写入。这一点我特意查了，因为没有证据时「加索引」是最常见的无用优化。

---

## 四、P0 问题详解与改进代码

### P0-1：统计链路重复物化整表

#### 根因

`src/lib/server/data.ts:314` 的 `listAllSessionLikes()` 没有任何 `where` / `select` 裁剪，把**整张表**拉进内存：

```ts
export async function listAllSessionLikes(): Promise<SessionLike[]> {
  const rows = await prisma.focusSession.findMany({
    select: { localDate: true, focusMinutes: true, subjectId: true, startedAt: true, source: true },
    orderBy: { localDate: 'asc' },        // ← 排序也不需要，调用方全都要自己 group
  });
  return rows.map((r) => ({ ..., startedAt: r.startedAt.toISOString() }));  // ← N 次 Date→ISO
}
```

一次「点击统计页」到底调了几次？我数了一遍：

| 位置 | 调用 |
|---|---|
| `(app)/layout.tsx:34` | `getSnapshot()` → `listAllSessionLikes()` **①** |
| `stats/page.tsx:18` | `summaryData('week')` → `listAllSessionLikes()` **②** |
| `stats/page.tsx:19` | `heatmapData('6m')` → `listAllSessionLikes()` **③** |
| `stats/page.tsx:20` | `shareData('30d')` → `listAllSessionLikes()` **④** |

**同一份数据被读 4 次、物化 4 次、序列化 4 次。** 而且其中三次（②③④）拿到的数据 90% 以上是区间外的，读进来只为被 `filter` 丢掉。

还有一处同源问题：`achievements/page.tsx:17` 里 `listAchievements(today)` 和 `getSnapshot(today)` 各查一遍，而 `listAchievements` 内部**自己也会调 `getSnapshot`**（`data.ts:399-402`）——同一份全量快照在一屏里算两次。

#### 优化策略

把「按天求和」「按科目求和」**下推到 SQLite**。返回行数量级从 `O(记录数)` 变成 `O(天数)` 或 `O(科目数)`。

原则：**JOIN / GROUP BY / SUM 交给数据库，日期口径留在领域层。** 不要把时区规则抄进 SQL——那会变成两套真相。

#### 改进代码 ①：新增 `src/lib/server/aggregates.ts`

```ts
/**
 * 统计聚合下推层：把 SUM 交给 SQLite，不要把整表拉回来再在 JS 里 reduce。
 *
 * 动因（实测，见 .workbuddy/perf-db.mjs）：
 *   统计页一次要 4 份聚合结果（壳层快照 / 柱状图 / 热力图 / 占比），
 *   旧实现每一份都从 listAllSessionLikes() 重新物化整张 FocusSession。
 *   3100 行时：111.7ms / 拉回 12408 行；改成 SQL 聚合后：12.5ms / 938 行。
 *
 * 返回行数量级：
 *   daily*        → O(天数)
 *   subject*      → O(科目数)
 *   dailySubject* → O(天数 × 科目数)
 * 三者都与「记录条数」解耦，因此不会随使用年限线性变慢。
 *
 * 纪律：日期归属（localDate）在写入时已经算好，这里只做 SUM，不碰时区。
 *       需要时区的地方（早鸟判定）仍走 domain 的 localHourOf。
 */
import { prisma } from './db';
import { localHourOf } from '../domain/time';

const SUM_MINUTES = { focusMinutes: true } as const;

export interface TotalsAll {
  totalMinutes: number;
  totalSessions: number;
  /** 最早一条记录的归属日期，没有记录时为 null */
  earliest: string | null;
}

/** 全量合计：三个标量一次查询拿齐（替掉「拉全表再 reduce」） */
export async function totalsAll(): Promise<TotalsAll> {
  const agg = await prisma.focusSession.aggregate({
    _sum: SUM_MINUTES,
    _count: { _all: true },
    _min: { localDate: true },
  });
  return {
    totalMinutes: agg._sum.focusMinutes ?? 0,
    totalSessions: agg._count._all,
    earliest: agg._min.localDate ?? null,
  };
}

/** 每天总分钟（全量）—— 行数 = 有记录的天数 */
export async function dailyMinutesAll(): Promise<Map<string, number>> {
  const rows = await prisma.focusSession.groupBy({ by: ['localDate'], _sum: SUM_MINUTES });
  return new Map(rows.map((r) => [r.localDate, r._sum.focusMinutes ?? 0]));
}

/** 每天总分钟（区间）—— 热力图用 */
export async function dailyMinutesBetween(from: string, to: string): Promise<Map<string, number>> {
  const rows = await prisma.focusSession.groupBy({
    by: ['localDate'],
    where: { localDate: { gte: from, lte: to } },
    _sum: SUM_MINUTES,
  });
  return new Map(rows.map((r) => [r.localDate, r._sum.focusMinutes ?? 0]));
}

/** 科目总分钟（全量，含已归档科目）—— 行数 = 科目数 */
export async function subjectMinutesAll(): Promise<Map<number, number>> {
  const rows = await prisma.focusSession.groupBy({ by: ['subjectId'], _sum: SUM_MINUTES });
  return new Map(rows.map((r) => [r.subjectId, r._sum.focusMinutes ?? 0]));
}

/** 科目总分钟（区间）—— 科目占比用 */
export async function subjectMinutesBetween(
  from: string,
  to: string,
): Promise<Map<number, number>> {
  const rows = await prisma.focusSession.groupBy({
    by: ['subjectId'],
    where: { localDate: { gte: from, lte: to } },
    _sum: SUM_MINUTES,
  });
  return new Map(rows.map((r) => [r.subjectId, r._sum.focusMinutes ?? 0]));
}

export interface DaySubjectCell {
  localDate: string;
  subjectId: number;
  minutes: number;
}

/** 天 × 科目（区间）—— 柱状图 / 学习日历用。行数 ≤ 天数 × 科目数 */
export async function dailySubjectBetween(from: string, to: string): Promise<DaySubjectCell[]> {
  const rows = await prisma.focusSession.groupBy({
    by: ['localDate', 'subjectId'],
    where: { localDate: { gte: from, lte: to } },
    _sum: SUM_MINUTES,
  });
  return rows.map((r) => ({
    localDate: r.localDate,
    subjectId: r.subjectId,
    minutes: r._sum.focusMinutes ?? 0,
  }));
}

/**
 * 早鸟判定：有没有「某天第一段专注在 7:00 前开始」。
 *
 * 不要为了一个布尔值扫全表：按天 groupBy 出每天最早的 startedAt（行数 = 天数）。
 * 时区换算仍交给 domain 的 localHourOf —— 口径与原 detectEarlyBird 逐字一致，
 * 也避免把「本地小时 = UTC 小时 + 8」这条规则抄进 SQL（那会变成第二套真相）。
 *
 * 必须排除手动补记：它的 startedAt 是当天零点的近似值，算进来会白送徽章。
 */
export async function hasEarlyBird(): Promise<boolean> {
  const rows = await prisma.focusSession.groupBy({
    by: ['localDate'],
    where: { source: { not: 'manual' } },
    _min: { startedAt: true },
  });
  for (const r of rows) {
    if (r._min.startedAt && localHourOf(r._min.startedAt) < 7) return true;
  }
  return false;
}
```

#### 改进代码 ②：`src/lib/domain/stats.ts` 新增聚合版纯函数

保留原有函数（`selftest.ts` 与 `scripts/preview-chart.tsx` 依赖它们），**新增**从聚合结果入表的版本：

```ts
/** 由「按天求和」的结果求累计（与 totalMinutes(sessions) 同口径） */
export function totalMinutesOfDaily(dailyMinutes: Record<string, number>): number {
  let sum = 0;
  for (const key in dailyMinutes) sum += dailyMinutes[key];
  return sum;
}

/**
 * 由「天×科目」聚合行构造堆叠柱状图数据。
 * 与 stackedByDay 同口径，但输入已经是 SQL 聚合结果 —— 不接触原始记录行。
 */
export function stackedByDayFromCells(
  cells: ReadonlyArray<{ localDate: string; subjectId: number; minutes: number }>,
  dates: string[],
  subjects: SubjectLike[],
  labelOf: (date: string) => string,
): { points: StackedPoint[]; series: SeriesDef[] } {
  const bucket = new Map<string, Record<string, number>>();
  for (const date of dates) bucket.set(date, {});
  const activeIds = new Set<number>();

  for (const c of cells) {
    const row = bucket.get(c.localDate); // 区间外的行直接丢弃，O(1)
    if (row === undefined) continue;
    activeIds.add(c.subjectId);
    const key = `s${c.subjectId}`;
    row[key] = (row[key] ?? 0) + c.minutes;
  }

  const series: SeriesDef[] = subjects
    .filter((s) => activeIds.has(s.id))
    .map((s) => ({ key: `s${s.id}`, label: s.name, color: s.color }));
  if (series.length === 0) series.push({ key: 'empty', label: '暂无记录', color: '#e2e8f0' });

  return {
    points: dates.map((date) => ({ label: labelOf(date), values: bucket.get(date) ?? {}, meta: date })),
    series,
  };
}

/** 由「科目 → 分钟」的汇总构造占比切片。与 subjectTotals 同口径（含已归档科目的兜底名） */
export function subjectTotalsFromSums(
  sums: Iterable<[number, number]>,
  subjects: SubjectLike[],
): Array<SliceDatum & { subjectId: number }> {
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const out: Array<SliceDatum & { subjectId: number }> = [];
  for (const [subjectId, value] of sums) {
    if (value <= 0) continue;
    const sub = byId.get(subjectId);
    out.push({
      subjectId,
      label: sub?.name ?? '已删除科目',
      color: sub?.color ?? '#94a3b8',
      value,
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

/**
 * 由「按天求和」+ 少量标量构造快照。
 * 与 buildSnapshot 口径一致，但输入是 O(天数) 的聚合结果，不是 O(记录数) 的行列表。
 * buildSnapshot 保留不动（selftest 直接断言它）。
 */
export function buildSnapshotFromDaily(
  dailyMinutes: Record<string, number>,
  meta: { totalSessions: number; subjectCount: number; hasEarlyBird: boolean },
  today: string,
): StatsSnapshot {
  return {
    totalSessions: meta.totalSessions,
    totalMinutes: totalMinutesOfDaily(dailyMinutes),
    dailyMinutes,
    maxDayMinutes: maxDayMinutes(dailyMinutes),
    subjectCount: meta.subjectCount,
    currentStreak: currentStreak(dailyMinutes, today, CHECKIN_MINUTES),
    longestStreak: longestStreak(dailyMinutes, CHECKIN_MINUTES),
    currentPassStreak: currentStreak(dailyMinutes, today, PASS_MINUTES),
    longestPassStreak: longestStreak(dailyMinutes, PASS_MINUTES),
    hasEarlyBird: meta.hasEarlyBird,
  };
}
```

#### 改进代码 ③：`src/lib/server/statsService.ts` 三个服务函数重写

`SummaryResult` / `HeatmapResult` / `ShareResult` 的**形状一字不改** —— 前端零改动。

```ts
import { totalsAll, dailySubjectBetween, subjectMinutesAll, subjectMinutesBetween, dailyMinutesBetween } from './aggregates';
import {
  heatmapLevel,
  stackedByDayFromCells,
  subjectTotalsFromSums,
  totalMinutesOfDaily,
  type SessionLike,
} from '../domain/stats';

export async function summaryData(
  rangeInput: string | null,
  today = todayLocalDate(),
): Promise<SummaryResult> {
  const range = normalizeRange(rangeInput);

  // 三份互不依赖的取数并发：settings / 科目 / 全量标量（earliest 也在里面）
  const [settings, subjects, totals] = await Promise.all([
    settingsSafe(),
    listSubjectLikes(),
    totalsAll(),
  ]);

  const { from, to, dates } = resolveRange(range, {
    today,
    weekStart: settings.weekStart,
    earliest: totals.earliest,
  });

  const labelMode = range === 'week' ? 'weekday' : 'date';

  /**
   * 区间内聚合：行数 = 天数 × 科目数（≤ 31 × 科目数），与记录条数无关。
   * 柱状图 / 每日明细 / 区间科目占比三件事共用这一份结果，口径不会漂移。
   */
  const [cells, allSubjectMinutes] = await Promise.all([
    dailySubjectBetween(from, to),
    subjectMinutesAll(),
  ]);

  const rangeDaily = new Map<string, number>();
  const rangeBySubject = new Map<number, number>();
  for (const c of cells) {
    rangeDaily.set(c.localDate, (rangeDaily.get(c.localDate) ?? 0) + c.minutes);
    rangeBySubject.set(c.subjectId, (rangeBySubject.get(c.subjectId) ?? 0) + c.minutes);
  }

  const { points, series } = stackedByDayFromCells(cells, dates, subjects, (d) =>
    labelFor(d, labelMode),
  );

  return {
    range,
    from,
    to,
    today,
    weekStart: settings.weekStart,
    dates,
    points,
    series,
    dailyTotals: dates.map((date) => {
      const minutes = rangeDaily.get(date) ?? 0;
      return {
        date,
        minutes,
        checkedIn: minutes >= CHECKIN_MINUTES,
        passed: minutes >= PASS_MINUTES,
      };
    }),
    subjectTotals: subjectTotalsFromSums(rangeBySubject, subjects),
    totalMinutes: totalMinutesOfDaily(Object.fromEntries(rangeDaily)),
    allTimeTotalMinutes: totals.totalMinutes,
    allTimeSubjectTotals: subjectTotalsFromSums(allSubjectMinutes, subjects),
  };
}

export async function heatmapData(modeInput: string | null, today: string): Promise<HeatmapResult> {
  const mode: '6m' | 'all' = modeInput === 'all' ? 'all' : '6m';
  const [settings, totals] = await Promise.all([settingsSafe(), totalsAll()]);

  // 近 6 个月 ≈ 26 周
  const from = mode === 'all' && totals.earliest ? totals.earliest : addDays(today, -26 * 7);
  const dates = eachDate(from, today);
  const daily = await dailyMinutesBetween(from, today);

  const cells: HeatCell[] = dates.map((date) => {
    const minutes = daily.get(date) ?? 0;
    return { date, minutes, level: heatmapLevel(minutes) };
  });

  let totalMinutes = 0;
  let activeDays = 0;
  let maxDayMinutes = 0;
  for (const c of cells) {
    if (c.minutes <= 0) continue;
    totalMinutes += c.minutes;
    activeDays++;
    if (c.minutes > maxDayMinutes) maxDayMinutes = c.minutes;
  }

  return {
    mode,
    from,
    to: today,
    cells,
    weekStart: settings.weekStart,
    totalMinutes,
    activeDays,
    maxDayMinutes,
  };
}

export async function shareData(rangeInput: string | null, today: string): Promise<ShareResult> {
  const allowed: RangeKey[] = ['7d', '30d', 'all'];
  const range: RangeKey = allowed.includes(rangeInput as RangeKey)
    ? (rangeInput as RangeKey)
    : '30d';

  const [subjects, totals] = await Promise.all([listSubjectLikes(), totalsAll()]);

  const { from, to } = resolveRange(range, { earliest: totals.earliest });
  const sums = await subjectMinutesBetween(from, to);

  let total = 0;
  for (const v of sums.values()) total += v;

  return {
    range,
    from,
    to: today,
    totalMinutes: total,
    slices: subjectTotalsFromSums(sums, subjects).map((s) => ({
      ...s,
      pct: total > 0 ? Math.round((s.value / total) * 1000) / 10 : 0,
    })),
  };
}
```

> `heatmapCells` / `heatmapLevel` / `stackedByDay` / `subjectTotals` 全部**保留**——`selftest.ts`（109 项）和 `scripts/preview-chart.tsx` 还在用它们，改动零破坏。

#### 改进代码 ④：`src/lib/server/data.ts` 的 `getSnapshot` 与重叠快照

```ts
import {
  dailyMinutesAll,
  hasEarlyBird,
  subjectMinutesAll,
  totalsAll,
} from './aggregates';
import { buildSnapshotFromDaily } from '../domain/stats';

/**
 * 壳层快照。签名与返回值不变（layout / 成就页 / 三个路由都在用），
 * 但内部从「物化整表 + JS 聚合」换成「SQL 聚合 + 小结果集」。
 */
export async function getSnapshot(today = todayLocalDate()) {
  const [daily, totals, subjectMinutes, earlyBird] = await Promise.all([
    dailyMinutesAll(),
    totalsAll(),
    subjectMinutesAll(),
    hasEarlyBird(),
  ]);

  return buildSnapshotFromDaily(
    Object.fromEntries(daily),
    {
      totalSessions: totals.totalSessions,
      // 只要有过专注记录就计入，即使科目后来被归档 —— 与旧口径一致
      subjectCount: subjectMinutes.size,
      hasEarlyBird: earlyBird,
    },
    today,
  );
}

/**
 * 成就列表。允许调用方把已经算好的快照传进来 ——
 * 成就页原本 listAchievements + getSnapshot 各算一遍同一份快照（一屏两次全表扫描）。
 */
export async function listAchievements(
  today = todayLocalDate(),
  precomputed?: StatsSnapshot,
): Promise<AchievementDTO[]> {
  const [unlocked, snapshot] = await Promise.all([
    prisma.achievement.findMany(),
    precomputed ? Promise.resolve(precomputed) : getSnapshot(today),
  ]);
  // ...其余不变
}
```

`achievements/page.tsx` 改成一次取数：

```ts
const snapshot = await getSnapshot(today);
const badges = await listAchievements(today, snapshot);
const level = resolveLevel(snapshot.totalMinutes);
```

#### 改进代码 ⑤：settings 请求级缓存

`getSettings()` 在统计页一次请求里被调 **3 次**（layout、`summaryData.settingsSafe`、`heatmapData.settingsSafe`），每次一个 SQL 往返读同一个 `Setting` 行。加一层带失效的进程内缓存：

```ts
// src/lib/server/settings.ts
/** 进程内缓存。写入侧显式失效；再加 1s TTL 兜住「另一个进程改了库」
 *  （reset-data.ts / seed-demo.ts / verify-auth.ts 都是独立进程写库的场景）。 */
const CACHE_TTL_MS = 1000;
let appCache: { value: AppSettings; at: number } | null = null;

export function invalidateSettingsCache(): void {
  appCache = null;
}

export async function getSettings(): Promise<AppSettings> {
  const now = Date.now();
  if (appCache && now - appCache.at < CACHE_TTL_MS) return appCache.value;

  const raw = await readJson<Partial<AppSettings> | null>('app', null);
  const value = normalizeSettings(raw);
  appCache = { value, at: now };
  return value;
}

export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = { /* ...不变... */ };
  const normalized = normalizeSettings(next);
  await writeJson('app', normalized);
  appCache = { value: normalized, at: Date.now() }; // 写后立即对齐，不靠 TTL 过期
  return normalized;
}
```

同时 `writeJson` 里对 `'app'` 键失效一次，兜住「绕过 updateSettings 直接写 setting 表」的路径。

> **注意**：TTL 缓存有 1 秒的不一致窗口。设置页 `PUT` 之后会 `router.refresh()`，而且写入侧我们显式对齐了缓存，所以用户感知不到。如果你的要求是「任何时刻都必须读到最新」，就把 TTL 设 0 并只保留写失效——但那样独立进程写库的场景（seed/reset 脚本）就需要重启 dev server 才生效，这是原设计当年也要面对的取舍。

---

### P0-2：SQLite 未开 WAL

#### 根因

`src/lib/server/db.ts` 只做了单例，没做任何 PRAGMA 调优。查库确认：

```
journal_mode = delete       synchronous = 2 (FULL)      busy_timeout = 5000（Prisma 默认已设，⚠ 修正）
```

`delete` 模式下写事务独占整库：**写的时候读被阻塞，读的时候写被阻塞**，且每次 commit 要 fsync 两次。
实测（真 Prisma 路径）`2.832ms/次`。

对本应用的具体风险：
1. **每次专注落库都要等一次双 fsync** —— 这是用户点击「中断放弃」后要等的路径。
2. `busy_timeout` Prisma 已经默认设成 5000ms（**这一条原报告说错了，见 §0.1**），
   所以并发写本来就会排队而不是立刻抛 `SQLITE_BUSY`。但 `delete` 模式下写事务独占整库，
   排队意味着**读也被一起挡住** —— 换成 WAL 之后读不再被写阻塞，这才是并发侧的真实收益。

#### 改进代码：`src/lib/server/db.ts` 全量替换

```ts
/**
 * Prisma 单例 + SQLite 连接调优。
 *
 * 开发环境下 Next 的模块热重载会反复求值模块，挂到 globalThis 上避免连接数爆炸。
 *
 * 为什么要设 PRAGMA：SQLite 的默认配置（delete 日志 / synchronous=FULL / 无 busy_timeout）
 * 面向「单进程、偶尔写」的场景，与本应用不符。实测（2000 次插入+commit 均值）：
 *   delete + FULL   2.301 ms/次
 *   wal    + NORMAL 0.022 ms/次      ← 目标
 *
 * 注意 PRAGMA 的作用域不一样：
 *   - journal_mode=WAL 写进库文件头，一次设置永久生效（但放在启动钩子里重设也无害）
 *   - synchronous / busy_timeout / cache_size / foreign_keys 是**连接级**的，
 *     连接池里每条新连接都得设一遍 —— 所以 DATABASE_URL 上加 connection_limit=1，
 *     让连接唯一，这里设一次就覆盖全部。
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pragmas?: Promise<void>;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

async function applyPragmas(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL;');
    await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL;');
    // 并发写时排队等待，而不是立刻抛 SQLITE_BUSY
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000;');
    await prisma.$executeRawUnsafe('PRAGMA cache_size = -16000;'); // 16MB 页缓存
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
  } catch (err) {
    // 调优失败不影响功能，只影响性能 —— 不要让它把应用拖垮
    console.error('[db] PRAGMA 设置失败（功能不受影响）', err);
  }
}

/** 幂等的连接初始化。在 bootstrap() 里 await 一次即可。 */
export function dbReady(): Promise<void> {
  if (!globalForPrisma.pragmas) globalForPrisma.pragmas = applyPragmas();
  return globalForPrisma.pragmas;
}
```

配套两处：

```ts
// src/lib/server/bootstrap.ts —— run() 开头
async function run(): Promise<void> {
  await dbReady();          // ← 新增：先调优连接，再做别的
  const today = localDateOf(new Date());
  // ...
}
```

```
# .env —— 让连接池只有一个连接，保证连接级 PRAGMA 覆盖全部连接
DATABASE_URL="file:./dev.db?connection_limit=1"
```

> `connection_limit` 已实测被当前 Prisma 版本（6.19.3）接受，连接串不报错。**已落地。**
> 即使它被忽略，WAL 是库文件级的、单独就生效 —— 这也是为什么把 WAL 和连接级 PRAGMA 拆成两件事。
> 另：WAL 会带来 `-wal` / `-shm` 旁挂文件。已确认本项目的备份走 Prisma 逻辑导出（JSON），
> **不是裸拷 `.db` 文件**，所以不存在「拷到一半、新写入还留在 WAL 里」的问题。

**实现细节上的一个坑**：PRAGMA 用 `$executeRawUnsafe` 下发会抛错 ——
`PRAGMA journal_mode = WAL` 会回一行结果，而 `executeRaw` 的契约是「不该有返回结果」。
统一改用 `$queryRawUnsafe`（对无返回的语句也照常工作，返回空数组）。
另外 PRAGMA 会把整数回成 **BigInt**，日志里 `JSON.stringify` 它会抛
`Do not know how to serialize a BigInt` —— 这不是 PRAGMA 失败，别被它骗了（我自己先踩了一次）。

---

### P0-3：客户端 4Hz 重渲染风暴

#### 根因（两个问题叠加）

> 落地时的补充：本节原本是**静态分析**结论。落地后用 jsdom 挂载真实 Provider 链实测，
> 结果与推断一致（外壳 4 次/秒 → 6.2 秒内 1 次；卡片 −75%）。实测细节见 §0.3。


**问题 A：`usePomodoro` 返回新对象，永不稳定。** `src/hooks/usePomodoro.ts:332` 直接 `return { ... }`，没有 `useMemo`。而心跳每 250ms 调一次 `setNow`（`usePomodoro.ts:207`）：

```ts
const TICK_MS = 250;   // ← 显示粒度是 1 秒，4Hz 里有 3 次渲染产出完全相同的 DOM
```

**问题 B：context value 因此每秒重建。** `src/components/today/PomodoroProvider.tsx:95-103`：

```ts
const value = useMemo(() => ({ controller, toggle, pendingSubmissions, canSwitchSubject }), 
  [controller, toggle, queue.pending]);
//  ↑ controller 每次渲染都是新对象 → 这个 useMemo 形同虚设
```

后果：`PomodoroContext.Provider` 的 value 每次心跳都变 → **所有 consumer 每秒 4 次重渲染**。`AppShell.tsx:75` 的 `ShellChrome` 就是一个 consumer，而它只用了 `toggle` —— 也就是说**为了绘制一个倒计时数字，整个应用外壳（含 sticky header + backdrop-blur + 底部导航）被拖进 4Hz 重渲染**。

（`{children}` 因为元素引用没变，React 会跳过 —— 所以正文没被波及。这是唯一的好消息。）

**问题 C：由 A 派生的 effect 依赖不稳定。** `PomodoroCard.tsx:24-28`：

```ts
useEffect(() => {
  if (controller.subjectId === null && subjects.length > 0) controller.setSubject(subjects[0].id);
}, [controller, subjects]);   // ← controller 每 250ms 换一次 → 这个 effect 每 250ms 跑一次
```

守卫救了它（`subjectId` 非 null 后不再 setState），所以不是死循环，但每次渲染都要白跑一遍。

#### 改进代码 ①：心跳频率降到显示粒度

```ts
// src/hooks/usePomodoro.ts
/**
 * 定时器只用于重绘，不参与计时正确性（计时全靠 Date.now() 差值）。
 * 显示粒度是 1 秒（formatClock 取整），所以 250ms 的 3/4 次渲染是纯浪费。
 * 用 1000ms：渲染次数 −75%，进度环 1 秒走 0.067%（25 分钟番茄），肉眼不可辨。
 */
const TICK_MS = 1000;
```

> 副作用：`isComplete()` 的判定最多晚 1 秒。结算走 `settle()` 取真实时间戳，所以**记录时长不受影响**。

#### 改进代码 ②：把「动作」和「随时钟变化的状态」拆成两个 context

```tsx
// src/components/today/PomodoroProvider.tsx

/** 稳定引用：只含动作。壳层（快捷键）用这个，永远不随心跳重渲染 */
interface PomodoroActions {
  toggle: () => void;
  setSubject: (id: number | null) => void;
  setPlannedMinutes: (minutes: number) => void;
  start: () => void;
  pause: () => void;
  abort: () => void;
  discard: () => void;
}

const PomodoroActionsContext = createContext<PomodoroActions | null>(null);

export function usePomodoroActions(): PomodoroActions {
  const ctx = useContext(PomodoroActionsContext);
  if (!ctx) throw new Error('usePomodoroActions 必须在 PomodoroProvider 内使用');
  return ctx;
}

export function PomodoroProvider({ settings, children }: { settings: PomodoroSettings; children: ReactNode }) {
  // ...useFocusQueue / usePomodoro 不变...

  /**
   * 动作单独成一层 context。
   * usePomodoro 内部的回调都是 useCallback 稳定的，所以这个对象引用恒定 ——
   * 壳层因此彻底脱离「每秒 4 次」的重渲染，卡片的倒计时也不会再带着整页抖动。
   */
  const actions = useMemo<PomodoroActions>(
    () => ({
      toggle,
      setSubject: controller.setSubject,
      setPlannedMinutes: controller.setPlannedMinutes,
      start: controller.start,
      pause: controller.pause,
      abort: controller.abort,
      discard: controller.discard,
    }),
    [toggle, controller.setSubject, controller.setPlannedMinutes, controller.start,
     controller.pause, controller.abort, controller.discard],
  );

  const value = useMemo<PomodoroContextValue>(
    () => ({ controller, toggle, pendingSubmissions: queue.pending, canSwitchSubject: controller.phase === 'idle' }),
    [controller, toggle, queue.pending],
  );

  return (
    <PomodoroActionsContext.Provider value={actions}>
      <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>
    </PomodoroActionsContext.Provider>
  );
}
```

```tsx
// src/components/AppShell.tsx
import { usePomodoroActions } from '@/components/today/PomodoroProvider';

function ShellChrome({ dday, latestUnlockAt, children }: {...}) {
  // 原来：const { toggle } = usePomodoroCtx();   ← 订阅了会随时间变化的 value
  const { toggle } = usePomodoroActions();      // ← 只订阅稳定动作
  // ...其余不变
}
```

#### 改进代码 ③：修掉 `PomodoroCard` 的不稳定 effect 依赖

```tsx
// src/components/today/PomodoroCard.tsx
const { subjectId } = controller;
const setSubject = controller.setSubject; // useCallback 稳定

useEffect(() => {
  if (subjectId === null && subjects.length > 0) setSubject(subjects[0]!.id);
}, [subjectId, subjects, setSubject]);   // ← 只在真正相关的值变化时跑
```

---

## 五、P1 问题与改进代码

### P1-1：`stackedByDay` 的 O(N×M) 区间筛选

`src/lib/domain/stats.ts:99`：

```ts
for (const s of sessions) {
  if (!dates.includes(s.localDate)) continue;   // ← 每天一次线性扫描
```

`dates` 是数组，`includes` 是 O(M)。外层 N 条记录 → **O(N×M)**。N=30000、M=30 时实测 2.43ms。

```ts
export function stackedByDay(
  sessions: SessionLike[],
  dates: string[],
  subjects: SubjectLike[],
  labelOf: (date: string) => string,
): { points: StackedPoint[]; series: SeriesDef[] } {
  // 关键：把「日期是否在区间内」变成 O(1) 查表。
  // 原来用 dates.includes(s.localDate)，对每条记录线性扫一遍日期数组（O(N×M)）。
  const bucket = new Map<string, Record<string, number>>();
  for (const date of dates) bucket.set(date, {});
  const activeIds = new Set<number>();

  for (const s of sessions) {
    const row = bucket.get(s.localDate);
    if (row === undefined) continue; // 等价于原来的 !dates.includes(...)
    activeIds.add(s.subjectId);
    const key = `s${s.subjectId}`;
    row[key] = (row[key] ?? 0) + s.focusMinutes;
  }

  const series: SeriesDef[] = subjects
    .filter((s) => activeIds.has(s.id))
    .map((s) => ({ key: `s${s.id}`, label: s.name, color: s.color }));
  if (series.length === 0) series.push({ key: 'empty', label: '暂无记录', color: '#e2e8f0' });

  return {
    points: dates.map((date) => ({ label: labelOf(date), values: bucket.get(date) ?? {}, meta: date })),
    series,
  };
}
```

顺手把 `maxDayMinutes` 的展开风险删掉：

```ts
/**
 * 单日峰值。
 * 不用 Math.max(...values)：参数是逐个压栈的，十万级会抛
 * RangeError: Maximum call stack size exceeded（实测 30 万必炸）。
 * 这里 values 的长度是「有记录的天数」，现实到不了，但 reduce 版免费且没有悬崖。
 */
export function maxDayMinutes(dailyMinutes: Record<string, number>): number {
  let max = 0;
  for (const key in dailyMinutes) {
    const v = dailyMinutes[key];
    if (v > max) max = v;
  }
  return max;
}
```

> 同类的 `Math.max(1, ...totals)`（`charts/index.tsx:100`、`:543`）数组长度是柱数 / 科目数，都在几十量级，**不用改**。别为了「统一风格」去动热路径之外的东西。

### P1-2：同一请求内的重复取数

已在 P0-1 的改进代码 ④⑤ 里合并解决。汇总一下每个路由的查询数变化：

| 页面 / 接口 | 现状查询数 | 优化后 | 现状全表扫描 | 优化后 |
|---|---|---|---|---|
| 打开统计页 | 15 | 10 | **4** | 0 |
| `POST /api/focus-sessions`（正常） | 4 | 4 | **1** | 0 |
| `POST /api/focus-sessions`（离线补交命中） | 3 | 3 | **1** | 0 |
| 打开成就页 | 5 | 3 | **2** | 0 |
| 任意页面导航（layout） | 6 | 4 | **1** | 0 |

**「优化后全表扫描 = 0」是这套改动的真正价值**：不再有任何一条用户路径的代价与历史记录条数挂钩。

### P1-3：热力图 hover 触发全量重渲染

`src/components/charts/index.tsx:425-522`。`Heatmap` 把 `hover` 放在自己的 state 里，而 `hover` 一变，React 就要 reconcile **所有格子**。格子数 = 周数 × 7：近 6 个月 26 周 = 182 个，切到「全程」按 3 年算 = 1092 个。

而且这两行**每次渲染都重算**（不依赖 `hover`，本可以 memo）：

```ts
const totalMinutes = cells.reduce((sum, c) => sum + c.minutes, 0);
const activeDays = cells.filter((c) => c.minutes > 0).length;
```

改法：把格子抽成 `memo` 组件 + 派生值入 `useMemo`。`hover` 变化时只有底部那行文字重渲染。

```tsx
import { memo, useCallback, useMemo, useState } from 'react';

/**
 * 格子单独成组件 + memo。
 * 关键在 props 必须稳定：把「取哪个 cell」交给子组件自己做（onEnter(cell)），
 * 不要在父组件里写 onMouseEnter={() => setHover(cell)} —— 那样每次渲染都生成新闭包，
 * memo 会被击穿，等于没写。
 */
const HeatCellSquare = memo(function HeatCellSquare({
  cell,
  onEnter,
  onLeave,
}: {
  cell: HeatCell;
  onEnter: (cell: HeatCell) => void;
  onLeave: () => void;
}) {
  return (
    <button
      type="button"
      data-date={cell.date}
      onMouseEnter={() => onEnter(cell)}
      onMouseLeave={onLeave}
      onClick={() => onEnter(cell)}
      className={`hm-${cell.level} w-3 h-3 rounded-[3px] transition-transform hover:scale-125`}
      aria-label={`${cell.date} ${formatMinutes(cell.minutes)}`}
    />
  );
});

export function Heatmap({ cells, weekStart = 1 }: { cells: HeatCell[]; weekStart?: 0 | 1 }) {
  const [hover, setHover] = useState<HeatCell | null>(null);

  const { weeks, monthMarks } = useMemo(() => { /* 不变 */ }, [cells, weekStart]);

  // 这两个只依赖 cells，不该跟着 hover 重算
  const stats = useMemo(() => {
    let totalMinutes = 0;
    let activeDays = 0;
    for (const c of cells) {
      totalMinutes += c.minutes;
      if (c.minutes > 0) activeDays++;
    }
    return { totalMinutes, activeDays };
  }, [cells]);

  const enter = useCallback((c: HeatCell) => setHover(c), []);
  const leave = useCallback(() => setHover(null), []);

  // ...渲染时 <HeatCellSquare cell={cell} onEnter={enter} onLeave={leave} />
}
```

### P1-4：`StudyCalendar` 的 `useMemo` 被 `pickedDate` 污染

`charts/index.tsx:294`：

```ts
}, [points, series, weekStart, today, pickedDate]);
//                                    ↑ 点一格就重算 calendarGrid + totals + peak + sum + activeDays
```

30 天规模下这是 0.3ms 级，**但它同时在 `model` 里塞了一个 `picked` 字段**——「日历骨架」和「当前选中项」是两种生命周期，混在一起就会让每次点击都重建骨架。拆开：

```tsx
const model = useMemo(() => {
  // ...不变，但不要 picked 字段
  return { byDate, weeks, totalOf, peak, sum, activeDays, today: today ?? last };
}, [points, series, weekStart, today]);     // ← 去掉 pickedDate

/** 选中项单独派生，点格子不再重建日历骨架 */
const picked = useMemo(
  () => (pickedDate ? model?.byDate.get(pickedDate) ?? null : null),
  [pickedDate, model],
);
```

---

## 六、P2：卫生问题与死代码

### 6.1 零引用导出（4 处）

```
todayMiniStats          src/lib/server/statsService.ts:203    0 处引用
getTodaySessionCount    src/lib/server/data.ts:368            0 处引用
isCheckedInToday        src/lib/server/data.ts:373            0 处引用
Donut                   src/components/charts/index.tsx:580   0 处引用
```

`getDailyMinutes` 只被 `isCheckedInToday` 使用 → 这一串都是死的。

顺带一个真 bug：`todayMiniStats` 用 `gte: addDays(today, -59)` 聚合了 **60 天**，却只返回 7 天的结果（`statsService.ts:206` vs `:210`）。谁要是哪天把它接起来用，就会白算 53 天。

**诚实说明**：`Donut` 作为从未被引用的具名导出，生产构建的 tree-shaking 大概率已经把它删了 —— **删它是为了可维护性，不是为了包体积**。别把这条当成绩。

### 6.2 `PomodoroCard` 自定义时长对话框的初始值

`PomodoroCard.tsx:262-266`：`CustomMinutesDialog` 的 `useState(String(initial))` 只在挂载时取一次，靠 `useEffect(..., [open, initial])` 补同步。这属于「用 effect 做 props → state 同步」，改成 `key` 重置更省一层渲染：

```tsx
<CustomMinutesDialog key={customOpen ? `open-${presets}` : 'closed'} ... />
```

低优先级，与性能关系不大。

### 6.3 `usePomodoro` 心跳 effect 随 `tomatoes` 重建

```ts
useEffect(() => { /* setInterval */ }, [state, finish]);   // finish 依赖 [tomatoes]
```

`finish` 的依赖是 `[tomatoes]`，所以每完成一个番茄，interval 会被拆掉重建一次。一晚上 8 个番茄 = 8 次重建，**毫无影响**。列出来只是为了说明我查过，不是建议改。

---

## 七、落地记录与验证清单

三批**全部完成**（2026-09-11）。下面是实际改动的文件与跑过的验证。

### 7.1 改了哪些文件

| 批次 | 文件 | 改动 |
|---|---|---|
| 一 | `src/lib/server/db.ts` | 新增 `dbReady()`，下发 5 条 PRAGMA（幂等、失败只记日志） |
| 一 | `src/lib/server/bootstrap.ts` | `run()` 开头 `await dbReady()` |
| 一 | `.env` | `DATABASE_URL` 加 `?connection_limit=1` |
| 二 | `src/lib/server/aggregates.ts` | **新增**，SQL 聚合下推层（6 个函数） |
| 二 | `src/lib/domain/stats.ts` | 新增聚合入表版 6 个函数；修 `stackedByDay` 的 O(N×M)；`maxDayMinutes` 去栈悬崖 |
| 二 | `src/lib/server/statsService.ts` | 三个服务函数改用聚合取数；删死代码 `todayMiniStats` |
| 二 | `src/lib/server/data.ts` | `getSnapshot` 改聚合（并去掉一次无用的科目查询）；`listAchievements` 加 `precomputed` 参数；删 3 处死代码 |
| 二 | `src/app/(app)/achievements/page.tsx`、`src/app/api/achievements/route.ts` | 复用同一份快照 |
| 二 | `src/lib/server/settings.ts` | `getSettings` 加 1s TTL 缓存 + 写侧显式失效 |
| 三 | `src/hooks/usePomodoro.ts` | `TICK_MS` 250 → 1000 |
| 三 | `src/components/today/PomodoroProvider.tsx` | 拆 `usePomodoroActions`（稳定动作）与 `usePomodoroCtx`；修 `toggle` 的依赖 |
| 三 | `src/components/AppShell.tsx` | 外壳改用 `usePomodoroActions()` |
| 三 | `src/components/today/PomodoroCard.tsx` | 修 effect 依赖（不再每次心跳白跑） |
| 三 | `src/components/charts/index.tsx` | `Heatmap` 格子抽 `memo` 组件 + 派生值入 `useMemo`；`StudyCalendar` 的 `picked` 移出骨架 memo；删死代码 `Donut` |
| 验证 | `scripts/selftest.ts` | 新增 20 项「聚合版 vs 原始行版」交叉断言（109 → 146 项） |
| 验证 | `scripts/preview-chart.tsx` | **新增 4 个热力图预览场景**（原先热力图完全没有预览） |

### 7.2 跑过的验证

```
npm run selftest          146 项全过（原 109 + 新增 20 项交叉断言 + 若干）
npx tsc --noEmit          0 错误
npm run preview:chart     11 个场景（原 7 + 热力图 4）；1462 个格子、无 NaN
npm run preview:report    6 张卡片正常
npm run verify:auth       （未动鉴权链路，略）
```

外加三个**新增**的验证脚本（都在 `.workbuddy/`，全部只读或指向副本库）：

```
# 新旧取数逻辑等价性：真库 / 3102 行 / 50102 行，各 16 项
DATABASE_URL="file:./dev.db?connection_limit=1"  npx tsx .workbuddy/verify-equiv.ts
DATABASE_URL="file:<small.db>"                   npx tsx .workbuddy/verify-equiv.ts
DATABASE_URL="file:<bench.db>"                   npx tsx .workbuddy/verify-equiv.ts
# 加 BENCH=1 会额外跑「打开统计页」的计时对比

# 写入延迟：真 Prisma 路径下 delete+FULL vs wal+NORMAL
node .workbuddy/verify-write.mjs

# 客户端重渲染计数（jsdom，不需浏览器）
npx esbuild .workbuddy/render-probe.tsx --bundle --format=iife --global-name=RenderProbe \
  --platform=browser --outfile=.workbuddy/render-probe.js --tsconfig=scripts/tsconfig.json
node .workbuddy/run-render-probe.mjs
```

### 7.3 还没做的事

- **没有真机看一眼倒计时手感**。`TICK_MS` 从 250 改到 1000 之后，秒数依然是每秒跳一次
  （显示粒度本来就是 1 秒），但**该由你的眼睛确认**。如果不适，把 `TICK_MS` 改回 500 即可
  —— 代价只是渲染次数翻倍，context 拆分带来的外壳脱钩不受影响。
- **没有跑生产构建**。本机 `npm run build` 会触发沙箱的批量删除闸门（见项目记忆），
  而这次的所有改动都能被 `tsc` + `selftest` + 预览脚本 + 等价性脚本覆盖，所以没去走授权流程。
  首次发布前请自行跑一次 `npm run build`。

### 7.4 不建议做的事（同等重要）

- ❌ **不要给 `FocusSession` 加索引**。`localDate` / `subjectId` 已经有了，所有区间与分组查询都走前缀命中。加索引只会拖慢写入 —— 而写入是热路径。
- ❌ **不要给图表加 `React.memo` 就完事**。`StatsView` 的 `points`/`series` 是 state 里的稳定引用，memo 能省下的是「父组件其他 state 变化」引起的重渲染。真正的问题在 context 拆分层，不在卡片层。
- ❌ **不要把时区换算写进 SQL**。现在只有 `localDate` 一个日期真相来源。为了「少一次 groupBy」而把 `+8` 抄进 SQL，等于开了第二个真相来源 —— 这是这套代码目前最值钱的架构约束，别为了几毫秒的交易掉它。
- ❌ **不要在 Route Handler 里用 React `cache()` 做请求级去重**。它的生命周期跟 RSC 请求绑定，在 Route Handler 里行为不保证。要请求级去重就显式传参（像 `listAchievements(today, snapshot)` 那样），语义清楚、可测。
- ⚠️ **`getSettings` 的 TTL 缓存是唯一带「一致性窗口」的改动**。已落地，窗口 = 1 秒，且只对
  「另一个进程改库」这一种情况存在（本进程写入会立即对齐缓存）。要绝对无窗口就把
  `settings.ts` 里的 `CACHE_TTL_MS` 设成 0。

---

## 八、复现命令

```bash
# 领域层算法对比（审查阶段用）
node .workbuddy/perf-bench.mjs

# 服务端取数模式对比（审查阶段用，需要先准备副本库，脚本头部有说明）
DATABASE_URL="file:C:/Users/ghy06/AppData/Local/Temp/shangan-bench/bench.db" node .workbuddy/perf-db.mjs
DATABASE_URL="file:C:/Users/ghy06/AppData/Local/Temp/shangan-bench/small.db" node .workbuddy/perf-db.mjs
```

落地后的验证脚本见 §7.2。所有脚本都**只读**或指向临时目录里的副本，不碰 `prisma/dev.db`
（唯一例外是 `verify-pragma.ts`，它就在真库上做一次幂等的 PRAGMA 下发，这本来就是应用启动时会做的事）。
