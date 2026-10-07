/**
 * 领域层自测。
 *
 *   npm run selftest
 *
 * 这个脚本能存在，正是「domain 层零 IO」这条架构约束的回报：
 * 不需要起数据库、不需要浏览器，几毫秒就能把最容易出错的口径全部验一遍。
 * 尤其是「锁屏 20 分钟后番茄钟是否还准」这种在真机上极难复现的场景。
 */
import { addDays, calendarGrid, daysUntil, diffDays, eachDate, formatClock, formatMinutes, localDateOf, localMidnightUtc, localHourOf, resolveRange, startOfWeek, weekdayOf } from '../src/lib/domain/time';
import { cumulativeXpForLevel, resolveLevel, xpForNextLevel } from '../src/lib/domain/leveling';
import { computeStreak } from '../src/lib/domain/streak';
import { buildSnapshot, dailyFromCells, heatmapCells, heatmapLevel, maxDayMinutes, stackedByDay, stackedByDayFromCells, subjectSumsFromCells, subjectTotals, subjectTotalsFromSums, totalMinutesOfDaily, buildSnapshotFromDaily, totalMinutes } from '../src/lib/domain/stats';
import { BADGES, evaluate, newlyUnlocked } from '../src/lib/domain/achievements';
import {
  createState,
  elapsedSeconds,
  isComplete,
  markDone,
  pause,
  progress,
  remainingSeconds,
  resume,
  settle,
  start,
} from '../src/lib/domain/pomodoro';
import type { SessionLike } from '../src/lib/domain/stats';
import type { ErrorCode } from '../src/lib/types';
import { ApiClientError, classifySubmissionError, isOffline } from '../src/lib/api-client';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, extra?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
    if (extra !== undefined) console.log(`      实际: ${JSON.stringify(extra)}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(name, Object.is(actual, expected), { actual, expected });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── 时区与日期 ─────────────────────────────────────────────────────────
section('时区与日期（Asia/Shanghai 切日）');

// 北京时间 9/11 00:30 = UTC 9/10 16:30，必须归属 9/11
eq('UTC 16:30Z 归到次日', localDateOf('2026-09-10T16:30:00Z'), '2026-09-11');
// 北京时间 9/10 07:59 = UTC 9/9 23:59，仍属 9/10
eq('UTC 前一日 23:59Z 仍属当天', localDateOf('2026-09-09T23:59:00Z'), '2026-09-10');

eq('日期加天', addDays('2026-09-30', 1), '2026-10-01');
eq('跨月减天', addDays('2026-03-01', -1), '2026-02-28');
eq('闰年 2 月', addDays('2028-02-28', 1), '2028-02-29');
eq('跨年加天', addDays('2026-12-31', 1), '2027-01-01');

eq('区间长度（含首尾）', eachDate('2026-09-01', '2026-09-07').length, 7);
eq('周一为周起始', startOfWeek('2026-09-10', 1), '2026-09-07');
eq('周日为周起始', startOfWeek('2026-09-10', 0), '2026-09-06');
eq('距考试天数', daysUntil('2027-12-18', '2027-12-10'), 8);
eq('考试当天为 0', daysUntil('2027-12-18', '2027-12-18'), 0);

// 2026-09-10 是周四；近 7 天应含首尾共 7 天
const r7 = resolveRange('7d', { today: '2026-09-10' });
eq('近 7 天起点', r7.from, '2026-09-04');
eq('近 7 天天数', r7.dates.length, 7);

// 「本周」按完整自然周展开：周一 ~ 周日，to 落在未来（周四看周日）
const rw = resolveRange('week', { today: '2026-09-10' });
eq('本周起点是周一', rw.from, '2026-09-07');
eq('本周终点是周日（未来）', rw.to, '2026-09-13');
eq('本周固定 7 天', rw.dates.length, 7);
eq('本周第一天是周一', weekdayOf(rw.from), 1);
eq('本周最后一天是周日', weekdayOf(rw.to), 0);
check('今天落在本周内', rw.dates.includes('2026-09-10'));
// 周日当天看，仍应是同一个自然周（to 不会因为过了周六而漂移）
const rwSun = resolveRange('week', { today: '2026-09-13' });
eq('周日看仍是同一周', `${rwSun.from}~${rwSun.to}`, '2026-09-07~2026-09-13');
// 周起始设为周日时，整周要跟着平移
const rwSunStart = resolveRange('week', { today: '2026-09-10', weekStart: 0 });
eq('周日起始的周起点', rwSunStart.from, '2026-09-06');
eq('周日起始的周终点', rwSunStart.to, '2026-09-12');
// 7d 与 week 的差别：7d 永远是已过完的 7 天，不落在未来
eq('近 7 天终点是今天', r7.to, '2026-09-10');
eq('近 7 天起点是上周五', weekdayOf(r7.from), 5);

// 手动补记的零点近似值：北京时间 9/10 00:00 = UTC 9/9 16:00
eq('本地零点转 UTC', localMidnightUtc('2026-09-10').toISOString(), '2026-09-09T16:00:00.000Z');
eq('本地小时（清晨）', localHourOf('2026-09-09T22:30:00Z'), 6);
eq('本地小时（午后）', localHourOf('2026-09-10T06:00:00Z'), 14);

eq('时长格式 1', formatMinutes(125), '2h 05m');
eq('时长格式 2', formatMinutes(45), '45m');
eq('时长格式 3', formatMinutes(120), '2h');
eq('倒计时格式', formatClock(2725), '45:25');

// ── 日历格子（学习日历用） ─────────────────────────────────────────────
section('日历格子（首尾补齐到完整自然周）');

/** 用同一条断言覆盖任意区间：整周、覆盖区间、对齐、无重复 */
function checkGrid(title: string, from: string, to: string, weekStart: 0 | 1 = 1) {
  const weeks = calendarGrid(from, to, weekStart);
  const flat = weeks.flat();
  const inRange = flat.filter((d) => d >= from && d <= to);
  const ok =
    flat.length % 7 === 0 &&
    weeks.every((w) => w.length === 7) &&
    inRange.length === diffDays(from, to) + 1 &&
    inRange[0] === from &&
    inRange.at(-1) === to &&
    weekdayOf(flat[0]) === weekStart &&
    new Set(flat).size === flat.length;
  check(
    `${title}（${from}~${to} → ${flat.length} 格 / ${weeks.length} 周）`,
    ok,
    { gridStart: flat[0], gridEnd: flat.at(-1), inRange: inRange.length },
  );
}

checkGrid('跨月的 30 天（周三~周三）', '2026-08-12', '2026-09-10');
checkGrid('跨 5 周的 30 天', '2026-08-11', '2026-09-09');
checkGrid('跨 6 周（周日~周一）', '2026-02-01', '2026-03-02');
checkGrid('整周', '2026-09-07', '2026-09-13');
checkGrid('单天', '2026-09-10', '2026-09-10');
checkGrid('周日起始', '2026-08-12', '2026-09-10', 0);

// ── 番茄钟状态机 ───────────────────────────────────────────────────────
section('番茄钟（时间戳差值，锁屏不跑偏）');

const T0 = Date.parse('2026-09-10T01:00:00Z');
let s = createState(1, 45, 'test-client-id');
eq('初始剩余 = 45 分钟', remainingSeconds(s, T0), 45 * 60);
eq('初始进度 0', progress(s, T0), 0);

s = start(s, T0);
// 模拟锁屏 20 分钟：期间没有任何一次 tick
eq('锁屏 20 分钟后剩余 25 分钟', remainingSeconds(s, T0 + 20 * 60_000), 25 * 60);
check('锁屏 20 分钟未到点', !isComplete(s, T0 + 20 * 60_000));

// 继续到 45 分钟整 → 应判定完成
eq('45 分钟到点剩余 0', remainingSeconds(s, T0 + 45 * 60_000), 0);
check('45 分钟到点判定完成', isComplete(s, T0 + 45 * 60_000));
eq('进度封顶为 1', progress(s, T0 + 50 * 60_000), 1);

// 暂停 10 分钟后恢复，剩余时间不应被暂停吃掉
let p = createState(1, 45, 'cid');
p = start(p, T0);
p = pause(p, T0 + 10 * 60_000); // 专注 10 分钟
eq('暂停时已专注 10 分钟', elapsedSeconds(p, T0 + 10 * 60_000), 600);
p = resume(p, T0 + 20 * 60_000); // 暂停了 10 分钟
eq('恢复瞬间剩余仍为 35 分钟（暂停不计）', remainingSeconds(p, T0 + 20 * 60_000), 35 * 60);
eq('再跑 35 分钟即到点', remainingSeconds(p, T0 + 55 * 60_000), 0);
check('跨暂停后正确完成', isComplete(p, T0 + 55 * 60_000));

// 中断：实际专注 12 分钟即放弃
let ab = createState(2, 45, 'cid-abort');
ab = start(ab, T0);
const aborted = settle(ab, false, T0 + 12 * 60_000);
eq('中断记录的实际分钟', aborted?.focusMinutes, 12);
eq('中断保留原定计划', aborted?.plannedMinutes, 45);
eq('中断来源标记', aborted?.source, 'stopped_early');

// 完成后结算
let fin = createState(3, 45, 'cid-done');
fin = start(fin, T0);
fin = markDone(fin, T0 + 45 * 60_000);
const done = settle(fin, true, T0 + 45 * 60_000);
eq('完成记录 45 分钟', done?.focusMinutes, 45);
eq('完成来源标记', done?.source, 'pomodoro');

// 刚开始 5 秒就放弃 → 不足 1 分钟，不予记录
let tiny = createState(1, 45, 'cid-tiny');
tiny = start(tiny, T0);
eq('不足 1 分钟不生成记录', settle(tiny, false, T0 + 5_000), null);

// ── 回归：开局三坑（都是真实踩过的）──────────────────────────────────
section('番茄钟回归：开始时间 / 暂停时长 / 未选科目');

// 坑 1：startedAt 必须在「按下开始」那一刻盖章，而不是准备好那一刻。
// 否则先选科目、过 30 分钟再开始，记录的开始时间会偏早 30 分钟，
// 还会让「早鸟」（7:00 前开始）徽章误判。
const prepared = createState(1, 45, 'cid-stamp');
eq('准备好时尚未盖章 startedAt', prepared.startedAtIso, null);
eq('未开始就不能结算', settle(prepared, true, T0), null);
const started30 = start(prepared, T0 + 30 * 60_000);
eq(
  '开始后才盖章，且等于开始时刻',
  started30.startedAtIso,
  new Date(T0 + 30 * 60_000).toISOString(),
);

// 坑 2：pausedSeconds 必须记「暂停了多久」，不是「暂停前专注了多久」。
// 早期实现把本段专注时长当暂停时长，用户一暂停就显示「已暂停 10 分钟」。
let pz = createState(1, 45, 'cid-pause');
pz = start(pz, T0);
pz = pause(pz, T0 + 10 * 60_000); // 专注 10 分钟后暂停
eq('刚暂停时暂停时长应为 0（不是 10 分钟）', pz.pausedSeconds, 0);
pz = resume(pz, T0 + 25 * 60_000); // 暂停了 15 分钟
eq('恢复后累计暂停时长 = 15 分钟', pz.pausedSeconds, 15 * 60);
eq('状态机的 pausedAt 已清空', pz.pausedAt, null);

let pz2 = createState(1, 45, 'cid-pause2');
pz2 = start(pz2, T0);
pz2 = pause(pz2, T0 + 5 * 60_000);
pz2 = resume(pz2, T0 + 8 * 60_000); // 第一次暂停 3 分钟
pz2 = pause(pz2, T0 + 20 * 60_000);
pz2 = resume(pz2, T0 + 30 * 60_000); // 第二次暂停 10 分钟
eq('多次暂停的时长应累加（3+10=13 分钟）', pz2.pausedSeconds, 13 * 60);

// 暂停中直接结算，进行中的这段暂停也要算进去
let pz3 = createState(1, 45, 'cid-pause3');
pz3 = start(pz3, T0);
pz3 = pause(pz3, T0 + 6 * 60_000);
const pausedSettle = settle(pz3, false, T0 + 6 * 60_000 + 4 * 60_000);
eq('暂停中结算也计入进行中的暂停', pausedSettle?.pausedSeconds, 4 * 60);

// 坑 3：未选科目必须用 null，不能用 0 —— 0 会被服务端 positive() 判为非法。
// 同时 confirm 未选科目时不能生成记录（否则会提交 subjectId=0 被 422 拒掉）。
const noSubject = createState(null, 45, 'cid-nosub');
eq('未选科目时可创建 idle 状态', noSubject.subjectId, null);
let ns = start(noSubject, T0);
ns = markDone(ns, T0 + 45 * 60_000);
eq('未选科目不生成记录（而非生成 subjectId=0 的脏记录）', settle(ns, true, T0 + 45 * 60_000), null);

// ── 连续打卡 ───────────────────────────────────────────────────────────
section('连续打卡天数（含当天宽限）');

const daily = (map: Record<string, number>) => map;

// 9/1 ~ 9/5 连续达标，今天 9/6 还没学
const gapToday = daily({ '2026-09-01': 60, '2026-09-02': 90, '2026-09-03': 60, '2026-09-04': 120, '2026-09-05': 60 });
eq('今天未达标时，从昨天数（宽限）', computeStreak(gapToday, '2026-09-06').current, 5);
eq('补上今天则 +1', computeStreak({ ...gapToday, '2026-09-06': 61 }, '2026-09-06').current, 6);
eq('今天只有 59 分钟不算打卡', computeStreak({ ...gapToday, '2026-09-06': 59 }, '2026-09-06').current, 5);

// 中间断了一天（9/3 只有 10 分钟）
const broken = daily({ '2026-09-01': 60, '2026-09-02': 60, '2026-09-03': 10, '2026-09-04': 60, '2026-09-05': 60 });
eq('断链后只算最后一段', computeStreak(broken, '2026-09-05').current, 2);
eq('历史最长不受影响', computeStreak(broken, '2026-09-05').longest, 2);

// 断在很久以前：今天和昨天都没学 → 应为 0，不能因为古老记录还在而误报
const stale = daily({ '2026-01-01': 300, '2026-01-02': 300 });
eq('很久以前达标不影响当前连续数', computeStreak(stale, '2026-09-10').current, 0);
eq('历史最长仍保留', computeStreak(stale, '2026-09-10').longest, 2);

eq('空数据为 0', computeStreak({}, '2026-09-10').current, 0);

// ── XP 与等级 ──────────────────────────────────────────────────────────
section('XP 与等级曲线');

eq('Lv1→2 需 120 XP（≈2 小时）', xpForNextLevel(1), 120);
eq('Lv2→3 需 168 XP', xpForNextLevel(2), 168);
// 累计 = 120 + 168 + 235 + 329 = 852
eq('Lv5 累计需求', cumulativeXpForLevel(5), 852);
eq('Lv1 累计需求为 0', cumulativeXpForLevel(1), 0);
check(
  '曲线前期快后期慢（每一级增量严格递增）',
  Array.from({ length: 9 }, (_, i) => xpForNextLevel(i + 1)).every((v, i, arr) => i === 0 || v > arr[i - 1]),
);
check(
  'Lv1→2 恰为 2 小时（符合 IMPLEMENTATION.md §4.7）',
  xpForNextLevel(1) === 120,
);
eq('0 XP 是 1 级', resolveLevel(0).level, 1);
eq('119 XP 仍是 1 级', resolveLevel(119).level, 1);
eq('120 XP 升到 2 级', resolveLevel(120).level, 2);
eq('2 级内进度', Math.round(resolveLevel(120 + 84).progress * 100), 50);
eq('等级标题', resolveLevel(500).title, resolveLevel(500).title);
check('等级单调不降', [0, 119, 120, 500, 5000, 100000].every((xp, i, arr) => i === 0 || resolveLevel(xp).level >= resolveLevel(arr[i - 1]).level));

// ── 统计与热力图分档 ───────────────────────────────────────────────────
section('统计聚合与热力图分档');

eq('热力图 0 分钟 = 空', heatmapLevel(0), 0);
eq('热力图 30 分钟 = 1 档（有记录未打卡）', heatmapLevel(30), 1);
eq('热力图 60 分钟 = 2 档（打卡线）', heatmapLevel(60), 2);
eq('热力图 119 分钟 = 2 档', heatmapLevel(119), 2);
eq('热力图 120 分钟 = 3 档（达标线）', heatmapLevel(120), 3);
eq('热力图 480 分钟 = 4 档（目标线）', heatmapLevel(480), 4);

const sample: SessionLike[] = [
  { localDate: '2026-09-08', focusMinutes: 60, subjectId: 1, startedAt: '2026-09-08T01:00:00Z', source: 'pomodoro' },
  { localDate: '2026-09-08', focusMinutes: 60, subjectId: 2, startedAt: '2026-09-08T02:00:00Z', source: 'pomodoro' },
  { localDate: '2026-09-09', focusMinutes: 120, subjectId: 1, startedAt: '2026-09-09T01:00:00Z', source: 'pomodoro' },
];
const cells = heatmapCells(sample, ['2026-09-07', '2026-09-08', '2026-09-09']);
eq('热力图天数补齐', cells.length, 3);
eq('无记录日为空档', cells[0].level, 0);
eq('2 小时日落在 3 档', cells[2].level, 3);

const stack = stackedByDay(sample, ['2026-09-08', '2026-09-09'], [{ id: 1, name: '政治', color: '#f00' }, { id: 2, name: '英语', color: '#0f0' }], (d) => d);
eq('图例只列有数据的科目', stack.series.length, 2);
eq('9/8 堆叠合计', (stack.points[0].values.s1 ?? 0) + (stack.points[0].values.s2 ?? 0), 120);

const snap = buildSnapshot(sample, [{ id: 1, name: '政治', color: '#f00' }, { id: 2, name: '英语', color: '#0f0' }], '2026-09-09');
eq('快照累计分钟', snap.totalMinutes, 240);
eq('快照科目数', snap.subjectCount, 2);
eq('快照连续天数', snap.currentStreak, 2);
eq('快照单日峰值', snap.maxDayMinutes, 120);

// ── 聚合入表版 vs 原始行版：两条路径必须逐字同口径 ────────────────────
// 这是这次性能改造最要紧的护栏：服务端现在把 SUM 下推到 SQL（aggregates.ts），
// 只把「天 × 科目」的小结果集交给 JS。如果两套实现口径漂了，页面数字就会静默错掉。
section('聚合入表版与原始行版口径一致');

const SUBJ = [{ id: 1, name: '政治', color: '#f00' }, { id: 2, name: '英语', color: '#0f0' }];
const DATES = ['2026-09-07', '2026-09-08', '2026-09-09'];
const label = (d: string) => d;

// 由原始行手工折出 SQL 会返回的那种聚合格（含一条区间外记录，验证丢弃逻辑）
const rowsToCells = (rows: SessionLike[]) =>
  rows.map((r) => ({ localDate: r.localDate, subjectId: r.subjectId, minutes: r.focusMinutes }));
const sampleOutOfRange: SessionLike[] = [
  ...sample,
  { localDate: '2026-01-01', focusMinutes: 999, subjectId: 1, startedAt: '2026-01-01T01:00:00Z', source: 'pomodoro' },
];

const stackA = stackedByDay(sample, DATES, SUBJ, label);
const stackB = stackedByDayFromCells(rowsToCells(sample), DATES, SUBJ, label);
eq('堆叠图 points 完全相同', JSON.stringify(stackA.points), JSON.stringify(stackB.points));
eq('堆叠图 series 完全相同', JSON.stringify(stackA.series), JSON.stringify(stackB.series));

// 区间外的行：两条路径都必须丢掉
const stackC = stackedByDayFromCells(rowsToCells(sampleOutOfRange), DATES, SUBJ, label);
eq('聚合格也丢弃区间外的天', JSON.stringify(stackC.points), JSON.stringify(stackA.points));

// 空区间兜底图例
const emptyA = stackedByDay([], DATES, SUBJ, label);
const emptyB = stackedByDayFromCells([], DATES, SUBJ, label);
eq('空区间图例兜底一致', JSON.stringify(emptyA.series), JSON.stringify(emptyB.series));

// 占比：同口径（同样的丢 0、同样的已删除科目兜底、同样的降序）
const totalsA = subjectTotals(sample, SUBJ);
const totalsB = subjectTotalsFromSums(subjectSumsFromCells(rowsToCells(sample)), SUBJ);
eq('科目占比完全相同', JSON.stringify(totalsA), JSON.stringify(totalsB));

// 已归档/已删除科目（subjects 里查不到 id）两条路径都要落到兜底名
const orphan: SessionLike[] = [
  { localDate: '2026-09-09', focusMinutes: 30, subjectId: 77, startedAt: '2026-09-09T01:00:00Z', source: 'pomodoro' },
];
const orphanA = subjectTotals(orphan, SUBJ);
const orphanB = subjectTotalsFromSums(subjectSumsFromCells(rowsToCells(orphan)), SUBJ);
eq('已删除科目兜底一致', JSON.stringify(orphanA), JSON.stringify(orphanB));
eq('已删除科目兜底名', orphanB[0].label, '已删除科目');

// 快照：由「按天汇总 + 标量」构造，结果必须与逐行构造的完全一致
const fullCells = rowsToCells(sample);
// 不传 dates：真实 getSnapshot 用的 dailyMinutesAll() 是 groupBy，只含有记录的天，
// 不会补出 0 值的天（补零是「区间视图」的事，由 summaryData 的 dailyTotals 负责）
const dailyB = dailyFromCells(fullCells);
const snapB = buildSnapshotFromDaily(
  dailyB,
  { totalSessions: sample.length, subjectCount: subjectSumsFromCells(fullCells).size, hasEarlyBird: true },
  '2026-09-09',
);
eq('聚合版快照 totalMinutes 一致', snapB.totalMinutes, snap.totalMinutes);
eq('聚合版快照 subjectCount 一致', snapB.subjectCount, snap.subjectCount);
eq('聚合版快照 currentStreak 一致', snapB.currentStreak, snap.currentStreak);
eq('聚合版快照 longestStreak 一致', snapB.longestStreak, snap.longestStreak);
eq('聚合版快照 currentPassStreak 一致', snapB.currentPassStreak, snap.currentPassStreak);
eq('聚合版快照 maxDayMinutes 一致', snapB.maxDayMinutes, snap.maxDayMinutes);
eq('聚合版快照 totalSessions 一致', snapB.totalSessions, snap.totalSessions);
// dailyMinutes 的键集合也必须一致（区间外的天不该出现在「全量」快照里）
eq(
  '聚合版快照 dailyMinutes 键一致',
  JSON.stringify(Object.keys(snapB.dailyMinutes).sort()),
  JSON.stringify(Object.keys(snap.dailyMinutes).sort()),
);

// 汇总工具自身
eq('totalMinutesOfDaily 等于逐行求和', totalMinutesOfDaily(dailyB), totalMinutes(sample));
eq('totalMinutesOfDaily 空对象为 0', totalMinutesOfDaily({}), 0);
eq('maxDayMinutes 空对象为 0', maxDayMinutes({}), 0);
eq('maxDayMinutes 取最大值', maxDayMinutes({ a: 5, b: 120, c: 60 }), 120);
// 大输入不再是 Math.max(...values) 的栈悬崖（历史实现 30 万项会抛 RangeError）
const manyDays: Record<string, number> = {};
for (let i = 0; i < 300_000; i++) manyDays[`d${i}`] = i % 97;
eq('maxDayMinutes 30 万天不抛栈溢出', maxDayMinutes(manyDays), 96);

// 手动补记不能白送早鸟徽章（startedAt 是当天零点近似值）
const manualOnly: SessionLike[] = [
  { localDate: '2026-09-09', focusMinutes: 120, subjectId: 1, startedAt: localMidnightUtc('2026-09-09').toISOString(), source: 'manual' },
];
eq('手动补记不触发早鸟', buildSnapshot(manualOnly, [{ id: 1, name: '政治', color: '#f00' }], '2026-09-09').hasEarlyBird, false);

const realEarly: SessionLike[] = [
  { localDate: '2026-09-09', focusMinutes: 120, subjectId: 1, startedAt: '2026-09-08T22:30:00Z', source: 'pomodoro' }, // 北京 06:30
];
eq('真实 6:30 开始触发早鸟', buildSnapshot(realEarly, [{ id: 1, name: '政治', color: '#f00' }], '2026-09-09').hasEarlyBird, true);

const lateStart: SessionLike[] = [
  { localDate: '2026-09-09', focusMinutes: 120, subjectId: 1, startedAt: '2026-09-09T01:00:00Z', source: 'pomodoro' }, // 北京 09:00
];
eq('9:00 开始不算早鸟', buildSnapshot(lateStart, [{ id: 1, name: '政治', color: '#f00' }], '2026-09-09').hasEarlyBird, false);

// ── 成就 ───────────────────────────────────────────────────────────────
section('成就解锁');

const base = buildSnapshot(sample, [{ id: 1, name: '政治', color: '#f00' }, { id: 2, name: '英语', color: '#0f0' }], '2026-09-09');
check('首次专注解锁初来乍到', evaluate(base).includes('first_focus'));
check('2 小时日解锁当日达标', evaluate(base).includes('pass_first'));
check('未满 7 天不解锁七日不辍', !evaluate(base).includes('streak_7'));

// 造 7 天连续 ≥1h
const sevenDays: Record<string, number> = {};
for (let i = 0; i < 7; i++) sevenDays[addDays('2026-09-03', i)] = 60;
const s7 = buildSnapshot(
  Object.entries(sevenDays).map(([d, m]) => ({ localDate: d, focusMinutes: m, subjectId: 1, startedAt: `${d}T01:00:00Z`, source: 'pomodoro' })),
  [{ id: 1, name: '政治', color: '#f00' }],
  '2026-09-09',
);
check('连续 7 天解锁七日不辍', evaluate(s7).includes('streak_7'));
check('未满 21 天不解锁廿一日成习', !evaluate(s7).includes('streak_21'));

eq('相对已解锁集合的正确差集', newlyUnlocked(s7, ['first_focus', 'pass_first']).length > 0, true);
eq('全部已解锁时差集为空', newlyUnlocked(s7, BADGES.map((b) => b.key)).length, 0);

// 铁人与累计时长
const ironSnap = buildSnapshot(
  [{ localDate: '2026-09-09', focusMinutes: 600, subjectId: 1, startedAt: '2026-09-09T01:00:00Z', source: 'pomodoro' }],
  [{ id: 1, name: '政治', color: '#f00' }],
  '2026-09-09',
);
check('单日 10h 解锁铁人', evaluate(ironSnap).includes('iron_man'));

const hundredHours = buildSnapshot(
  Array.from({ length: 100 }, (_, i) => ({
    localDate: addDays('2026-01-01', i),
    focusMinutes: 60,
    subjectId: 1,
    startedAt: `${addDays('2026-01-01', i)}T01:00:00Z`,
    source: 'pomodoro',
  })),
  [{ id: 1, name: '政治', color: '#f00' }],
  '2026-06-01',
);
check('累计 100h 解锁百小时俱乐部', evaluate(hundredHours).includes('total_100h'));
check('未满 200h 不解锁双百小时', !evaluate(hundredHours).includes('total_200h'));
check('徽章总数为 12', BADGES.length === 12, BADGES.length);
eq('徽章 key 唯一', new Set(BADGES.map((b) => b.key)).size, BADGES.length);

// ── 提交失败分级（决定离线队列保留还是丢弃）──────────────────────────
section('提交失败分级：宁可不丢记录');

const err = (code: ErrorCode, status: number) => new ApiClientError(code, 'x', status);

// 断网：保留，联网后补交
check('断网 → deferred（保留）', classifySubmissionError(err('INTERNAL', 0)) === 'deferred');
check('isOffline 认定 status=0', isOffline(err('INTERNAL', 0)) === true);

// 会话过期：这是最容易造成数据丢失的一类，必须保留而不是丢弃
check('会话过期(401) → deferred（保留，登录后补交）', classifySubmissionError(err('UNAUTHORIZED', 401)) === 'deferred');
check('被限流(429) → deferred（保留）', classifySubmissionError(err('RATE_LIMITED', 429)) === 'deferred');

// 服务端临时故障：保留重试
check('服务端故障(500) → retry', classifySubmissionError(err('INTERNAL', 500)) === 'retry');
check('网关错误(502) → retry', classifySubmissionError(err('INTERNAL', 502)) === 'retry');

// 服务端明确拒绝：重试无意义
check('校验失败(422) → fatal（丢弃）', classifySubmissionError(err('VALIDATION_FAILED', 422)) === 'fatal');
check('科目不存在(404) → fatal', classifySubmissionError(err('NOT_FOUND', 404)) === 'fatal');
check('冲突(409) → fatal', classifySubmissionError(err('CONFLICT', 409)) === 'fatal');

// 未知异常：保守保留，绝不因为「没见过的错」就把用户的专注记录丢掉
check('未知异常 → retry（保守保留）', classifySubmissionError(new Error('boom')) === 'retry');
check('非 Error 值 → retry', classifySubmissionError('weird') === 'retry');
check('null → retry', classifySubmissionError(null) === 'retry');

// ── 结果 ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`);
console.log(`  通过 ${passed} 项，失败 ${failed} 项`);
console.log(`${'─'.repeat(52)}\n`);

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('全部通过：口径无误。');
}
