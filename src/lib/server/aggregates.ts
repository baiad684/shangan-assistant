/**
 * 统计聚合下推层：把 SUM / COUNT / MIN 交给 SQLite，不要把整表拉回来再在 JS 里 reduce。
 *
 * 动因（实测，见 PERF-REVIEW.md §3.1 / `.workbuddy/perf-db.mjs`）：
 *   统计页一次要四份聚合结果（壳层快照 / 柱状图 / 热力图 / 占比），
 *   旧实现每一份都从 listAllSessionLikes() 重新物化整张 FocusSession。
 *   3102 行时 111.7ms / 拉回 12408 行；改成 SQL 聚合后 12.5ms / 938 行。
 *   更关键的是斜率：旧方式 O(记录数)，随备考年限线性变差；这里是 O(天数×科目数)，基本恒定。
 *
 * 返回行数量级：
 *   daily*        → O(天数)
 *   subject*      → O(科目数)
 *   dailySubject* → O(天数 × 科目数)
 *
 * 纪律：日期归属（localDate）在写入时已经算好，这里只做 SUM，不碰时区。
 *       需要时区的地方（早鸟判定）仍走 domain 的 localHourOf —— 不要为了省一次
 *       groupBy 把「本地小时 = UTC 小时 + 8」抄进 SQL，那会变成第二套日期真相。
 */
import { prisma } from './db';
import { localHourOf } from '../domain/time';
import type { DailyMinutes, DaySubjectCell } from '../domain/stats';

const SUM_MINUTES = { focusMinutes: true } as const;

export interface TotalsAll {
  totalMinutes: number;
  totalSessions: number;
  /** 最早一条记录的归属日期，没有记录时为 null */
  earliest: string | null;
}

/**
 * 全量合计：三个标量一次查询拿齐。
 *
 * `_min.localDate` 与旧的 `earliestSessionDate()`（findFirst orderBy localDate asc）
 * 等价：localDate 是 'YYYY-MM-DD'，SQLite 的 MIN() 按文本比较，字典序即时间序。
 */
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
export async function dailyMinutesAll(): Promise<DailyMinutes> {
  const rows = await prisma.focusSession.groupBy({ by: ['localDate'], _sum: SUM_MINUTES });
  const out: DailyMinutes = {};
  for (const r of rows) out[r.localDate] = r._sum.focusMinutes ?? 0;
  return out;
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

/**
 * 科目总分钟（全量，含已归档科目）—— 行数 = 科目数。
 * `size` 同时就是「有记录的科目数」，替掉了旧 buildSnapshot 里的 Set 去重。
 */
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

/** 天 × 科目（区间）—— 柱状图 / 学习日历 / 每日明细用。行数 ≤ 天数 × 科目数 */
export async function dailySubjectBetween(
  from: string,
  to: string,
): Promise<DaySubjectCell[]> {
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
 * 时区换算仍交给 domain 的 localHourOf —— 口径与原 detectEarlyBird 逐字一致。
 *
 * 必须排除手动补记：它的 startedAt 是当天零点的近似值（time.localMidnightUtc），
 * 算进来会白送徽章。
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
