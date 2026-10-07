import { ok, requireSession, route } from '@/lib/server/http';
import { getSnapshot, listAchievements } from '@/lib/server/data';
import { todayLocalDate } from '@/lib/domain/time';
import { resolveLevel } from '@/lib/domain/leveling';
import { badgeProgress, nextTarget } from '@/lib/domain/achievements';
import { BADGES } from '@/lib/domain/achievements';

export const dynamic = 'force-dynamic';

/**
 * GET /api/achievements —— 徽章墙 + 等级卡数据
 * 未解锁徽章一并带上 progress（0-1），成就页可直接画进度提示。
 */
export const GET = route(async () => {
  await requireSession();
  const today = todayLocalDate();
  // 快照只算一次并复用，避免 listAchievements 内部再算一遍
  const snapshot = await getSnapshot(today);
  const badges = await listAchievements(today, snapshot);

  const target = nextTarget(snapshot);

  return ok({
    level: resolveLevel(snapshot.totalMinutes),
    unlockedCount: badges.filter((b) => b.unlockedAt !== null).length,
    totalCount: BADGES.length,
    badges: badges.map((b) => ({
      ...b,
      progress: b.unlockedAt ? 1 : badgeProgress(b.key, snapshot),
    })),
    nextTargetKey: target?.key ?? null,
    snapshot: {
      totalMinutes: snapshot.totalMinutes,
      totalSessions: snapshot.totalSessions,
      currentStreak: snapshot.currentStreak,
      longestStreak: snapshot.longestStreak,
      maxDayMinutes: snapshot.maxDayMinutes,
      subjectCount: snapshot.subjectCount,
    },
  });
});
