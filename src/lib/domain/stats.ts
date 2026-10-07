/**
 * 统计聚合与快照（IMPLEMENTATION.md §4.6 / §4.1）
 *
 * 全部为纯函数：输入是已经从数据库取出的普通对象，输出是可直接喂给图表/徽章判定的数据。
 * 好处是这些口径可以脱离数据库被断言（见 scripts/selftest.ts），
 * 也保证「连续天数」「热力图」「成就判定」三处永远不会各算一套。
 */

import {
  CHECKIN_MINUTES,
  PASS_MINUTES,
  type HeatCell,
  type SliceDatum,
  type StackedPoint,
  type StatsSnapshot,
  type SeriesDef,
} from '../types';
import { localHourOf } from './time';
import { currentStreak, longestStreak } from './streak';

export interface SessionLike {
  localDate: string;
  focusMinutes: number;
  subjectId: number;
  startedAt: string; // ISO
  source: string;
}

export interface SubjectLike {
  id: number;
  name: string;
  color: string;
  archived?: boolean;
}

/** 热力图分档（架构决策 D11：把「有记录但未满 1h」单独成档，避免 <1h 显示为空） */
export function heatmapLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;
  if (minutes < CHECKIN_MINUTES) return 1;
  if (minutes < PASS_MINUTES) return 2;
  if (minutes < 480) return 3;
  return 4;
}

export function totalMinutes(sessions: SessionLike[]): number {
  return sessions.reduce((sum, s) => sum + s.focusMinutes, 0);
}

/** 归属日期 → 当日专注总分钟 */
export function dailyTotals(sessions: SessionLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sessions) {
    out[s.localDate] = (out[s.localDate] ?? 0) + s.focusMinutes;
  }
  return out;
}

/** 单日峰值 */
export function maxDayMinutes(dailyMinutes: Record<string, number>): number {
  // 不用 Math.max(...values)：实参是逐个压栈的，十万级就会抛
  // RangeError: Maximum call stack size exceeded（实测 30 万必炸）。
  // 这里 values 的长度是「有记录的天数」，现实到不了 —— 但循环版没有悬崖，且不慢。
  let max = 0;
  for (const v of Object.values(dailyMinutes)) {
    if (v > max) max = v;
  }
  return max;
}

/** 按科目汇总，按分钟降序。含已归档科目（历史统计保留）。 */
export function subjectTotals(
  sessions: SessionLike[],
  subjects: SubjectLike[],
): Array<SliceDatum & { subjectId: number }> {
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const acc = new Map<number, number>();
  for (const s of sessions) {
    acc.set(s.subjectId, (acc.get(s.subjectId) ?? 0) + s.focusMinutes);
  }
  return [...acc.entries()]
    .filter(([, v]) => v > 0)
    .map(([subjectId, value]) => {
      const sub = byId.get(subjectId);
      return {
        subjectId,
        label: sub?.name ?? '已删除科目',
        color: sub?.color ?? '#94a3b8',
        value,
      };
    })
    .sort((a, b) => b.value - a.value);
}

/** 折线/柱状图数据：按天 × 科目堆叠 */
export function stackedByDay(
  sessions: SessionLike[],
  dates: string[],
  subjects: SubjectLike[],
  labelOf: (date: string) => string,
): { points: StackedPoint[]; series: SeriesDef[] } {
  const activeIds = new Set<number>();
  // 用 Map 做「日期是否在区间内」的判定：O(1)。
  // 原来是 dates.includes(s.localDate)，对每条记录线性扫一遍日期数组 —— O(N×M)，
  // 实测 30000 条记录 × 30 天时 2.43ms（改后 0.59ms）。桶同时兼职结果容器，
  // 顺带解决了原实现每次命中都要 bucket.get + bucket.set 两次哈希的问题。
  const bucket = new Map<string, Record<string, number>>();
  for (const date of dates) bucket.set(date, {});

  for (const s of sessions) {
    const row = bucket.get(s.localDate);
    if (row === undefined) continue; // 等价于原来的 !dates.includes(...)
    activeIds.add(s.subjectId);
    const key = `s${s.subjectId}`;
    row[key] = (row[key] ?? 0) + s.focusMinutes;
  }

  // series 只列出区间内真正有数据的科目，避免图例出现一排 0
  const series: SeriesDef[] = subjects
    .filter((s) => activeIds.has(s.id))
    .map((s) => ({ key: `s${s.id}`, label: s.name, color: s.color }));
  if (series.length === 0) {
    // 空区间也要有图例骨架，否则图表渲染不出坐标系
    series.push({ key: 'empty', label: '暂无记录', color: '#e2e8f0' });
  }

  const points: StackedPoint[] = dates.map((date) => ({
    label: labelOf(date),
    values: bucket.get(date) ?? {},
    meta: date,
  }));

  return { points, series };
}

/** 热力图数据（含无记录的空白天） */
export function heatmapCells(sessions: SessionLike[], dates: string[]): HeatCell[] {
  const daily = dailyTotals(sessions);
  return dates.map((date) => {
    const minutes = daily[date] ?? 0;
    return { date, minutes, level: heatmapLevel(minutes) };
  });
}

/**
 * 是否有「某天第一段专注在 7:00 前开始」（早鸟徽章）
 *
 * 关键：手动补记的 startedAt 是当天零点的近似值（见 time.localMidnightUtc），
 * 若把它算进来，补记一次就白送一个早鸟徽章。所以这里只看真实计时的番茄钟记录。
 */
export function detectEarlyBird(sessions: SessionLike[]): boolean {
  const earliest = new Map<string, number>();
  for (const s of sessions) {
    if (s.source === 'manual') continue;
    const t = new Date(s.startedAt).getTime();
    const prev = earliest.get(s.localDate);
    if (prev === undefined || t < prev) earliest.set(s.localDate, t);
  }
  for (const t of earliest.values()) {
    if (localHourOf(t) < 7) return true;
  }
  return false;
}

/** 成就判定与统计页共用的预聚合快照 */
export function buildSnapshot(
  sessions: SessionLike[],
  subjects: SubjectLike[],
  today: string,
): StatsSnapshot {
  const daily = dailyTotals(sessions);
  const recordedSubjectIds = new Set(sessions.map((s) => s.subjectId));

  return {
    totalSessions: sessions.length,
    totalMinutes: totalMinutes(sessions),
    dailyMinutes: daily,
    maxDayMinutes: maxDayMinutes(daily),
    // 只要有过专注记录就计入，即使科目后来被归档/删除
    subjectCount: recordedSubjectIds.size,
    currentStreak: currentStreak(daily, today, CHECKIN_MINUTES),
    longestStreak: longestStreak(daily, CHECKIN_MINUTES),
    currentPassStreak: currentStreak(daily, today, PASS_MINUTES),
    longestPassStreak: longestStreak(daily, PASS_MINUTES),
    hasEarlyBird: detectEarlyBird(sessions),
  };
}

/** 空快照，数据库中还没有任何记录时使用 */
export const EMPTY_SNAPSHOT = (today: string): StatsSnapshot => ({
  totalSessions: 0,
  totalMinutes: 0,
  dailyMinutes: {},
  maxDayMinutes: 0,
  subjectCount: 0,
  currentStreak: 0,
  longestStreak: 0,
  currentPassStreak: 0,
  longestPassStreak: 0,
  hasEarlyBird: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// 聚合入表版：输入是「SQL 已经算好的小结果集」，不是原始记录行
//
// 上面那批函数接收 SessionLike[]，隐含了「把整张 FocusSession 拉进内存」这个前提。
// 统计页一次要四份聚合（壳层快照 / 柱状图 / 热力图 / 占比），旧的取数方式就是
// 每种聚合都把整表物化一遍 —— 代价随备考年限线性变差（实测 3102 行 111.7ms，
// 50102 行 1707.6ms）。
//
// 下面这几个函数与上面同口径同形状，但入参改成 SQL GROUP BY 的结果：
//   按天汇总 → 行数 O(天数)
//   按科目汇总 → 行数 O(科目数)
//   天 × 科目 → 行数 O(天数 × 科目数)
// 三者都与「记录条数」解耦。上面的原函数全部保留：selftest 与图表预览脚本直接断言它们。
// ─────────────────────────────────────────────────────────────────────────────

/** 一组「天 × 科目」的聚合格（来自 SQL GROUP BY localDate, subjectId） */
export interface DaySubjectCell {
  localDate: string;
  subjectId: number;
  minutes: number;
}

/** 按天汇总的聚合结果 */
export type DailyMinutes = Record<string, number>;

/** 由「按天求和」求累计 —— 与 totalMinutes(sessions) 同口径 */
export function totalMinutesOfDaily(dailyMinutes: DailyMinutes): number {
  let sum = 0;
  for (const key in dailyMinutes) sum += dailyMinutes[key];
  return sum;
}

/**
 * 把「天 × 科目」聚合格折叠成「每天总分钟」。
 * 区间外的格子（例如日历补首尾补出来的空白日）在这里被自然丢弃。
 */
export function dailyFromCells(cells: ReadonlyArray<DaySubjectCell>, dates?: string[]): DailyMinutes {
  const out: DailyMinutes = {};
  if (dates) for (const d of dates) out[d] = 0;
  for (const c of cells) {
    if (dates && out[c.localDate] === undefined) continue;
    out[c.localDate] = (out[c.localDate] ?? 0) + c.minutes;
  }
  return out;
}

/** 把「天 × 科目」聚合格折叠成「科目 → 总分钟」 */
export function subjectSumsFromCells(
  cells: ReadonlyArray<DaySubjectCell>,
): Map<number, number> {
  const acc = new Map<number, number>();
  for (const c of cells) acc.set(c.subjectId, (acc.get(c.subjectId) ?? 0) + c.minutes);
  return acc;
}

/**
 * 由「天 × 科目」聚合格构造堆叠柱状图数据。
 *
 * 与 stackedByDay 逐字同口径（相同的 series 筛选规则、相同的空图例兜底、相同的
 * values 键名），差别只在入参：这里不接触原始记录行，所以不会随记录数变慢。
 */
export function stackedByDayFromCells(
  cells: ReadonlyArray<DaySubjectCell>,
  dates: string[],
  subjects: SubjectLike[],
  labelOf: (date: string) => string,
): { points: StackedPoint[]; series: SeriesDef[] } {
  const bucket = new Map<string, Record<string, number>>();
  for (const date of dates) bucket.set(date, {});
  const activeIds = new Set<number>();

  for (const c of cells) {
    const row = bucket.get(c.localDate);
    if (row === undefined) continue; // 区间外的格子直接丢弃，O(1)
    activeIds.add(c.subjectId);
    const key = `s${c.subjectId}`;
    row[key] = (row[key] ?? 0) + c.minutes;
  }

  const series: SeriesDef[] = subjects
    .filter((s) => activeIds.has(s.id))
    .map((s) => ({ key: `s${s.id}`, label: s.name, color: s.color }));
  if (series.length === 0) series.push({ key: 'empty', label: '暂无记录', color: '#e2e8f0' });

  return {
    points: dates.map((date) => ({
      label: labelOf(date),
      values: bucket.get(date) ?? {},
      meta: date,
    })),
    series,
  };
}

/**
 * 由「科目 → 分钟」的汇总构造占比切片。与 subjectTotals 同口径：
 * 丢掉 0 值、已归档科目回落到「已删除科目」、按分钟降序。
 *
 * 同分时的次序按 subjectId 升序定序（subjectTotals 依赖 Map 插入序，同分次序
 * 取决于首次出现的位置）。这里显式定序只是为了让结果可复现，数值不受影响。
 */
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
  return out.sort((a, b) => b.value - a.value || a.subjectId - b.subjectId);
}

/**
 * 由「按天求和」+ 少量标量构造快照。与 buildSnapshot 同口径，
 * 但输入是 O(天数) 的聚合结果，而不是 O(记录数) 的行列表。
 *
 * buildSnapshot 保留不动（selftest 直接断言它），两者由 selftest 交叉验证一致。
 */
export function buildSnapshotFromDaily(
  dailyMinutes: DailyMinutes,
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
