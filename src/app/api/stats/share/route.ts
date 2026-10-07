import { ok, requireSession, route, searchParam } from '@/lib/server/http';
import { shareData } from '@/lib/server/statsService';
import { todayLocalDate } from '@/lib/domain/time';

export const dynamic = 'force-dynamic';

/** GET /api/stats/share?range=7d|30d|all —— 各科目占比 */
export const GET = route(async (req: Request) => {
  await requireSession();
  return ok(await shareData(searchParam(req, 'range'), todayLocalDate()));
});
