import { ok, requireSession, route, searchParam } from '@/lib/server/http';
import { heatmapData } from '@/lib/server/statsService';
import { todayLocalDate } from '@/lib/domain/time';

export const dynamic = 'force-dynamic';

/** GET /api/stats/heatmap?months=6|all */
export const GET = route(async (req: Request) => {
  await requireSession();
  const months = searchParam(req, 'months');
  return ok(await heatmapData(months === 'all' ? 'all' : '6m', todayLocalDate()));
});
