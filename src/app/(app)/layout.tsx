import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { bootstrap } from '@/lib/server/bootstrap';
import { hasSession } from '@/lib/server/http';
import { isOnboarded, getSettings } from '@/lib/server/settings';
import { getSnapshot, listItems, listSubjects } from '@/lib/server/data';
import { prisma } from '@/lib/server/db';
import { daysUntil, todayLocalDate } from '@/lib/domain/time';
import { resolveLevel } from '@/lib/domain/leveling';
import { CHECKIN_MINUTES, PASS_MINUTES } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * 已登录区域的布局（服务端组件）。
 *
 * 这里做三件在中间件里做不到的事：
 *   1. 查库确认引导是否完成（中间件跑在 Edge，用不了 Prisma）
 *   2. 触发启动钩子（预置科目 + 当天自动备份）
 *   3. 一次性取齐壳层与今日页需要的数据，直接交给客户端组件 —— 没有 HTTP 往返、类型端到端
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await hasSession())) redirect('/login');
  if (!(await isOnboarded())) redirect('/onboarding');

  await bootstrap();

  const today = todayLocalDate();
  const [settings, subjects, items, snapshot, latestUnlock] = await Promise.all([
    getSettings(),
    listSubjects(),
    listItems(today),
    getSnapshot(today),
    prisma.achievement.findFirst({ orderBy: { unlockedAt: 'desc' }, select: { unlockedAt: true } }),
  ]);

  const minutes = snapshot.dailyMinutes[today] ?? 0;

  return (
    <AppShell
      aggregate={{
        date: today,
        minutes,
        checkedIn: minutes >= CHECKIN_MINUTES,
        passed: minutes >= PASS_MINUTES,
        currentStreak: snapshot.currentStreak,
        totalMinutes: snapshot.totalMinutes,
        level: resolveLevel(snapshot.totalMinutes),
      }}
      items={items}
      subjects={subjects}
      goalMinutes={settings.dailyGoalMinutes}
      examDate={settings.examDate}
      dday={daysUntil(settings.examDate, today)}
      pomodoro={settings.pomodoro}
      latestUnlockAt={latestUnlock?.unlockedAt.toISOString() ?? null}
    >
      {children}
    </AppShell>
  );
}
