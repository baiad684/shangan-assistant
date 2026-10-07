import { numericParam, ok, requireSession, route } from '@/lib/server/http';
import { deleteFocusSession, getSnapshot } from '@/lib/server/data';
import { todayLocalDate } from '@/lib/domain/time';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/focus-sessions/[id] —— 物理删除（前端有确认弹窗） */
export const DELETE = route(async (req: Request, ctx: Ctx) => {
  await requireSession();
  const { id } = await ctx.params;
  await deleteFocusSession(numericParam(id, '专注记录 id'));

  // 删除会改变时长口径，回带最新快照让前端立即刷新（连续天数可能随之回退）
  const today = todayLocalDate();
  const snapshot = await getSnapshot(today);
  return ok({
    deleted: true,
    today: {
      minutes: snapshot.dailyMinutes[today] ?? 0,
      currentStreak: snapshot.currentStreak,
      totalMinutes: snapshot.totalMinutes,
    },
  });
});
