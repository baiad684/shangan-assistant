'use client';

/**
 * 已登录应用的壳：顶部倒计时 + 底部导航 + 快捷键。
 *
 * 番茄钟控制器与今日数据都在这里 Provider 化，好处是「空格开始/暂停」这类全局快捷键
 * 与卡片组件共享同一个状态实例 —— 否则快捷键和按钮各持一份状态，必然互相打架。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cx } from '@/components/ui/base';
import { UnlockProvider } from '@/components/achievements/UnlockProvider';
import { HOTKEY_ROUTES, useHotkeys } from '@/hooks/useHotkeys';
import { PomodoroProvider, usePomodoroActions } from '@/components/today/PomodoroProvider';
import { TodayProvider, type TodayAggregate } from '@/components/today/TodayProvider';
import { NEW_RECORD_EVENT } from '@/components/today/RecordList';
import type { CompletedItemDTO, PomodoroSettings, SubjectDTO } from '@/lib/types';

const BADGE_SEEN_KEY = 'shangan.badges.seenAt';

const NAV = [
  { href: '/', label: '今日', icon: '◉' },
  { href: '/stats', label: '统计', icon: '▤' },
  { href: '/achievements', label: '成就', icon: '✦' },
  { href: '/settings', label: '设置', icon: '⚙' },
] as const;

export interface AppShellProps {
  aggregate: TodayAggregate;
  items: CompletedItemDTO[];
  subjects: SubjectDTO[];
  goalMinutes: number;
  examDate: string;
  dday: number;
  pomodoro: PomodoroSettings;
  /** 最近一次解锁时间，用于底部「成就」红点 */
  latestUnlockAt: string | null;
  children: ReactNode;
}

export function AppShell(props: AppShellProps) {
  const { children, ...data } = props;

  return (
    <TodayProvider
      initial={data.aggregate}
      items={data.items}
      subjects={data.subjects}
      goalMinutes={data.goalMinutes}
      examDate={data.examDate}
      dday={data.dday}
    >
      <UnlockProvider>
        <PomodoroProvider settings={data.pomodoro}>
          <ShellChrome dday={data.dday} latestUnlockAt={data.latestUnlockAt}>
            {children}
          </ShellChrome>
        </PomodoroProvider>
      </UnlockProvider>
    </TodayProvider>
  );
}

function ShellChrome({
  dday,
  latestUnlockAt,
  children,
}: {
  dday: number;
  latestUnlockAt: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // 只订阅动作层：外壳不需要倒计时数值，就不该跟着心跳重渲染
  const { toggle } = usePomodoroActions();
  const [hasUnseenBadge, setHasUnseenBadge] = useState(false);

  // 成就红点：用本地「已查看时间」与最近解锁时间比较
  useEffect(() => {
    if (!latestUnlockAt) {
      setHasUnseenBadge(false);
      return;
    }
    try {
      const seen = window.localStorage.getItem(BADGE_SEEN_KEY);
      setHasUnseenBadge(!seen || new Date(seen).getTime() < new Date(latestUnlockAt).getTime());
    } catch {
      setHasUnseenBadge(false);
    }
  }, [latestUnlockAt]);

  // 进入成就页即视为已查看
  useEffect(() => {
    if (pathname === '/achievements') {
      try {
        window.localStorage.setItem(BADGE_SEEN_KEY, new Date().toISOString());
      } catch {
        // 忽略
      }
      setHasUnseenBadge(false);
    }
  }, [pathname]);

  const handlers = useMemo(
    () => ({
      onTogglePomodoro: toggle,
      onNewRecord: () => {
        if (pathname !== '/') router.push('/');
        window.dispatchEvent(new Event(NEW_RECORD_EVENT));
      },
      onNavigate: (index: number) => {
        const target = HOTKEY_ROUTES[index];
        if (target) router.push(target);
      },
    }),
    [toggle, pathname, router],
  );

  useHotkeys(handlers);

  const go = useCallback((href: string) => router.push(href), [router]);

  return (
    <div className="min-h-dvh bg-canvas pb-safe">
      <div className="mx-auto max-w-[430px] md:max-w-[720px]">
        <header className="sticky top-0 z-20 bg-card/92 backdrop-blur-md border-b border-line px-4 pt-3.5 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[17px] font-bold">
            <i className="w-2.5 h-2.5 rounded-[3px] bg-brand inline-block" />
            上岸助手
          </div>
          <div
            className={cx(
              'rounded-full border px-3 py-1 text-[12.5px] font-semibold tnum',
              dday >= 0
                ? 'bg-brand-soft border-brand-line text-brand-strong'
                : 'bg-soft border-line text-ink3',
            )}
          >
            {dday >= 0 ? (
              <>
                距考研 <b className="text-[15px]">{dday}</b> 天
              </>
            ) : (
              <>
                考试已过 <b className="text-[15px]">{Math.abs(dday)}</b> 天
              </>
            )}
          </div>
        </header>

        <main className="anim-fade-up">{children}</main>
      </div>

      <nav
        className="fixed bottom-0 left-0 right-0 z-30 bg-card/95 backdrop-blur-lg border-t border-line nav-safe"
        aria-label="主导航"
      >
        <div className="mx-auto max-w-[430px] md:max-w-[720px] flex">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => go(item.href)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex-1 py-2.5 flex flex-col items-center gap-0.5 relative transition-colors',
                  active ? 'text-brand font-semibold' : 'text-ink3',
                )}
              >
                <span className="text-[19px] leading-tight">{item.icon}</span>
                <span className="text-[10.5px]">{item.label}</span>
                {item.href === '/achievements' && hasUnseenBadge && (
                  <span className="absolute top-2 right-[26%] w-2 h-2 rounded-full bg-danger" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
