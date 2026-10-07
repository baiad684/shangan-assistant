import { ok, readValidatedBody, requireSession, route } from '@/lib/server/http';
import { getSettings, updateSettings } from '@/lib/server/settings';
import { settingsPatchSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** GET /api/settings */
export const GET = route(async () => {
  await requireSession();
  return ok({ settings: await getSettings() });
});

/**
 * PUT /api/settings —— 局部更新（只写提交了的键，不会把其他设置清空）
 */
export const PUT = route(async (req: Request) => {
  await requireSession();
  const patch = await readValidatedBody(req, settingsPatchSchema);
  return ok({ settings: await updateSettings(patch) });
});
