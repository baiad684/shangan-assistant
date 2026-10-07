/**
 * 统计服务：把 domain 的纯聚合函数与数据库接起来。
 *
 * 存在的意义是让路由处理器保持「极薄」—— 路由只解析参数，形状组装都在这里。
 * 同时保证「周/月柱状图」「热力图」「科目占比」「科目总时长」四处的口径
 * 全部来自同一批聚合结果（IMPLEMENTATION.md §4.6 明确要求规模不漂移）。
 *
 * 取数纪律：SUM / COUNT 下推到 SQL（见 aggregates.ts），JS 侧只做形状组装。
 * 旧实现是「物化整表 × N + JS 聚合」，代价随记录数线性增长；现在是 O(天数×科目数)。
 */
import {
  dailyMinutesBetween,
  dailySubjectBetween,
  subjectMinutesAll,
  subjectMinutesBetween,
  totalsAll,
} from './aggregates';
import { listSubjectLikes } from './data';
import {
  heatmapLevel,
  stackedByDayFromCells,
  subjectTotalsFromSums,
  totalMinutesOfDaily,
} from '../domain/stats';
import { addDays, eachDate, resolveRange, todayLocalDate, weekdayOf, type RangeKey } from '../domain/time';
import {
  CHECKIN_MINUTES,
  PASS_MINUTES,
  DEFAULT_SETTINGS,
  type HeatCell,
  type SeriesDef,
  type SliceDatum,
  type StackedPoint,
} from '../types';
import { getSettings } from './settings';

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 柱状图横轴标签：周视图用「周一」，月/多日视图用「9/10」 */
function labelFor(date: string, mode: 'weekday' | 'date'): string {
  if (mode === 'weekday') return `周${WEEKDAY_CN[weekdayOf(date)]}`;
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

async function settingsSafe() {
  try {
    return await getSettings();
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export interface SummaryResult {
  range: RangeKey;
  from: string;
  to: string;
  /**
   * 服务端的「今天」（Asia/Shanghai）。必须由服务端给：week 区间的 to 会落在未来
   * （完整自然周），前端只有拿到这个值才能把「还没到的日子」和「没学的日子」分开画。
   */
  today: string;
  /**
   * 周起始日（0=周日 1=周一），来自设置。
   * 必须回传：日历与热力图的行首要跟「本周」的定义对齐，
   * 否则用户把每周起始日改成周日后，日历仍从周一排 —— 两处说法打架。
   */
  weekStart: 0 | 1;
  dates: string[];
  points: StackedPoint[];
  series: SeriesDef[];
  dailyTotals: Array<{ date: string; minutes: number; checkedIn: boolean; passed: boolean }>;
  subjectTotals: Array<SliceDatum & { subjectId: number }>;
  totalMinutes: number;
  /** 备考全程累计（与 range 无关，供「科目总时长」卡片复用同一聚合结果） */
  allTimeTotalMinutes: number;
  allTimeSubjectTotals: Array<SliceDatum & { subjectId: number }>;
}

export async function summaryData(rangeInput: string | null, today = todayLocalDate()): Promise<SummaryResult> {
  const range = normalizeRange(rangeInput);

  // 三份互不依赖的取数并发：设置 / 科目 / 全量标量（earliest 也在里面，
  // 因此不再需要单独的 earliestSessionDate()）
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
   * 全量科目合计与它互不依赖，一起并发。
   */
  const [cells, allSubjectMinutes] = await Promise.all([
    dailySubjectBetween(from, to),
    subjectMinutesAll(),
  ]);

  const rangeDaily: Record<string, number> = {};
  for (const date of dates) rangeDaily[date] = 0;
  const rangeBySubject = new Map<number, number>();
  for (const c of cells) {
    // 聚合格理论上都在区间内，但 dates 是唯一权威，落在外面的直接丢
    if (rangeDaily[c.localDate] === undefined) continue;
    rangeDaily[c.localDate] += c.minutes;
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
      const minutes = rangeDaily[date] ?? 0;
      return {
        date,
        minutes,
        checkedIn: minutes >= CHECKIN_MINUTES,
        passed: minutes >= PASS_MINUTES,
      };
    }),
    subjectTotals: subjectTotalsFromSums(rangeBySubject, subjects),
    totalMinutes: totalMinutesOfDaily(rangeDaily),
    allTimeTotalMinutes: totals.totalMinutes,
    allTimeSubjectTotals: subjectTotalsFromSums(allSubjectMinutes, subjects),
  };
}

function normalizeRange(value: string | null): RangeKey {
  const allowed: RangeKey[] = ['7d', '30d', 'week', 'month', 'all'];
  return allowed.includes(value as RangeKey) ? (value as RangeKey) : 'week';
}

export interface HeatmapResult {
  mode: '6m' | 'all';
  from: string;
  to: string;
  cells: HeatCell[];
  /** 周起始日（0=周日 1=周一）—— 热力图的每一行代表星期几，行首必须对齐设置 */
  weekStart: 0 | 1;
  /** 总览指标，热力图卡片下方一行字用 */
  totalMinutes: number
  activeDays: number;
  maxDayMinutes: number;
}

export async function heatmapData(modeInput: string | null, today: string): Promise<HeatmapResult> {
  const mode: '6m' | 'all' = modeInput === 'all' ? 'all' : '6m';
  const [settings, totals] = await Promise.all([settingsSafe(), totalsAll()]);

  // 近 6 个月 ≈ 26 周。all 模式从最早记录起算，所以需要 totals.earliest
  const from = mode === 'all' && totals.earliest ? totals.earliest : addDays(today, -26 * 7);

  // 区间内的天级汇总：行数 = 有记录的天数，不是记录条数
  const daily = await dailyMinutesBetween(from, today);

  const cells: HeatCell[] = eachDate(from, today).map((date) => {
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

export interface ShareResult {
  range: RangeKey;
  from: string;
  to: string;
  slices: Array<SliceDatum & { subjectId: number; pct: number }>;
  totalMinutes: number;
}

export async function shareData(rangeInput: string | null, today: string): Promise<ShareResult> {
  const allowed: RangeKey[] = ['7d', '30d', 'all'];
  const range: RangeKey = allowed.includes(rangeInput as RangeKey)
    ? (rangeInput as RangeKey)
    : '30d';

  const [subjects, totals] = await Promise.all([listSubjectLikes(), totalsAll()]);

  const { from, to } = resolveRange(range, { earliest: totals.earliest });

  // 区间内的科目汇总：行数 = 科目数
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
