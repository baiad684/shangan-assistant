/**
 * 时区与日期工具 —— 全项目「今天是几号」的唯一来源。
 *
 * 纪律（见 ARCHITECTURE.md §5.2）：
 *   1. 需要「今天」「某天的归属日期」→ 只允许调用 localDateOf / todayLocalDate。
 *   2. 禁止 new Date().toISOString().slice(0, 10) —— 那是 UTC 日期，国内晚 8 点后会错一天。
 *   3. 日期字符串（YYYY-MM-DD）的加减运算一律在 UTC 数值空间里做，不构造本地 Date。
 */

export const TZ = 'Asia/Shanghai';

const D = 86_400_000;

const dateFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function fmtParts(date: Date, fmt: Intl.DateTimeFormat): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out;
}

/** 时间戳 → Asia/Shanghai 归属日期，'YYYY-MM-DD' */
export function localDateOf(date: Date | string | number = new Date()): string {
  const d = date instanceof Date ? date : new Date(date);
  const p = fmtParts(d, dateFmt);
  return `${p.year}-${pad(Number(p.month))}-${pad(Number(p.day))}`;
}

/** 今天（Asia/Shanghai） */
export function todayLocalDate(): string {
  return localDateOf(new Date());
}

/** 时间戳 → Asia/Shanghai 的 'HH:mm' */
export function localTimeOf(date: Date | string | number = new Date()): string {
  const d = date instanceof Date ? date : new Date(date);
  return timeFmt.format(d);
}

/** 时间戳 → Asia/Shanghai 的小时数（0-23），用于「早鸟」判定 */
export function localHourOf(date: Date | string | number): number {
  const d = date instanceof Date ? date : new Date(date);
  return Number(fmtParts(d, timeFmt).hour) % 24;
}

/** 日期字符串 → 星期（0 = 周日） */
export function weekdayOf(dateStr: string): number {
  const d = fromLocalDate(dateStr);
  return WEEKDAY_INDEX[weekdayFmt.format(d)] ?? 0;
}

/** 'YYYY-MM-DD' → UTC 零点的 Date（仅用于数值运算，不参与时区换算） */
export function fromLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

/** Date(UTC 空间) → 'YYYY-MM-DD'（与 toISOString 等价，但语义显式） */
function stringifyUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 日期字符串加减天数 */
export function addDays(dateStr: string, days: number): string {
  return stringifyUTC(new Date(fromLocalDate(dateStr).getTime() + days * D));
}

/** b - a，单位天 */
export function diffDays(a: string, b: string): number {
  return Math.round((fromLocalDate(b).getTime() - fromLocalDate(a).getTime()) / D);
}

/** 生成 [from, to] 闭区间内的每一天 */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  const end = fromLocalDate(to).getTime();
  let guard = 0;
  while (fromLocalDate(cur).getTime() <= end && guard++ < 5000) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * 把 [from, to] 铺成**完整自然周**的日历格子，按周分组返回。
 *
 * 区间首尾补上相邻日期的日号（补齐日不属于区间，只是让日历看起来是真的日历），
 * 所以总格子数一定是 7 的整数倍。日历组件的排布、以及「这个区间显示出来是几行」
 * 都走这一个函数，避免渲染代码里再算一套。
 */
export function calendarGrid(from: string, to: string, weekStart: 0 | 1 = 1): string[][] {
  const lead = (weekdayOf(from) - weekStart + 7) % 7;
  const gridStart = addDays(from, -lead);
  const span = diffDays(from, to) + 1;
  const tail = (7 - ((lead + span) % 7)) % 7;
  const dates = eachDate(gridStart, addDays(to, tail));

  const weeks: string[][] = [];
  for (let i = 0; i < dates.length; i += 7) weeks.push(dates.slice(i, i + 7));
  return weeks;
}

/** 所在周的起始日 */
export function startOfWeek(dateStr: string, weekStart: 0 | 1 = 1): string {
  const wd = weekdayOf(dateStr);
  const delta = (wd - weekStart + 7) % 7;
  return addDays(dateStr, -delta);
}

/** 所在月首日 */
export function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

/** 所在月末日 */
export function endOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  return stringifyUTC(last);
}

export type RangeKey = '7d' | '30d' | 'week' | 'month' | 'all';

/**
 * 把 range 展开成 [from, to] 闭区间 + 每一天的列表。
 * all 需要传入实际最早记录日期（没有记录时退化为近 7 天）。
 *
 * 注意 `week` 与 `7d` 的区别：
 * - `week` 是**完整自然周**（周一 ~ 周日），to 会落在未来。柱子按 7 根固定排布，
 *   周中看它形状不会一天一变；未来的日子没有记录，天然是 0 分钟，不影响合计。
 * - `7d` 是滚动 7 天（今天往前数），永远是已过完的日子。
 */
export function resolveRange(
  range: RangeKey,
  opts: { today?: string; weekStart?: 0 | 1; earliest?: string | null } = {},
): { from: string; to: string; dates: string[] } {
  const today = opts.today ?? todayLocalDate();
  const weekStart = opts.weekStart ?? 1;
  let from: string;
  let to = today;

  switch (range) {
    case '7d':
      from = addDays(today, -6);
      break;
    case '30d':
      from = addDays(today, -29);
      break;
    case 'week':
      from = startOfWeek(today, weekStart);
      to = addDays(from, 6);
      break;
    case 'month':
      from = startOfMonth(today);
      break;
    case 'all':
      from = opts.earliest && opts.earliest <= today ? opts.earliest : addDays(today, -6);
      break;
  }

  return { from, to, dates: eachDate(from, to) };
}

/** 距考试天数（考试当天为 0，已过为负） */
export function daysUntil(examDate: string, today = todayLocalDate()): number {
  return diffDays(today, examDate);
}

/** 中国全境不使用夏令时，偏移固定 +8。 */
export const TZ_OFFSET_HOURS = 8;

/**
 * 某天 Asia/Shanghai 00:00 对应的 UTC 时刻。
 * 手动补记没有精确时间段，用当天零点作为近似值入库（IMPLEMENTATION.md §3）。
 */
export function localMidnightUtc(dateStr: string): Date {
  return new Date(fromLocalDate(dateStr).getTime() - TZ_OFFSET_HOURS * 3_600_000);
}

/** 分钟 → 'Xh Ym' / 'Ym' */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${String(r).padStart(2, '0')}m`;
}

/** 分钟 → 'X 小时 Y 分' */
export function formatMinutesCN(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} 分钟`;
  if (r === 0) return `${h} 小时`;
  return `${h} 小时 ${r} 分`;
}

/** 秒 → 'MM:SS' 或 'H:MM:SS' */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(ss)}`;
  return `${pad(m)}:${pad(ss)}`;
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 'YYYY-MM-DD' → '9月10日 周四' */
export function formatDateCN(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}月${d}日 周${WEEKDAY_CN[weekdayOf(dateStr)]}`;
}

/** 'YYYY-MM-DD' + 时间戳 → 'HH:mm'（用于完成记录列表） */
export function createdAtLabel(iso: string): string {
  return localTimeOf(iso);
}
