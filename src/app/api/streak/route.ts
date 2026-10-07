import { ok, requireSession, route } from '@/lib/server/http';
import { getRecentDailyMinutes, getSnapshot } from '@/lib/server/data';
import { todayLocalDate } from '@/lib/domain/time';
import { computeStreak } from '@/lib/domain/streak';
import { CHECKIN_MINUTES, PASS_MINUTES } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** GET /api/streak —— 连续打卡天数 + 近 7 天迷你趋势 */
export const GET = route(async () => {
  await requireSession();
  const today = todayLocalDate();
  const [snapshot, recent] = await Promise.all([getSnapshot(today), getRecentDailyMinutes(7, today)]);

  const checkin = computeStreak(snapshot.dailyMinutes, today, CHECKIN_MINUTES);
  const pass = computeStreak(snapshot.dailyMinutes, today, PASS_MINUTES);

  return ok({
    today,
    todayMinutes: snapshot.dailyMinutes[today] ?? 0,
    current: checkin.current,
    longest: checkin.longest,
    todayCheckedIn: checkin.todayQualified,
    passStreak: { current: pass.current, longest: pass.longest },
    recent,
  });
});
