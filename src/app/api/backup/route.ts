import { ok, requireSession, route, searchParam } from '@/lib/server/http';
import { listBackups, readBackupFile } from '@/lib/server/backup';

export const dynamic = 'force-dynamic';

/** GET /api/backup?name=YYYY-MM-DD.json —— 列出自动备份；带 name 则返回该份内容 */
export const GET = route(async (req: Request) => {
  await requireSession();
  const name = searchParam(req, 'name');
  if (name) return ok({ name, payload: await readBackupFile(name) });
  return ok({ backups: await listBackups() });
});
