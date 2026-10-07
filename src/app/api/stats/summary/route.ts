import { ok, requireSession, route, searchParam } from '@/lib/server/http';
import { summaryData } from '@/lib/server/statsService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stats/summary?range=7d|30d|week|month|all
 *
 * 一次返回柱状图 + 每日明细 + 科目占比 + 科目总时长，
 * 因为 IMPLEMENTATION.md §4.6 要求「科目总时长」复用同一份聚合结果，不新增接口。
 */
export const GET = route(async (req: Request) => {
  await requireSession();
  return ok(await summaryData(searchParam(req, 'range')));
});
