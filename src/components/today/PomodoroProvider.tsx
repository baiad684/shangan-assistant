'use client';

/**
 * 番茄钟容器：把「计时状态机 + 离线提交队列 + 屏幕常亮 + 成就弹窗 + 今日数据刷新」串起来。
 *
 * 之所以做成 Provider 而不是写在卡片组件里：电脑端快捷键（空格开始/暂停）
 * 需要一个全局可达的控制器实例，否则快捷键和卡片各持有一份状态，必然打架。
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import {
  requestNotificationPermission,
  usePomodoro,
  type PomodoroController,
} from '@/hooks/usePomodoro';
import { useFocusQueue } from '@/hooks/useFocusQueue';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useToast } from '@/components/ui/overlay';
import { useUnlock } from '@/components/achievements/UnlockProvider';
import { useToday } from './TodayProvider';
import { formatMinutes } from '@/lib/domain/time';
import type { PomodoroSettings } from '@/lib/types';

interface PomodoroContextValue {
  controller: PomodoroController;
  /** 开始/暂停切换（卡片按钮与空格快捷键共用同一入口） */
  toggle: () => void;
  pendingSubmissions: number;
  /** 只有空闲时才允许切换科目（IMPLEMENTATION.md §4.2：开始前必须选科目） */
  canSwitchSubject: boolean;
}

/**
 * 只含「动作」的稳定 context。
 *
 * 为什么要拆成两层：controller 里带着 remaining/progress 这些随心跳变化的值，
 * 于是 PomodoroContext 的 value 每一跳都是新对象。而应用外壳（AppShell 的快捷键、
 * 底部导航那一片）其实只需要 toggle —— 用这个 context 之后它彻底脱离心跳，
 * 不会再为了画一个倒计时数字而重渲染整个外壳（PERF-REVIEW.md P0-3）。
 */
interface PomodoroActions {
  toggle: () => void;
  start: () => void;
  pause: () => void;
  abort: () => void;
  discard: () => void;
  setSubject: (id: number | null) => void;
  setPlannedMinutes: (minutes: number) => void;
}

const PomodoroContext = createContext<PomodoroContextValue | null>(null);
const PomodoroActionsContext = createContext<PomodoroActions | null>(null);

export function usePomodoroCtx(): PomodoroContextValue {
  const ctx = useContext(PomodoroContext);
  if (!ctx) throw new Error('usePomodoroCtx 必须在 PomodoroProvider 内使用');
  return ctx;
}

/** 只要动作、不要计时值的组件用这个：订阅它就不会跟着心跳重渲染 */
export function usePomodoroActions(): PomodoroActions {
  const ctx = useContext(PomodoroActionsContext);
  if (!ctx) throw new Error('usePomodoroActions 必须在 PomodoroProvider 内使用');
  return ctx;
}

export function PomodoroProvider({
  settings,
  children,
}: {
  settings: PomodoroSettings;
  children: ReactNode;
}) {
  const toast = useToast();
  const unlock = useUnlock();
  const today = useToday();

  const queue = useFocusQueue({
    onRecorded: (session, unlocks, deduped) => {
      // 服务端返回的 session 是权威值，用它校正本地乐观累加的误差
      if (deduped) {
        toast.show(`已补交记录：${formatMinutes(session.focusMinutes)} · ${session.subjectName}`);
      } else {
        toast.success(`已记录 ${formatMinutes(session.focusMinutes)} · ${session.subjectName}`);
      }
      if (unlocks.length > 0) unlock.push(unlocks);
    },
    onFatal: (message) => toast.error(message),
    onFlushed: (count) => toast.success(`已补交 ${count} 条离线记录`),
  });

  const controller = usePomodoro({
    focusMinutes: settings.focusMinutes,
    shortBreakMinutes: settings.shortBreakMinutes,
    longBreakMinutes: settings.longBreakMinutes,
    longBreakEvery: settings.longBreakEvery,
    longBreakEnabled: settings.longBreakEnabled,
    onSettle: (session) => {
      // 本地先乐观加上，进度条立即有反馈；联网成功后由 router.refresh 校正
      today.patchAggregate({
        minutes: today.aggregate.minutes + session.focusMinutes,
        totalMinutes: today.aggregate.totalMinutes + session.focusMinutes,
      });
      void queue.submit(session);
    },
  });

  // 计时进行中保持屏幕常亮；锁屏后靠时间戳机制兜底（IMPLEMENTATION.md §7.3）
  useWakeLock(controller.phase === 'running');

  /**
   * 依赖从 controller 换成 [controller.phase, pause, start]：
   * pause / start 在 usePomodoro 里都是 useCallback([])，引用恒定；
   * phase 只在「空闲→计时→暂停→完成」这些真实换挡时变。
   * 原来写 [controller]，而 controller 每 250ms 换一次 —— toggle 也就跟着每 250ms 换，
   * 于是基于它 memo 的 actions 永远不稳定。
   */
  const toggle = useCallback(() => {
    const phase = controller.phase;
    if (phase === 'running') {
      controller.pause();
      return;
    }
    controller.start();
    // 首次开始专注时自然引导通知授权
    if (phase === 'idle') void requestNotificationPermission();
  }, [controller.phase, controller.pause, controller.start]);

  const {
    start,
    pause,
    abort,
    discard,
    setSubject,
    setPlannedMinutes,
  } = controller;

  /** 动作层：所有成员引用都稳定（abort 依赖 [tomatoes]，只在番茄完成时变一次） */
  const actions = useMemo<PomodoroActions>(
    () => ({ toggle, start, pause, abort, discard, setSubject, setPlannedMinutes }),
    [toggle, start, pause, abort, discard, setSubject, setPlannedMinutes],
  );

  const value = useMemo<PomodoroContextValue>(
    () => ({
      controller,
      toggle,
      pendingSubmissions: queue.pending,
      canSwitchSubject: controller.phase === 'idle',
    }),
    [controller, toggle, queue.pending],
  );

  return (
    <PomodoroActionsContext.Provider value={actions}>
      <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>
    </PomodoroActionsContext.Provider>
  );
}
