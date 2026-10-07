/**
 * 今日战报卡片本体（纯展示，props 驱动，无 hooks）
 *
 * 视觉思路：上半部深绿渐变承载核心数字，形成导出分享时的视觉重心；
 * 下半部白底放各科明细与指标。原版是整张白底 + 全居中堆叠，
 * 缺少重点、字号偏小，导出后像一张报表而不是「战报」。
 *
 * 尺寸口径：固定 375×500 排版（3:4 竖版），
 * 导出时用 html-to-image 以 pixelRatio=2 渲染 → 实际输出 750×1000，适合手机与朋友圈。
 *
 * 为什么整卡用内联 style 而不是 Tailwind 类：
 * 1. 导出图必须与屏幕尺寸、明暗主题无关，所有尺寸与颜色都得是确定值；
 * 2. html-to-image 走 SVG foreignObject，对内联样式的解析最可靠 ——
 *    渐变、圆角、光晕这些装饰要原样进图。
 *
 * 被抽成独立组件的理由：ReportDialog 要管取数与导出，
 * 而卡片只需要数据就能画出来 —— 分离后小到可以在 Node 里直接渲染验证，
 * 不必为了看一眼效果先把整个应用跑起来。
 */
import { Fragment, type CSSProperties } from 'react';
import { formatDateCN, formatMinutes } from '@/lib/domain/time';
import type { SliceDatum } from '@/lib/types';

export const REPORT_CARD_SIZE = { width: 375, height: 500 } as const;

/** 各科明细与图例最多呈现的条目数，超出部分合并为「其他」 */
const MAX_ROWS = 4;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
const BRAND = '#047857';
const INK = '#1a2b26';
const INK2 = '#47554f';
const INK3 = '#93a29c';
const LINE = '#eef1ef';

const S: Record<string, CSSProperties> = {
  card: {
    width: REPORT_CARD_SIZE.width,
    height: REPORT_CARD_SIZE.height,
    flexShrink: 0,
    borderRadius: 20,
    overflow: 'hidden',
    background: '#fff',
    color: INK,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: FONT,
  },
  hero: {
    position: 'relative',
    flex: '0 0 auto',
    padding: '20px 24px 18px',
    background: 'linear-gradient(142deg, #04543f 0%, #047857 46%, #0d9488 100%)',
    color: '#fff',
    overflow: 'hidden',
  },
  glowA: {
    position: 'absolute',
    top: -78,
    right: -46,
    width: 210,
    height: 210,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(255,255,255,.17) 0%, rgba(255,255,255,0) 68%)',
  },
  glowB: {
    position: 'absolute',
    bottom: -90,
    left: -40,
    width: 160,
    height: 160,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(255,255,255,.09) 0%, rgba(255,255,255,0) 70%)',
  },
  heroTop: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kicker: {
    fontSize: 10.5,
    letterSpacing: 3,
    color: 'rgba(255,255,255,.62)',
    fontWeight: 600,
  },
  date: { fontSize: 11.5, color: '#a7f3d0', fontWeight: 600 },
  bigWrap: { position: 'relative', textAlign: 'center', marginTop: 15 },
  big: { display: 'flex', alignItems: 'baseline', justifyContent: 'center' },
  num: {
    fontSize: 56,
    fontWeight: 800,
    lineHeight: 0.95,
    letterSpacing: -2,
    fontVariantNumeric: 'tabular-nums',
  },
  unit: { fontSize: 19, fontWeight: 700, marginRight: 5 },
  bigSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,.68)',
    marginTop: 7,
    letterSpacing: 0.5,
  },
  stackWrap: { position: 'relative', marginTop: 15 },
  stack: { display: 'flex', gap: 3, height: 9 },
  stackEmpty: {
    width: '100%',
    border: '1px dashed rgba(255,255,255,.3)',
    borderRadius: 5,
  },
  legend: { display: 'flex', gap: 11, marginTop: 8, overflow: 'hidden' },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 10.5,
    color: 'rgba(255,255,255,.74)',
    whiteSpace: 'nowrap',
  },
  legendDot: { width: 6, height: 6, borderRadius: '50%', flex: '0 0 auto' },

  body: {
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
    padding: '14px 24px 13px',
    minHeight: 0,
  },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 1.6,
    color: INK3,
    fontWeight: 700,
    marginBottom: 4,
  },
  /** 行区吃掉剩余高度并垂直居中：1 行时上下均匀呼吸，4 行时自然铺满 */
  rows: {
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    minHeight: 0,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 34,
    flex: '0 0 auto',
    borderBottom: `1px dashed ${LINE}`,
  },
  rowDot: { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto' },
  rowName: {
    fontSize: 12.5,
    color: INK2,
    width: 62,
    flex: '0 0 auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  track: {
    flex: '1 1 auto',
    height: 5,
    borderRadius: 3,
    background: '#f0f3f1',
    overflow: 'hidden',
  },
  trackFill: { display: 'block', height: '100%', borderRadius: 3 },
  rowVal: {
    fontSize: 12.5,
    fontWeight: 700,
    color: INK,
    width: 56,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    flex: '0 0 auto',
  },

  empty: {
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    color: '#a8b4af',
    fontSize: 11.5,
    textAlign: 'center',
    lineHeight: 1.6,
  },
  emptyIcon: { fontSize: 24, opacity: 0.45, lineHeight: 1 },

  metrics: { display: 'flex', gap: 7, flex: '0 0 auto' },
  metric: {
    flex: '1 1 0',
    background: '#f6faf8',
    borderRadius: 10,
    padding: '8px 4px 7px',
    textAlign: 'center',
  },
  metricVal: {
    display: 'block',
    fontSize: 18,
    fontWeight: 800,
    color: BRAND,
    lineHeight: 1.15,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: -0.4,
  },
  metricUnit: { fontSize: 11, fontWeight: 700, fontStyle: 'normal', marginLeft: 1 },
  metricLabel: { display: 'block', fontSize: 10.5, color: INK3, marginTop: 2 },

  foot: {
    textAlign: 'center',
    fontSize: 10.5,
    color: '#bec9c4',
    marginTop: 10,
    letterSpacing: 0.4,
    flex: '0 0 auto',
  },
};

/** 尾部科目合并为「其他」，避免科目多时把卡片撑爆 */
function foldSlices(slices: SliceDatum[]): SliceDatum[] {
  if (slices.length <= MAX_ROWS) return slices;
  const head = slices.slice(0, MAX_ROWS - 1);
  const value = slices.slice(MAX_ROWS - 1).reduce((sum, s) => sum + s.value, 0);
  return [...head, { label: '其他', color: '#94a3b8', value }];
}

/** 拆成 [{4,h},{20,m}]，便于「数字大、单位小」的排版 */
function timeParts(totalMin: number): Array<{ n: string; u: string }> {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const parts: Array<{ n: string; u: string }> = [];
  if (h > 0) parts.push({ n: String(h), u: 'h' });
  if (m > 0) parts.push({ n: h > 0 ? String(m).padStart(2, '0') : String(m), u: 'm' });
  return parts.length > 0 ? parts : [{ n: '0', u: 'm' }];
}

export interface ReportCardProps {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 今日专注总分钟 */
  totalMinutes: number;
  /** 各科分布（按时长降序） */
  slices: SliceDatum[];
  /** 今日完成的待办条数 */
  itemCount: number;
  currentStreak: number;
  /** 距考试天数，负数表示已考 */
  dday: number;
  /** 每日目标分钟，用于「已达成目标」标记 */
  goalMinutes: number;
}

export function ReportCard({
  date,
  totalMinutes,
  slices,
  itemCount,
  currentStreak,
  dday,
  goalMinutes,
}: ReportCardProps) {
  const isEmpty = totalMinutes <= 0;
  const rows = foldSlices(slices);
  const maxRow = Math.max(1, ...rows.map((s) => s.value));
  const reachedGoal = goalMinutes > 0 && totalMinutes >= goalMinutes;
  const parts = timeParts(totalMinutes);

  return (
    <div style={S.card}>
      {/* ── 主视觉：核心数字 ───────────────────────── */}
      <div style={S.hero}>
        <div style={S.glowA} />
        <div style={S.glowB} />

        <div style={S.heroTop}>
          <span style={S.kicker}>今 日 战 报</span>
          <span style={S.date}>{formatDateCN(date)}</span>
        </div>

        <div style={S.bigWrap}>
          <div style={S.big}>
            {parts.map((p, i) => (
              <Fragment key={p.u}>
                <span style={S.num}>{p.n}</span>
                {/* 末位不留右边距，否则整块会向左偏半个间距 */}
                <span style={i === parts.length - 1 ? { ...S.unit, marginRight: 0 } : S.unit}>{p.u}</span>
              </Fragment>
            ))}
          </div>
          <div style={S.bigSub}>
            {isEmpty ? '今天还没有专注记录' : reachedGoal ? '今日专注时长 · 已达成目标' : '今日专注时长'}
          </div>
        </div>

        <div style={S.stackWrap}>
          <div style={S.stack}>
            {isEmpty ? (
              <i style={S.stackEmpty} />
            ) : (
              // 用 foldSlices 后的 rows 而不是原始 slices：科目多时堆叠条与图例
              // 必须一一对应，否则条上会出现图例里查不到的颜色
              rows.map((s, i) => (
                <i
                  key={`${s.label}-${i}`}
                  style={{
                    display: 'block',
                    borderRadius: 5,
                    background: s.color,
                    width: `${(s.value / totalMinutes) * 100}%`,
                  }}
                />
              ))
            )}
          </div>

          <div style={{ ...S.legend, justifyContent: isEmpty ? 'center' : 'flex-start' }}>
            {isEmpty ? (
              <span style={S.legendItem}>开始一段专注，这里就会亮起来</span>
            ) : (
              rows.map((s, i) => (
                <span key={`${s.label}-${i}`} style={S.legendItem}>
                  <i style={{ ...S.legendDot, background: s.color }} />
                  {s.label} {Math.round((s.value / totalMinutes) * 100)}%
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── 明细 ─────────────────────────────────── */}
      <div style={S.body}>
        {isEmpty ? (
          <div style={S.empty}>
            <div style={S.emptyIcon}>◎</div>
            <div>
              还没有数据
              <br />
              去专注一会儿吧
            </div>
          </div>
        ) : (
          <>
            <div style={S.sectionTitle}>各 科 分 布</div>
            <div style={S.rows}>
              {rows.map((s, i) => (
                <div
                  key={`${s.label}-${i}`}
                  style={i === rows.length - 1 ? { ...S.row, borderBottom: 'none' } : S.row}
                >
                  <i style={{ ...S.rowDot, background: s.color }} />
                  <span style={S.rowName}>{s.label}</span>
                  <span style={S.track}>
                    <i
                      style={{
                        ...S.trackFill,
                        width: `${(s.value / maxRow) * 100}%`,
                        background: s.color,
                      }}
                    />
                  </span>
                  <span style={S.rowVal}>{formatMinutes(s.value)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={S.metrics}>
          <Metric value={String(itemCount)} label="完成事项" />
          <Metric value={String(currentStreak)} unit="天" label="连续打卡" />
          <Metric value={dday >= 0 ? String(dday) : '已考'} label="距考研" />
        </div>

        <div style={S.foot}>上岸助手 · 每天进步一点点</div>
      </div>
    </div>
  );
}

function Metric({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div style={S.metric}>
      <b style={S.metricVal}>
        {value}
        {unit && <em style={S.metricUnit}>{unit}</em>}
      </b>
      <span style={S.metricLabel}>{label}</span>
    </div>
  );
}
