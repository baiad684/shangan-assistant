import { ok, readValidatedBody, requireSession, route, searchParam } from '@/lib/server/http';
import { createSubject, listSubjects, reorderSubjects } from '@/lib/server/data';
import { subjectCreateSchema, subjectReorderSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** GET /api/subjects?includeArchived=1 */
export const GET = route(async (req: Request) => {
  await requireSession();
  const includeArchived = searchParam(req, 'includeArchived') === '1';
  return ok({ subjects: await listSubjects({ includeArchived }) });
});

/** POST /api/subjects */
export const POST = route(async (req: Request) => {
  await requireSession();
  const body = await readValidatedBody(req, subjectCreateSchema);
  return ok({ subject: await createSubject(body.name, body.color) }, 201);
});

/** PUT /api/subjects —— 批量重排（sortOrder 持久化） */
export const PUT = route(async (req: Request) => {
  await requireSession();
  const body = await readValidatedBody(req, subjectReorderSchema);
  return ok({ subjects: await reorderSubjects(body.ids) });
});
