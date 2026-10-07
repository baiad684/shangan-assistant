'use client';

/**
 * 图表隔离层（ARCHITECTURE.md §6.2）
 *
 * 页面只依赖这里的 props 契约，不关心底层是怎么画的。
 * 当前用手写 SVG/CSS 实现：零依赖、样式完全可控、SSR 友好、导出 PNG 时不会有 canvas 渲染问题。
 * 若日后需要缩放/复杂联动，把 ECharts 换进来即可，页面层零改动。
 */
import { memo, useCallback, useMemo, useState } from 'react';
import type { HeatCell, SeriesDef, SliceDatum, StackedPoint } from '@/lib/types';
import { calendarGrid, formatMinutes } from '@/lib/domain/time';
import { cx } from '@/components/ui/base';

// ── 当日明细（柱状图与日历共用） ──────────────────────────────────────

function DayDetail({
  title,
  total,
  series,
  values,
}: {
  title: string;
  total: number;
  series: SeriesDef[];
  values: Record<string, number>;
}) {
  return (
    <div className="mt-3 rounded-xl bg-soft p-3 anim-fade-up">
      <div className="flex items-center justify-between text-[12.5px] font-semibold text-ink">
        <span>{title}</span>
        <span className="tnum text-brand-strong">{formatMinutes(total)}</span>
      </div>
      <div className="mt-2 space-y-1">
        {series
          .map((s) => ({ s, v: values[s.key] ?? 0 }))
          .filter(({ v }) => v > 0)
          .sort((a, b) => b.v - a.v)
          .map(({ s, v }) => (
            <div key={s.key} className="flex items-center gap-2 text-[12px] text-ink2">
              <i className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="flex-1 truncate">{s.label}</span>
              <span className="tnum">{formatMinutes(v)}</span>
            </div>
          ))}
        {total === 0 && <p className="text-[12px] text-ink3">这天没有专注记录</p>}
      </div>
    </div>
  );
}

function Legend({ series, extra }: { series: SeriesDef[]; extra?: string }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[11.5px] text-ink2">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1">
          <i className="w-[9px] h-[9px] rounded-[3px] inline-block" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
      {extra && (
        <span className="inline-flex items-center gap-1 text-ink3">
          <i className="w-[9px] h-[9px] rounded-[3px] inline-block border border-dashed border-ink3/50" />
          {extra}
        </span>
      )}
    </div>
  );
}

// ── 堆叠柱状图 ────────────────────────────────────────────────────────

export function StackedBarChart({
  points,
  series,
  height = 160,
  /** 点击柱子查看当日明细（IMPLEMENTATION.md §4.6 要求可点击看明细） */
  detailTitle = (date: string) => date,
  emptyHint = '这段时间还没有记录',
  /**
   * 服务端的「今天」。传了之后，晚于它的柱子画成虚线占位框 ——
   * 「本周」是完整自然周（周一~周日），不动手区分的话，周日看起来就像「这天没学习」。
   */
  today,
}: {
  points: StackedPoint[];
  series: SeriesDef[];
  height?: number;
  detailTitle?: (date: string) => string;
  emptyHint?: string;
  today?: string;
}) {
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);

  const totals = useMemo(
    () => points.map((p) => series.reduce((sum, s) => sum + (p.values[s.key] ?? 0), 0)),
    [points, series],
  );

  const max = Math.max(1, ...totals);
  const hasAny = totals.some((t) => t > 0);
  const picked = pickedIndex !== null ? points[pickedIndex] : null;

  /** 晚于今天 = 还没到的日子（只认 meta 是 YYYY-MM-DD 的柱子） */
  const isFuture = (p: StackedPoint) => Boolean(today && p.meta && p.meta > today);
  const hasFuture = points.some(isFuture);

  /**
   * 柱子超过 12 根时每根只剩十几个像素宽，柱顶数值和每根柱子的日期都必须让位：
   * 数值只留给点击后的明细面板，日期按步长抽稀。
   *
   * 注意：统计页的「近 30 天」已经改用 StudyCalendar（30 个柱子画不好，见下方注释），
   * 这条密集分支现在是兜底 —— 任何超过 12 天的区间走到这里都不会崩、不会溢出。
   *
   * 另外柱子一律加 min-w-0 —— flex 子项默认 min-width:auto，会被内部 nowrap 的日期文字
   * 撑住不肯收缩，柱子一多就顶穿卡片。
   */
  const dense = points.length > 12;
  /**
   * 日期标签分两档，靠 CSS 断点切换，不需要 JS 量宽度：
   * 窄屏（卡片内容区 366px）标约 8 个，宽屏（md 起 656px）标约 15 个。
   *
   * 关键：**窄屏那档必须是宽屏那档的子集**（步长成倍数关系）。
   * 否则两个互质的网格叠加会撞出「连续两天都标」，例如每 5 天 + 每 2 天
   * 会产生 8/15、8/16、8/17 这种挤在一起的标签。
   */
  const WIDE_STEP = points.length > 32 ? 3 : 2;
  const narrowStep = WIDE_STEP * Math.max(1, Math.ceil(points.length / (8 * WIDE_STEP)));
  /** 从右往左数着抽，保证「今天」那根一定有日期（fromEnd === 0） */
  const labelTier = (index: number): 'always' | 'wide' | 'never' => {
    if (!dense) return 'always';
    const fromEnd = points.length - 1 - index;
    if (fromEnd % narrowStep === 0) return 'always';
    return fromEnd % WIDE_STEP === 0 ? 'wide' : 'never';
  };
  /** 预留给底部日期（密集时不再留柱顶数值） */
  const reserve = dense ? 20 : 36;
  /** 虚线占位框高度：要明显高出「0 分钟」那条 3px 底边，否则读不出「空位」的意思 */
  const ghostHeight = Math.max(14, Math.round((height - reserve) * 0.16));

  if (points.length === 0) {
    return <p className="text-center text-[12.5px] text-ink3 py-8">{emptyHint}</p>;
  }

  return (
    <div>
      <div className={cx('flex items-end', dense ? 'gap-[2px]' : 'gap-1.5')} style={{ height }}>
        {points.map((point, index) => {
          const total = totals[index];
          const isPicked = pickedIndex === index;
          const tier = labelTier(index);
          const future = isFuture(point);
          /** 贴边的两根靠边对齐，避免居中文字探出卡片边缘 */
          const align =
            index === 0 ? 'self-start' : index === points.length - 1 ? 'self-end' : 'self-center';
          return (
            <button
              key={`${point.meta ?? point.label}-${index}`}
              type="button"
              onClick={() => setPickedIndex(isPicked ? null : index)}
              className="flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1 group"
              aria-label={`${point.label} ${future ? '还没到' : formatMinutes(total)}`}
            >
              {!dense && !future && (
                <span
                  className={cx(
                    'text-[10px] tnum transition-colors',
                    isPicked ? 'text-brand-strong font-semibold' : 'text-ink3 group-hover:text-ink2',
                  )}
                >
                  {total > 0 ? formatMinutes(total) : ''}
                </span>
              )}

              {future ? (
                <div
                  className="w-full max-w-[38px] rounded-t-md border-2 border-dashed border-ink3/35"
                  style={{ height: ghostHeight }}
                />
              ) : (
                <div
                  className={cx(
                    'w-full max-w-[38px] rounded-t-md overflow-hidden flex flex-col-reverse transition-opacity',
                    // 有记录但 0 分钟的日子留一条浅底边，否则它和「还没到的日子」都看不出来
                    total > 0 ? '' : 'bg-line',
                    isPicked ? 'ring-2 ring-brand/45' : 'group-hover:opacity-90',
                  )}
                  style={{
                    height: total > 0 ? `${Math.max(4, (total / max) * (height - reserve))}px` : 3,
                  }}
                >
                  {series.map((s) => {
                    const value = point.values[s.key] ?? 0;
                    if (value <= 0) return null;
                    return (
                      <div
                        key={s.key}
                        style={{ height: `${(value / total) * 100}%`, background: s.color }}
                        title={`${s.label} ${formatMinutes(value)}`}
                      />
                    );
                  })}
                </div>
              )}

              <span
                className={cx(
                  'text-[10.5px] whitespace-nowrap transition-colors',
                  align,
                  tier === 'never' && 'invisible',
                  tier === 'wide' && 'invisible md:visible',
                  isPicked
                    ? 'text-brand-strong font-semibold'
                    : future
                      ? 'text-ink3/55'
                      : 'text-ink3',
                )}
              >
                {point.label}
              </span>
            </button>
          );
        })}
      </div>

      <Legend series={series} extra={hasFuture ? '还没到' : undefined} />

      {picked && (
        <DayDetail
          title={detailTitle(picked.meta ?? picked.label)}
          total={totals[pickedIndex!] ?? 0}
          series={series}
          values={picked.values}
        />
      )}

      {!hasAny && <p className="text-center text-[12px] text-ink3 mt-3">{emptyHint}</p>}
    </div>
  );
}

// ── 学习日历（多日区间） ──────────────────────────────────────────────

/**
 * 30 天用柱状图画是画不好的：每根柱子只剩十几个像素，日期标签怎么抽稀都挤。
 * 换成日历后信息密度反而更高 —— 每格一天，格内堆叠条按科目显示当天构成、
 * 高度按「当日总时长 ÷ 区间峰值」缩放，于是「哪几天没学」「哪天学得最多」
 * 「偏科偏在哪」三件事在一屏里全看得出来。
 *
 * 首尾补齐到完整自然周（周一起），这样它看起来是真的日历，而不是一排方块。
 */
export function StudyCalendar({
  points,
  series,
  today,
  weekStart = 1,
  detailTitle = (date: string) => date,
  emptyHint = '这段时间还没有记录',
}: {
  points: StackedPoint[];
  series: SeriesDef[];
  /** 区间最后一天（高亮成「今天」） */
  today?: string;
  weekStart?: 0 | 1;
  detailTitle?: (date: string) => string;
  emptyHint?: string;
}) {
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  const model = useMemo(() => {
    const days = points.filter((p): p is StackedPoint & { meta: string } => Boolean(p.meta));
    if (days.length === 0) return null;

    const byDate = new Map(days.map((d) => [d.meta, d]));
    const first = days[0].meta;
    const last = days[days.length - 1].meta;
    // 首尾补齐到完整自然周（日期数学在 domain 层，可被自测覆盖）
    const weeks = calendarGrid(first, last, weekStart);

    const totalOf = (p: StackedPoint) =>
      series.reduce((sum, s) => sum + (p.values[s.key] ?? 0), 0);
    const totals = days.map(totalOf);

    return {
      byDate,
      weeks,
      totalOf,
      peak: Math.max(1, ...totals),
      sum: totals.reduce((a, b) => a + b, 0),
      activeDays: totals.filter((t) => t > 0).length,
      today: today ?? last,
    };
    // 不含 pickedDate：日历骨架（格子、补齐、峰值、日均）与「当前选中哪一格」是两种
    // 生命周期，混在同一个 memo 里会让每点一格都重建整份骨架。
  }, [points, series, weekStart, today]);

  /** 选中项单独派生 —— 点格子只重算这一行 */
  const picked = useMemo(
    () => (pickedDate ? model?.byDate.get(pickedDate) ?? null : null),
    [pickedDate, model],
  );

  if (!model) {
    return <p className="text-center text-[12.5px] text-ink3 py-8">{emptyHint}</p>;
  }

  const { byDate, weeks, totalOf, peak, sum, activeDays } = model;
  const weekdayHead = Array.from({ length: 7 }, (_, i) => WEEKDAY_LABELS[(weekStart + i) % 7]);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekdayHead.map((w, i) => (
          <span key={i} className="text-center text-[10px] text-ink3">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weeks.flatMap((week) =>
          week.map((date) => {
            const point = byDate.get(date);
            const day = Number(date.slice(8, 10));
            const isToday = date === model.today;
            const isPicked = date === pickedDate;
            const total = point ? totalOf(point) : 0;
            const ratio = point && total > 0 ? total / peak : 0;
            const monthStart = day === 1;

            // 区间外的补齐日：只留个日号当参照，不可点
            if (!point) {
              return (
                <span
                  key={date}
                  data-cell={date}
                  data-in-range="false"
                  aria-hidden
                  className="h-12 md:h-14 rounded-lg flex items-start justify-start pl-[5px] pt-[3px] text-[9.5px] tnum text-ink3/45 border border-transparent"
                >
                  {day}
                </span>
              );
            }

            return (
              <button
                key={date}
                type="button"
                data-cell={date}
                data-in-range="true"
                onClick={() => setPickedDate(isPicked ? null : date)}
                aria-label={`${detailTitle(date)} ${formatMinutes(total)}`}
                title={`${date} · ${total > 0 ? formatMinutes(total) : '没有记录'}`}
                className={cx(
                  'relative h-12 md:h-14 rounded-lg overflow-hidden border bg-soft text-left transition-shadow',
                  isPicked
                    ? 'border-brand-strong ring-2 ring-brand/40'
                    : isToday
                      ? 'border-brand-line ring-1 ring-brand/35'
                      : 'border-line/70 hover:border-brand-line',
                )}
              >
                <span
                  className={cx(
                    'absolute top-[3px] left-[5px] text-[9.5px] leading-none tnum',
                    isToday || isPicked
                      ? 'text-brand-strong font-semibold'
                      : total > 0
                        ? 'text-ink2'
                        : 'text-ink3',
                  )}
                >
                  {monthStart ? `${Number(date.slice(5, 7))}/${day}` : day}
                </span>

                {/* 堆叠条从底部往上长，顶部留 14px 给日号；
                    窄屏（格子约 48px）占满宽度，宽屏限宽居中 —— 否则桌面端 90px 的格子
                    会被拉成一条长条，看起来不像「当天的时长」而像一条色带 */}
                <span className="absolute left-[3px] right-[3px] bottom-[3px] top-[14px] flex flex-col-reverse items-center">
                  <span
                    className="w-full max-w-[46px] flex flex-col-reverse rounded-[3px] overflow-hidden"
                    style={{ height: `${ratio * 100}%` }}
                  >
                    {series.map((s) => {
                      const value = point.values[s.key] ?? 0;
                      if (value <= 0) return null;
                      return (
                        <span
                          key={s.key}
                          className="block w-full"
                          style={{ height: `${(value / total) * 100}%`, background: s.color }}
                        />
                      );
                    })}
                  </span>
                </span>
              </button>
            );
          }),
        )}
      </div>

      <div className="flex items-center justify-between mt-3 text-[11.5px] text-ink3">
        <span className="tnum">
          有记录 {activeDays} 天 · 日均{' '}
          {formatMinutes(Math.round(sum / Math.max(1, activeDays)))}
        </span>
        <span className="tnum">峰值 {formatMinutes(peak === 1 ? 0 : peak)}</span>
      </div>

      <Legend series={series} />

      {picked && (
        <DayDetail
          title={detailTitle(picked.meta!)}
          total={totalOf(picked)}
          series={series}
          values={picked.values}
        />
      )}

      {activeDays === 0 && <p className="text-center text-[12px] text-ink3 mt-3">{emptyHint}</p>}
    </div>
  );
}

// ── 热力图 ────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 热力图单格。
 *
 * 单独成组件 + memo 的理由：格子数是「周数 × 7」，近 6 个月 182 个、
 * 切到「全程」按 3 年算是 1092 个。hover 时如果整张图重渲染，React 要
 * reconcile 全部格子（PERF-REVIEW.md P1-3）。拆出来之后 hover 只重渲染底部那行文字。
 *
 * 注意 props 必须稳定，否则 memo 会被击穿：
 *   - onEnter / onLeave 由父组件 useCallback 固定
 *   - 「取哪个 cell」交给子组件自己做（onEnter(cell)），父组件里不写
 *     onMouseEnter={() => setHover(cell)} —— 那样每次渲染都生成新闭包，等于没加 memo
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

export function Heatmap({
  cells,
  weekStart = 1,
}: {
  cells: HeatCell[];
  weekStart?: 0 | 1;
}) {
  const [hover, setHover] = useState<HeatCell | null>(null);

  const { weeks, monthMarks } = useMemo(() => {
    if (cells.length === 0) return { weeks: [] as Array<Array<HeatCell | null>>, monthMarks: [] as Array<string | null> };

    const first = new Date(`${cells[0].date}T00:00:00Z`);
    const firstWeekday = first.getUTCDay();
    const pad = (firstWeekday - weekStart + 7) % 7;

    const padded: Array<HeatCell | null> = [...Array<HeatCell | null>(pad).fill(null), ...cells];
    const out: Array<Array<HeatCell | null>> = [];
    for (let i = 0; i < padded.length; i += 7) {
      out.push(padded.slice(i, i + 7));
    }

    // 月份标记：某列包含「1 号」就标出月份
    const marks = out.map((week) => {
      for (const cell of week) {
        if (cell && cell.date.endsWith('-01')) return `${Number(cell.date.slice(5, 7))}月`;
      }
      return null;
    });

    return { weeks: out, monthMarks: marks };
  }, [cells, weekStart]);

  // 只依赖 cells：这两个统计量原来跟 hover 一起在渲染体里算，hover 一动就白算一遍
  const { totalMinutes, activeDays } = useMemo(() => {
    let total = 0;
    let active = 0;
    for (const c of cells) {
      total += c.minutes;
      if (c.minutes > 0) active++;
    }
    return { totalMinutes: total, activeDays: active };
  }, [cells]);

  const enter = useCallback((c: HeatCell) => setHover(c), []);
  const leave = useCallback(() => setHover(null), []);

  return (
    <div>
      <div className="flex items-start gap-1.5">
        {/* 星期轴：只标 一 / 三 / 五，避免拥挤 */}
        <div className="flex flex-col gap-[3px] pt-[15px] shrink-0">
          {Array.from({ length: 7 }, (_, i) => {
            const wd = (weekStart + i) % 7;
            const show = wd === 1 || wd === 3 || wd === 5;
            return (
              <span key={i} className="text-[9.5px] text-ink3 leading-[12px] h-3">
                {show ? WEEKDAY_LABELS[wd] : ''}
              </span>
            );
          })}
        </div>

        <div className="flex-1 overflow-x-auto no-scrollbar pb-1">
          <div className="flex gap-[3px] min-w-max">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                <span className="text-[9.5px] text-ink3 h-3 leading-3 whitespace-nowrap">
                  {monthMarks[wi] ?? ''}
                </span>
                {week.map((cell, di) =>
                  cell ? (
                    <HeatCellSquare key={cell.date} cell={cell} onEnter={enter} onLeave={leave} />
                  ) : (
                    <span key={`pad-${wi}-${di}`} className="w-3 h-3" />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-2.5 gap-2">
        <span className="text-[11.5px] text-ink3 tnum">
          {hover
            ? `${hover.date} · ${hover.minutes > 0 ? formatMinutes(hover.minutes) : '没有记录'}`
            : `有记录 ${activeDays} 天 · 累计 ${formatMinutes(totalMinutes)}`}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-ink3 shrink-0">
          少
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className={`hm-${l} w-3 h-3 rounded-[3px] inline-block`} />
          ))}
          多
        </span>
      </div>
    </div>
  );
}

// ── 占比条 ────────────────────────────────────────────────────────────

export function ShareBars({
  data,
  showPct = true,
  /** 条形长度按最大值归一（用于「科目总时长」卡片），否则按总和归一（占比） */
  normalizeBy = 'sum',
  emptyHint = '这段时间还没有记录',
}: {
  data: Array<SliceDatum & { pct?: number }>;
  showPct?: boolean;
  normalizeBy?: 'sum' | 'max';
  emptyHint?: string;
}) {
  if (data.length === 0) {
    return <p className="text-center text-[12.5px] text-ink3 py-6">{emptyHint}</p>;
  }

  const sum = data.reduce((s, d) => s + d.value, 0);
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="space-y-0.5">
      {data.map((d) => {
        const ratio = normalizeBy === 'max' ? d.value / max : d.value / Math.max(1, sum);
        const pct = d.pct ?? (sum > 0 ? Math.round((d.value / sum) * 1000) / 10 : 0);
        return (
          <div key={d.label} className="flex items-center gap-2.5 py-2 border-b border-line/60 last:border-b-0">
            <span className="w-14 text-[12.5px] text-ink truncate shrink-0">{d.label}</span>
            <span className="flex-1 h-2.5 bg-soft rounded-full overflow-hidden">
              <span
                className="block h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.max(2, ratio * 100)}%`, background: d.color }}
              />
            </span>
            <span className="w-[68px] text-right text-[12px] text-ink2 tnum shrink-0">
              {showPct ? `${pct}%` : formatMinutes(d.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function TotalRow({ total }: { total: number }) {
  return (
    <div className="flex items-center justify-between mt-3 px-3.5 py-2.5 rounded-xl bg-soft border border-dashed border-brand-line text-[13px] text-ink2">
      <span>合计</span>
      <b className="text-[16px] text-brand-strong tnum">{formatMinutes(total)}</b>
    </div>
  );
}

