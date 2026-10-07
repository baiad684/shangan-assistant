/**
 * 战报卡片视觉预览（开发工具）
 *
 * 卡片是纯展示组件，可以脱离登录、脱离应用外壳直接在 Node 里渲染 ——
 * 改完样式不必跑起整个应用、也不必先造数据，就能看到真实排版。
 *
 * 用法：npx tsx scripts/preview-report.tsx
 * 产物：.workbuddy/preview/report-card.rendered.html（用浏览器打开）
 *
 * 之所以值得留这个脚本：验证战报样式原本需要「起服务 → 走引导 → 造记录 → 登录 → 点开弹窗」，
 * 改一行样式就要重来一遍。渲染成静态 HTML 后，看一眼只需要一条命令。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// tsx 走的是 classic JSX runtime（tsconfig 的 jsx 是 Next 用的 preserve），
// 所以这里的 JSX 需要 React 在作用域内 —— 与运行时的 React 版本无关。
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportCard, type ReportCardProps } from '../src/components/report/ReportCard';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '.workbuddy', 'preview', 'report-card.rendered.html');

const DATE = '2026-09-10';

interface Case {
  label: string;
  props: ReportCardProps;
}

const base = {
  date: DATE,
  itemCount: 5,
  currentStreak: 7,
  dday: 465,
  goalMinutes: 480,
} satisfies Partial<ReportCardProps>;

const CASES: Case[] = [
  {
    label: '① 有数据（3 科，420 分钟）',
    props: {
      ...base,
      totalMinutes: 420,
      slices: [
        { label: '政治', color: '#e05a5a', value: 180 },
        { label: '英语', color: '#3b82f6', value: 150 },
        { label: '数学', color: '#8b5cf6', value: 90 },
      ],
    },
  },
  {
    label: '② 空状态（今日 0 分钟）',
    props: { ...base, totalMinutes: 0, slices: [], itemCount: 0, currentStreak: 0 },
  },
  {
    label: '③ 单科（485 分钟，已达标）',
    props: {
      ...base,
      totalMinutes: 485,
      itemCount: 12,
      currentStreak: 31,
      slices: [{ label: '数学', color: '#10b981', value: 485 }],
    },
  },
  {
    label: '④ 四科满（585 分钟，已达标）',
    props: {
      ...base,
      totalMinutes: 585,
      itemCount: 16,
      currentStreak: 31,
      slices: [
        { label: '政治', color: '#e05a5a', value: 180 },
        { label: '英语', color: '#3b82f6', value: 150 },
        { label: '数学', color: '#8b5cf6', value: 135 },
        { label: '408计算机', color: '#0891b2', value: 120 },
      ],
    },
  },
  {
    label: '⑤ 六科（验证尾部合并为「其他」）',
    props: {
      ...base,
      totalMinutes: 600,
      itemCount: 9,
      currentStreak: 3,
      slices: [
        { label: '政治', color: '#e05a5a', value: 200 },
        { label: '英语', color: '#3b82f6', value: 150 },
        { label: '数学', color: '#8b5cf6', value: 120 },
        { label: '408计算机', color: '#0891b2', value: 80 },
        { label: '专业课二', color: '#f59e0b', value: 30 },
        { label: '真题', color: '#ec4899', value: 20 },
      ],
    },
  },
  {
    label: '⑥ 短时（8 分钟）',
    props: {
      ...base,
      totalMinutes: 8,
      itemCount: 1,
      currentStreak: 1,
      slices: [{ label: '英语', color: '#3b82f6', value: 8 }],
    },
  },
];

const cards = CASES.map((c) => {
  const inner = renderToStaticMarkup(<ReportCard {...c.props} />);
  return `  <div class="case">\n    <div class="cap">${c.label}</div>\n    ${inner}\n  </div>`;
}).join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>战报卡片预览（由 ReportCard 实际渲染）</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #e8ecea;
    padding: 34px;
    display: flex;
    flex-wrap: wrap;
    gap: 30px;
    align-items: flex-start;
  }
  .case { display: flex; flex-direction: column; }
  .cap { font-size: 12.5px; color: #5b6b65; margin-bottom: 9px; font-weight: 600; }
  /* 模拟屏幕上的投影，导出 PNG 时不会有这层 */
  .case > div { box-shadow: 0 10px 30px rgba(4, 92, 66, .16); border-radius: 20px; }
</style>
</head>
<body>
${cards}
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf8');
console.log(`已渲染 ${CASES.length} 张卡片 → ${OUT}`);
