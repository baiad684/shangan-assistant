import { NextResponse } from 'next/server';
import { requireSession, route } from '@/lib/server/http';
import { exportBackup } from '@/lib/server/backup';
import { todayLocalDate } from '@/lib/domain/time';

export const dynamic = 'force-dynamic';

/**
 * GET /api/backup/export —— 下载全量 JSON 备份
 * 带上 Content-Disposition，浏览器直接触发下载而不是渲染 JSON。
 */
export const GET = route(async () => {
  await requireSession();
  const payload = await exportBackup();

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="shangan-backup-${todayLocalDate()}.json"`,
      'cache-control': 'no-store',
    },
  });
});
