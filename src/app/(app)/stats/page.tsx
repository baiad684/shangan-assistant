import { StatsView } from '@/components/stats/StatsView';
import { getSettings } from '@/lib/server/settings';
import { heatmapData, shareData, summaryData } from '@/lib/server/statsService';
import { daysUntil, todayLocalDate } from '@/lib/domain/time';

export const dynamic = 'force-dynamic';

/**
 * 统计页（快捷键 2）
 *
 * 三个统计接口在服务端并行取齐后一次性注入，首屏不会有「柱状图先到、热力图后到」的跳动。
 */
export default async function StatsPage() {
  const today = todayLocalDate();

  const [settings, summary, heatmap, share] = await Promise.all([
    getSettings(),
    summaryData('week'),
    heatmapData('6m', today),
    shareData('30d', today),
  ]);

  return (
    <StatsView
      dday={daysUntil(settings.examDate, today)}
      initialSummary={summary}
      initialHeatmap={heatmap}
      initialShare={share}
    />
  );
}
