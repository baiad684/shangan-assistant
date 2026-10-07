import { errors, ok, readJsonBody, requireSession, route } from '@/lib/server/http';
import { importBackup } from '@/lib/server/backup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/backup/import —— 全量覆盖恢复
 *
 * 请求体有两种形态：完整备份文件本身，或 { payload: 备份文件 }。
 * 前端从文件读取的是前者，程序内传递是后者，两种都接受更省事。
 * 覆盖动作在事务里做（见 backup.importBackup），不会出现清空后写不回的半残状态。
 */
export const POST = route(async (req: Request) => {
  await requireSession();
  const body = await readJsonBody(req);

  const payload =
    body && typeof body === 'object' && 'payload' in (body as Record<string, unknown>)
      ? (body as Record<string, unknown>).payload
      : body;

  if (!payload || typeof payload !== 'object') throw errors.validation('备份内容为空');

  const counts = await importBackup(payload);
  return ok({ imported: true, counts });
});
