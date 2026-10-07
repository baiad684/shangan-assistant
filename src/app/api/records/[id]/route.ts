import { numericParam, ok, requireSession, route } from '@/lib/server/http';
import { deleteItem } from '@/lib/server/data';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/records/[id] —— 物理删除（前端有确认弹窗） */
export const DELETE = route(async (req: Request, ctx: Ctx) => {
  await requireSession();
  const { id } = await ctx.params;
  await deleteItem(numericParam(id, '记录 id'));
  return ok({ deleted: true });
});
