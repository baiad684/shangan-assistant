import { ok, readValidatedBody, requireSession, route, searchParam } from '@/lib/server/http';
import { createItem, listItems } from '@/lib/server/data';
import { todayLocalDate } from '@/lib/domain/time';
import { itemCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** GET /api/records?date=YYYY-MM-DD —— 当日完成记录，按记录时间升序 */
export const GET = route(async (req: Request) => {
  await requireSession();
  const date = searchParam(req, 'date') ?? todayLocalDate();
  return ok({ date, items: await listItems(date) });
});

/** POST /api/records —— 记一笔 */
export const POST = route(async (req: Request) => {
  await requireSession();
  const body = await readValidatedBody(req, itemCreateSchema);
  const item = await createItem({
    title: body.title,
    subjectId: body.subjectId ?? null,
    note: body.note ?? null,
    date: body.date,
  });
  return ok({ item }, 201);
});
