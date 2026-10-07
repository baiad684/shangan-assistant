/**
 * 战报导出探针（开发工具）
 *
 * ReportCard 用了 CSS 渐变与 radial-gradient 光晕，而导出走的是
 * html-to-image（SVG foreignObject 方式）—— 这类装饰恰恰是导出最容易丢的部分。
 * 这个探针在真实浏览器里挂载卡片、调用与 ReportDialog 相同的导出参数，
 * 把结果 PNG 直接显示出来，一眼就能看出导出图跟屏幕上是否一致。
 *
 * 用法见 scripts/export-probe.html 顶部注释。
 */
import { createRoot } from 'react-dom/client';
import { toPng } from 'html-to-image';
import { ReportCard, type ReportCardProps } from '../src/components/report/ReportCard';

const PROBE_PROPS: ReportCardProps = {
  date: '2026-09-10',
  totalMinutes: 420,
  slices: [
    { label: '政治', color: '#e05a5a', value: 180 },
    { label: '英语', color: '#3b82f6', value: 150 },
    { label: '数学', color: '#8b5cf6', value: 90 },
  ],
  itemCount: 5,
  currentStreak: 7,
  dday: 465,
  goalMinutes: 480,
};

export interface ProbeResult {
  dataUrl: string;
  width: number;
  height: number;
}

/** 把卡片渲染到页面上可见的位置，用于和导出结果并排比对 */
export function live(host: HTMLElement): void {
  createRoot(host).render(<ReportCard {...PROBE_PROPS} />);
}

export async function run(): Promise<ProbeResult> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(host);

  const root = createRoot(host);
  root.render(<ReportCard {...PROBE_PROPS} />);
  // 等 React 提交完成、布局稳定
  await new Promise((r) => setTimeout(r, 300));

  const node = host.firstElementChild as HTMLElement | null;
  if (!node) {
    host.remove();
    throw new Error('卡片未渲染出来');
  }

  // 与 ReportDialog.exportPng 完全一致的参数
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    width: 375,
    height: 500,
    backgroundColor: '#ffffff',
  });

  // 1×1 只是为了占位，真实尺寸由 decode 得到
  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  root.unmount();
  host.remove();

  return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
}
