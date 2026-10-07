/**
 * 图表视觉预览（开发工具）
 *
 * 图表用的是 Tailwind 类，脱离应用外壳就没了样式 —— 所以这里把**构建产物里的真实 CSS**
 * 内联进预览页，于是渲染出来的排版和线上完全一致。
 *
 * 用法：npx tsx scripts/preview-chart.tsx    （需要先 npm run build 产出 CSS）
 *       PREVIEW_ONLY=② npx tsx scripts/preview-chart.tsx   # 只渲染某个状态，方便放大细看
 * 产物：.workbuddy/preview/chart-states.html（用浏览器打开）
 *
 * 值得留这个脚本的原因：验证「一周里某天没学」「柱子超过 12 根」这类边界状态，
 * 走真实链路需要造对应数据 + 登录 + 点击；渲染成静态 HTML 只要一条命令。
 * 数据用真的 domain 聚合函数（stackedByDay）算，不手搓 points，避免预览和线上漂移。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StackedBarChart, StudyCalendar, Heatmap } from '../src/components/charts';
import { heatmapLevel, stackedByDay, type SessionLike, type SubjectLike } from '../src/lib/domain/stats';
import { addDays, eachDate, weekdayOf } from '../src/lib/domain/time';
import { formatDateCN } from '../src/lib/domain/time';
import type { HeatCell } from '../src/lib/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, '.workbuddy', 'preview', 'chart-states.html');

const TODAY = '2026-09-10'; // 周四
const WEEK_FROM = '2026-09-07'; // 周一
const WEEK_TO = '2026-09-13'; // 周日

const SUBJECTS: SubjectLike[] = [
  { id: 1, name: '数学', color: '#8b5cf6' },
  { id: 2, name: '英语', color: '#3b82f6' },
  { id: 3, name: '政治', color: '#e05a5a' },
  { id: 4, name: '专业课', color: '#f59e0b' },
];

/** [日期, [科目 id, 分钟]...][] */
type Day = [string, Array<[number, number]>];

function sessions(days: Day[]): SessionLike[] {
  const out: SessionLike[] = [];
  for (const [date, rows] of days) {
    for (const [subjectId, focusMinutes] of rows) {
      out.push({
        localDate: date,
        focusMinutes,
        subjectId,
        startedAt: `${date}T01:00:00.000Z`,
        source: 'pomodoro',
      });
    }
  }
  return out;
}

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const weekdayLabel = (d: string) => `周${DAY_NAMES[weekdayOf(d)]}`;
const dateLabel = (d: string) => {
  const [, m, day] = d.split('-').map(Number);
  return `${m}/${day}`;
};

const weekDates = eachDate(WEEK_FROM, WEEK_TO);
const monthDates = eachDate(addDays(TODAY, -29), TODAY);

// ① 完整一周：周一到周四有记录，周五~周日还没到
const weekNormal = stackedByDay(
  sessions([
    ['2026-09-07', [[4, 150]]],
    ['2026-09-08', [[4, 90], [3, 85]]],
    ['2026-09-09', [[4, 130], [3, 90]]],
    ['2026-09-10', [[4, 80], [3, 30]]],
  ]),
  weekDates,
  SUBJECTS,
  weekdayLabel,
);

// ② 一周里有空白日：周二整天没学（0 分钟 → 3px 浅底边），周三往后正常
const weekGap = stackedByDay(
  sessions([
    ['2026-09-07', [[4, 150]]],
    ['2026-09-09', [[3, 95]]],
    ['2026-09-10', [[4, 80], [2, 45]]],
  ]),
  weekDates,
  SUBJECTS,
  weekdayLabel,
);

// ③ 全新的周：一条记录都没有
const weekEmpty = stackedByDay([], weekDates, SUBJECTS, weekdayLabel);

// ④ 30 天密集兜底：柱状图超过 12 根时不再走日历，这条分支要保证不溢出
const monthDense = stackedByDay(
  sessions(
    monthDates.map((d, i) => {
      const rows: Array<[number, number]> = [];
      if (i % 7 !== 3) rows.push([1 + (i % 4), 60 + ((i * 37) % 180)]);
      if (i % 5 === 0) rows.push([((i % 4) + 1) % 4 + 1, 40]);
      return [d, rows] as Day;
    }),
  ),
  monthDates,
  SUBJECTS,
  dateLabel,
);

const calendarPoints = stackedByDay(
  sessions(monthDates.map((d, i) => [d, i % 11 === 4 ? [] : ([[1 + (i % 4), 45 + ((i * 53) % 200)]] as Array<[number, number]>)] as Day)),
  monthDates,
  SUBJECTS,
  dateLabel,
);

// ⑧⑨⑩ 热力图：用真 heatmapLevel 分档，不手搓 level
const SIX_MONTH_FROM = addDays(TODAY, -26 * 7);
/** 确定性的伪随机：同一个 i 每次跑出来一样，预览截图才可对比 */
const wobble = (i: number) => (i * 2654435761) % 1000;

function heatCells(from: string, to: string, activeRatio: number): HeatCell[] {
  return eachDate(from, to).map((date, i) => {
    const minutes = wobble(i) % 100 > activeRatio * 100 ? 0 : 20 + (wobble(i) % 480);
    return { date, minutes, level: heatmapLevel(minutes) };
  });
}

const heat6m = heatCells(SIX_MONTH_FROM, TODAY, 0.62);
// 全程：约 3 年 → 156 周 × 7 ≈ 1092 格，这是 hover 重渲染最贵、也最需要横向滚动的场景
const heatAll = heatCells(addDays(TODAY, -365 * 3), TODAY, 0.45);

interface Case {
  label: string;
  note: string;
  width: number;
  node: React.ReactElement;
}

const CASES: Case[] = [
  {
    label: '① 完整一周（手机 366px）',
    note: '周中有记录，周五~周日还没到 → 虚线占位框；合计只算已过的日子',
    width: 366,
    node: (
      <StackedBarChart
        points={weekNormal.points}
        series={weekNormal.series}
        today={TODAY}
        detailTitle={formatDateCN}
      />
    ),
  },
  {
    label: '② 一周内有空白日（手机 366px）',
    note: '周二 0 分钟 → 3px 浅底边；要能和「还没到」的虚线框一眼分开',
    width: 366,
    node: (
      <StackedBarChart
        points={weekGap.points}
        series={weekGap.series}
        today={TODAY}
        detailTitle={formatDateCN}
      />
    ),
  },
  {
    label: '③ 全新的周（手机 366px）',
    note: '一条记录都没有：周一~周四（已过）是浅底边，周五~周日（未到）是虚线框，不应出现 NaN 或塌陷',
    width: 366,
    node: (
      <StackedBarChart
        points={weekEmpty.points}
        series={weekEmpty.series}
        today={TODAY}
        detailTitle={formatDateCN}
      />
    ),
  },
  {
    label: '④ 30 天兜底柱状图（手机 366px）',
    note: '柱子 >12 根进密集模式：日期抽稀、无柱顶数值、min-w-0 防溢出',
    width: 366,
    node: (
      <StackedBarChart
        points={monthDense.points}
        series={monthDense.series}
        today={TODAY}
        detailTitle={formatDateCN}
      />
    ),
  },
  {
    label: '⑤ 学习日历（手机 366px）',
    note: '首尾补齐到完整自然周；9/1 标出月份；今天有描边',
    width: 366,
    node: (
      <StudyCalendar
        points={calendarPoints.points}
        series={calendarPoints.series}
        today={TODAY}
        detailTitle={formatDateCN}
      />
    ),
  },
  {
    label: '⑥ 完整一周（桌面 656px）',
    note: '宽屏下 7 根柱子更宽，标签仍是 周一~周日',
    width: 656,
    node: (
      <StackedBarChart
        points={weekNormal.points}
        series={weekNormal.series}
        today={TODAY}
        detailTitle={formatDateCN}
      />
    ),
  },
  {
    label: '⑦ 学习日历（桌面 656px）',
    note: '桌面格子被拉宽，格子内的堆叠条限宽居中，不会变成一条色带',
    width: 656,
    node: (
      <StudyCalendar
        points={calendarPoints.points}
        series={calendarPoints.series}
        today={TODAY}
        detailTitle={formatDateCN}
      />
    ),
  },
  {
    label: '⑧ 热力图 · 近 6 个月（手机 366px）',
    note: '5 档色阶（空/未打卡/打卡/达标/目标）；格数 = 周数 × 7，底部一行在无 hover 时显示汇总',
    width: 366,
    node: <Heatmap cells={heat6m} />,
  },
  {
    label: '⑨ 热力图 · 全程 3 年（手机 366px）',
    note: '约 1092 格 —— 这是 hover 时最贵的场景（格子已 memo）；同时验证横向滚动条不把卡片顶宽',
    width: 366,
    node: <Heatmap cells={heatAll} />,
  },
  {
    label: '⑩ 热力图 · 近 6 个月（桌面 656px）',
    note: '桌面宽度下格子尺寸不变（固定 w-3 h-3），多出来的宽度应该只影响滚动区',
    width: 656,
    node: <Heatmap cells={heat6m} />,
  },
  {
    label: '⑪ 热力图 · 空数据（手机 366px）',
    note: 'cells 为空数组时不应崩，也不应出现 NaN',
    width: 366,
    node: <Heatmap cells={[]} />,
  },
];

/** 取构建产物里的真实 CSS，预览的排版才能和线上一致 */
function buildCss(): string {
  const dir = join(ROOT, '.next', 'static', 'css');
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.css'));
    return files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  } catch {
    throw new Error(`读不到构建产物 CSS（${dir}）—— 先跑一次 npm run build`);
  }
}

const cards = (process.env.PREVIEW_ONLY
  ? CASES.filter((c) => c.label.includes(process.env.PREVIEW_ONLY!))
  : CASES
)
  .map((c) => {
    const inner = renderToStaticMarkup(c.node);
    return `  <div class="case">
    <div class="cap">${c.label}</div>
    <div class="note">${c.note}</div>
    <section class="card" style="width:${c.width}px">${inner}</section>
  </div>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>图表状态预览（StackedBarChart / StudyCalendar / Heatmap 实际渲染）</title>
<style>
${buildCss()}
</style>
<style>
  body { background: #eef2f0; padding: 30px; display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start;
         font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
  .case { display: flex; flex-direction: column; }
  .cap { font-size: 13px; color: #1a2b26; font-weight: 600; margin-bottom: 4px; }
  .note { font-size: 11.5px; color: #93a29c; margin-bottom: 10px; max-width: 560px; }
  .card { background: var(--c-card); border: 1px solid var(--c-line); border-radius: 16px; padding: 16px;
          box-shadow: 0 8px 24px rgba(4, 92, 66, .10); }
</style>
</head>
<body>
${cards}
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf8');
console.log(`已渲染 ${CASES.length} 个图表状态 → ${OUT}`);
