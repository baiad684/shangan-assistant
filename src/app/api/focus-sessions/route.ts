import { ok, readValidatedBody, requireSession, route, searchParam } from '@/lib/server/http';
import {
  createFocusSession,
  detectAndUnlock,
  getSnapshot,
  listManualSessions,
  listSessionsBetween,
} from '@/lib/server/data';
import { addDays, todayLocalDate } from '@/lib/domain/time';
import { resolveLevel } from '@/lib/domain/leveling';
import { CHECKIN_MINUTES, PASS_MINUTES, type FocusSource, type StatsSnapshot } from '@/lib/types';
import { focusCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/focus-sessions
 *   ?date=YYYY-MM-DD              该日全部专注记录（战报卡片按科目分组用）
 *   ?date=YYYY-MM-DD&source=manual 该日仅手动补记（今日页列表用）
 *   ?from=&to=                     区间查询
 */
export const GET = route(async (req: Request) => {
  await requireSession();
  const today = todayLocalDate();

  const date = searchParam(req, 'date');
  if (date) {
    if (searchParam(req, 'source') === 'manual') {
      return ok({ from: date, to: date, sessions: await listManualSessions(date) });
    }
    return ok({ from: date, to: date, sessions: await listSessionsBetween(date, date) });
  }

  const from = searchParam(req, 'from') ?? addDays(today, -6);
  const to = searchParam(req, 'to') ?? today;
  return ok({ from, to, sessions: await listSessionsBetween(from, to) });
});

/**
 * POST /api/focus-sessions
 *
 * 番茄钟完成 / 中断 / 手动补记的统一入口。
 * 落库后立即在服务端做成就检测（决策 D5）—— 解锁是持久事实，服务端说了算，
 * 否则两台设备会各弹一次、清缓存后又丢失。
 *
 * 响应里回带今日聚合与等级，前端据此直接更新进度条 / 连续天数 / 经验条，无需二次请求。
 */
export const POST = route(async (req: Request) => {
  await requireSession();
  const body = await readValidatedBody(req, focusCreateSchema);
  const today = todayLocalDate();

  const { session, deduped } = await createFocusSession({
    clientId: body.clientId,
    subjectId: body.subjectId,
    startedAt: body.startedAt,
    focusMinutes: body.focusMinutes,
    plannedMinutes: body.plannedMinutes,
    pausedSeconds: body.pausedSeconds,
    source: body.source as FocusSource,
    note: body.note ?? null,
    localDate: body.localDate,
  });

  if (deduped) {
    // 离线队列重试：不重复触发成就检测，避免重复弹窗
    const snapshot = await getSnapshot(today);
    return ok({ session, deduped: true, unlocked: [], today: summarize(today, snapshot) });
  }

  const { snapshot, unlocked } = await detectAndUnlock(today);
  return ok({ session, deduped: false, unlocked, today: summarize(today, snapshot) }, 201);
});

function summarize(today: string, snapshot: StatsSnapshot) {
  const minutes = snapshot.dailyMinutes[today] ?? 0;
  return {
    date: today,
    minutes,
    checkedIn: minutes >= CHECKIN_MINUTES,
    passed: minutes >= PASS_MINUTES,
    currentStreak: snapshot.currentStreak,
    totalMinutes: snapshot.totalMinutes,
    level: resolveLevel(snapshot.totalMinutes),
  };
}
