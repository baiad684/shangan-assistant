'use client';

/**
 * 统计页视图（快捷键 2）
 *
 * 首屏数据由服务端组件注入（无瀑布请求），切换筛选时才走接口重取。
 * 四张卡片（柱状图 / 热力图 / 科目占比 / 科目总时长）与柱状图的当日明细
 * 全部来自 /api/stats/summary 的同一份聚合结果，避免口径漂移。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardHead, Segmented, cx } from '@/components/ui/base';
import { useToast } from '@/components/ui/overlay';
import { Heatmap, ShareBars, StackedBarChart, StudyCalendar, TotalRow } from '@/components/charts';
import { ReportDialog } from '@/components/report/ReportDialog';
import { api, errorMessage } from '@/lib/api-client';
import { formatDateCN, formatMinutes } from '@/lib/domain/time';
import type { HeatCell, SeriesDef, SliceDatum, StackedPoint } from '@/lib/types';

type BarRange = 'week' | 'month';
type HeatMode = '6m' | 'all';
type ShareRange = '7d' | '30d' | 'all';

/** 'YYYY-MM-DD' → 'M/D'（卡片副标题用，和柱状图横轴标签同一套写法） */
function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

export interface SummaryPayload {
  range: string;
  from: string;
  to: string;
  /** 服务端的「今天」；week 区间的 to 是周日（在未来），靠它区分「还没到」和「没学」 */
  today: string;
  /** 周起始日（0=周日 1=周一），来自设置；两个日历图的行首都要跟它对齐 */
  weekStart: 0 | 1;
  dates: string[];
  points: StackedPoint[];
  series: SeriesDef[];
  dailyTotals: Array<{ date: string; minutes: number; checkedIn: boolean; passed: boolean }>;
  subjectTotals: Array<SliceDatum & { subjectId: number }>;
  totalMinutes: number;
  allTimeTotalMinutes: number;
  allTimeSubjectTotals: Array<SliceDatum & { subjectId: number }>;
}

export interface HeatmapPayload {
  mode: string;
  from: string;
  to: string;
  cells: HeatCell[];
  /** 热力图的行首对齐（0=周日 1=周一） */
  weekStart: 0 | 1;
  totalMinutes: number;
  activeDays: number;
  maxDayMinutes: number;
}

export interface SharePayload {
  range: string;
  from: string;
  to: string;
  slices: Array<SliceDatum & { subjectId: number; pct: number }>;
  totalMinutes: number;
}

export function StatsView({
  dday,
  initialSummary,
  initialHeatmap,
  initialShare,
}: {
  dday: number;
  initialSummary: SummaryPayload;
  initialHeatmap: HeatmapPayload;
  initialShare: SharePayload;
}) {
  const toast = useToast();

  const [barRange, setBarRange] = useState<BarRange>('week');
  const [heatMode, setHeatMode] = useState<HeatMode>('6m');
  const [shareRange, setShareRange] = useState<ShareRange>('30d');

  const [summary, setSummary] = useState(initialSummary);
  const [heatmap, setHeatmap] = useState(initialHeatmap);
  const [share, setShare] = useState(initialShare);

  const [loading, setLoading] = useState(false);

  /**
   * 周 / 近 30 天两份聚合结果各自缓存。
   *
   * 之前这里写的是「切回 week 就 return，不重复请求」——那个 early return 是真的不请求，
   * 于是 summary 永远停在 30 天的结果上，点回「本周」图表和标题都回不去。
   * 正确做法是缓存两份：来回切换零请求，且状态一定跟着档位走。
   */
  const summaryCache = useRef<Partial<Record<BarRange, SummaryPayload>>>({
    week: initialSummary,
  });

  useEffect(() => {
    const cached = summaryCache.current[barRange];
    if (cached) {
      setSummary(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<SummaryPayload>(`/api/stats/summary?range=${barRange === 'month' ? '30d' : 'week'}`)
      .then((res) => {
        if (cancelled) return;
        summaryCache.current[barRange] = res;
        setSummary(res);
      })
      .catch((err) => {
        if (!cancelled) toast.error(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [barRange, toast]);

  const loadHeatmap = useCallback(
    (mode: HeatMode) => {
      setHeatMode(mode);
      if (mode === '6m' && heatmap.mode === '6m') return;
      api
        .get<HeatmapPayload>(`/api/stats/heatmap?months=${mode === 'all' ? 'all' : '6'}`)
        .then(setHeatmap)
        .catch((err) => toast.error(errorMessage(err)));
    },
    [heatmap.mode, toast],
  );

  const loadShare = useCallback(
    (range: ShareRange) => {
      setShareRange(range);
      if (range === '30d' && share.range === '30d') return;
      api
        .get<SharePayload>(`/api/stats/share?range=${range}`)
        .then(setShare)
        .catch((err) => toast.error(errorMessage(err)));
    },
    [share.range, toast],
  );

  /** 档位是权威来源；不要用 points.length 反推，否则数据没跟上时标题会和档位打架 */
  const isWeek = barRange === 'week';

  return (
    <div className="px-4 pt-3 flex flex-col gap-3">
      {/* 本周 / 近 30 天学习时长 */}
      <Card className={cx(loading && 'opacity-70 transition-opacity')}>
        <CardHead
          title={isWeek ? '本周学习时长' : '近 30 天学习'}
          hint={isWeek ? '按科目 · 点柱子看明细' : '按科目 · 点格子看明细'}
          right={
            <Segmented
              size="sm"
              value={barRange}
              onChange={setBarRange}
              options={[
                { value: 'week', label: '本周' },
                { value: 'month', label: '近 30 天' },
              ]}
            />
          }
        />
        {isWeek ? (
          <StackedBarChart
            points={summary.points}
            series={summary.series}
            today={summary.today}
            detailTitle={(date) => formatDateCN(date)}
          />
        ) : (
          <StudyCalendar
            points={summary.points}
            series={summary.series}
            today={summary.today}
            weekStart={summary.weekStart}
            detailTitle={(date) => formatDateCN(date)}
          />
        )}
        <div className="mt-3 flex items-center justify-between text-[12.5px] text-ink2 border-t border-line/70 pt-3">
          <span>
            {isWeek ? '本周合计' : '近 30 天合计'}
            <span className="ml-2 text-[11.5px] text-ink3 tnum">
              {shortDate(summary.from)} ~ {shortDate(summary.to)}
              {isWeek && (summary.weekStart === 0 ? ' · 周日至周六' : ' · 周一至周日')}
            </span>
          </span>
          <b className="text-[15px] text-brand-strong tnum">{formatMinutes(summary.totalMinutes)}</b>
        </div>
      </Card>

      {/* 打卡热力图 */}
      <Card>
        <CardHead
          title="打卡热力图"
          hint={heatMode === '6m' ? '近 6 个月' : '备考全程'}
          right={
            <Segmented
              size="sm"
              value={heatMode}
              onChange={loadHeatmap}
              options={[
                { value: '6m', label: '近 6 月' },
                { value: 'all', label: '全程' },
              ]}
            />
          }
        />
        <Heatmap cells={heatmap.cells} weekStart={heatmap.weekStart} />
        <p className="text-[11.5px] text-ink3 mt-2">
          分档对齐三条线：空 / 有记录 / ≥1h 打卡 / ≥2h 达标 / ≥8h 达成目标
        </p>
      </Card>

      {/* 科目占比 */}
      <Card>
        <CardHead
          title="科目占比"
          right={
            <Segmented
              size="sm"
              value={shareRange}
              onChange={loadShare}
              options={[
                { value: '7d', label: '7 天' },
                { value: '30d', label: '30 天' },
                { value: 'all', label: '全部' },
              ]}
            />
          }
        />
        <ShareBars data={share.slices} />
        {share.totalMinutes > 0 && (
          <p className="text-[11.5px] text-ink3 mt-2">
            区间合计 {formatMinutes(share.totalMinutes)}（{share.from} ~ {share.to}）
          </p>
        )}
      </Card>

      {/* 科目总时长（备考全程累计） */}
      <Card>
        <CardHead title="科目总时长" hint="备考全程累计 · 含手动补记" />
        <ShareBars data={summary.allTimeSubjectTotals} showPct={false} normalizeBy="max" />
        {summary.allTimeSubjectTotals.length > 0 && <TotalRow total={summary.allTimeTotalMinutes} />}
      </Card>

      <Card>
        <ReportDialog dday={dday} />
      </Card>

      <p className="text-[11.5px] text-ink3 text-center pb-4">
        统计口径以 Asia/Shanghai 切日；打卡线 1 小时、达标线 2 小时、目标线可在设置中调整。
      </p>
    </div>
  );
}
