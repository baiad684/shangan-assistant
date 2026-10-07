import { numericParam, ok, readValidatedBody, requireSession, route } from '@/lib/server/http';
import { archiveSubject, countSessionsBySubject, updateSubject } from '@/lib/server/data';
import { subjectPatchSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/subjects/[id] —— 改名 / 改色 / 排序 / 归档 */
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  await requireSession();
  const { id } = await ctx.params;
  const subjectId = numericParam(id, '科目 id');
  const body = await readValidatedBody(req, subjectPatchSchema);

  return ok({ subject: await updateSubject(subjectId, body) });
});

/** DELETE /api/subjects/[id] —— 软删除，保留历史统计 */
export const DELETE = route(async (req: Request, ctx: Ctx) => {
  await requireSession();
  const { id } = await ctx.params;
  const subjectId = numericParam(id, '科目 id');

  // 先数历史记录条数（归档后仍可数，但放在前面语义更清楚）
  const retainedSessions = await countSessionsBySubject(subjectId);
  const subject = await archiveSubject(subjectId);

  return ok({ subject, retainedSessions });
});
