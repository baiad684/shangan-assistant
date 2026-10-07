'use client';

/**
 * 番茄钟控制器（ARCHITECTURE.md §5.1）
 *
 * 三条硬性要求，逐条对应实现：
 *   1. 计时只用时间戳差值 —— 状态机在 lib/domain/pomodoro.ts，这里只负责「触发重绘」。
 *      定时器本身不记录时间，所以切后台、锁屏、页面冻结都不会让计时走偏。
 *   2. 状态存 localStorage —— 页面刷新、误关、断网都不丢正在进行的番茄。
 *   3. 完成/中断时把结算结果交给 outbox 提交 —— 番茄钟本身不依赖网络。
 *
 * 休息倒计时用 endsAt 时间戳表示，和专注段共用同一套「差值」哲学。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createState,
  elapsedSeconds,
  isComplete,
  markDone,
  pause as pauseState,
  progress as progressState,
  remainingSeconds,
  resume as resumeState,
  settle,
  start as startState,
  type PomodoroState,
  type SettledSession,
} from '@/lib/domain/pomodoro';
import { todayLocalDate } from '@/lib/domain/time';

const STORAGE_KEY = 'shangan.pomodoro.v1';
const TOMATO_KEY = 'shangan.tomatoes.v1';
/**
 * 心跳间隔。定时器只用于重绘，不参与计时正确性（计时全靠 Date.now() 差值）。
 *
 * 取 1000 而不是更小：显示粒度本来就是 1 秒（formatClock 会取整），
 * 250ms 的 4 次心跳里有 3 次产出完全相同的 DOM —— 而且每次心跳都会让
 * PomodoroContext 的 value 变化，把使用者一起拖进 4Hz 重渲染（见 PERF-REVIEW.md P0-3）。
 *
 * 代价：到点判定最多晚 1 秒。结算走 settle() 取真实时间戳，所以记录时长不受影响。
 */
const TICK_MS = 1000;

export type BreakKind = 'short' | 'long';

interface Persisted {
  state: PomodoroState;
  tomatoes: number;
  tomatoDate: string;
}

interface BreakState {
  kind: BreakKind;
  endsAt: number;
  totalSeconds: number;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 兼容旧版本存下来的状态。
 * 早期版本用 0 表示「未选科目」，但服务端校验是 positive()，会把 0 判为非法；
 * 旧版本也没有 pausedAt 字段。这里统一归一化，避免升级后踩到脏数据。
 */
function normalizeState(raw: PomodoroState): PomodoroState {
  return {
    ...raw,
    subjectId: raw.subjectId === 0 ? null : (raw.subjectId ?? null),
    pausedAt: raw.pausedAt ?? null,
    pausedSeconds: Number.isFinite(raw.pausedSeconds) ? raw.pausedSeconds : 0,
  };
}

function readPersisted(): Persisted | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed?.state || typeof parsed.state !== 'object') return null;
    // 番茄计数按自然天清零（IMPLEMENTATION.md §4.2）
    const today = todayLocalDate();
    const state = normalizeState(parsed.state);
    if (parsed.tomatoDate !== today) {
      return { state, tomatoes: 0, tomatoDate: today };
    }
    return { state, tomatoes: parsed.tomatoes, tomatoDate: today };
  } catch {
    return null;
  }
}

export interface UsePomodoroOptions {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  longBreakEnabled: boolean;
  /** 完成或中断结算后回调（交给 outbox 提交） */
  onSettle: (session: SettledSession) => void;
}

export interface PomodoroController {
  phase: PomodoroState['phase'];
  subjectId: number | null;
  plannedMinutes: number;
  remaining: number;
  elapsed: number;
  progress: number;
  pausedSeconds: number;
  tomatoesToday: number;
  /** 距离下一次长休息还差几个番茄 */
  untilLongBreak: number;
  activeBreak: BreakState | null;
  canAbort: boolean;
  setSubject: (id: number | null) => void;
  setPlannedMinutes: (minutes: number) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  abort: () => void;
  /** 放弃本次并彻底复位（中断后调用） */
  discard: () => void;
  requestNotificationPermission: () => Promise<NotificationPermission | 'unsupported'>;
}

export function usePomodoro(options: UsePomodoroOptions): PomodoroController {
  const opts = useRef(options);
  opts.current = options;

  const [state, setState] = useState<PomodoroState>(() => createState(null, options.focusMinutes, ''));
  const [tomatoes, setTomatoes] = useState(0);
  const [activeBreak, setActiveBreak] = useState<BreakState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hydrated, setHydrated] = useState(false);

  const settledRef = useRef(false);

  // 结算（finish）需要读到「当前已提交的状态」，但 finish 自身是 useCallback 缓存的，
  // 不能把 state 加进依赖（会让 abort 每秒换引用，拖垮 actions context 的稳定性）。
  // 所以用 ref 镜像：每次渲染后它就是最新已提交状态，finish 随取随用。
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── 首次挂载：从 localStorage 恢复 ───────────────────────────────────
  useEffect(() => {
    const persisted = readPersisted();
    if (persisted) {
      setState(persisted.state);
      setTomatoes(persisted.tomatoes);
    } else {
      setState(createState(null, opts.current.focusMinutes, ''));
    }
    setHydrated(true);
    setNow(Date.now());
  }, []);

  // ── 持久化 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ state, tomatoes, tomatoDate: todayLocalDate() } satisfies Persisted),
      );
    } catch {
      // 隐私模式/存储满：静默降级，不影响计时
    }
  }, [state, tomatoes, hydrated]);

  // ── 到点判定 + 结算 ─────────────────────────────────────────────────
  //
  // ⚠️ 守卫与所有副作用必须在 setState 更新器**外面**。
  // 开发模式下 React StrictMode 会把更新器函数跑两遍（第一遍是丢弃返回值的纯度检查）。
  // 原来的写法把 `settledRef.current = true` 放在更新器里：第一遍置位后，
  // 第二遍的守卫直接返回 prev —— 整个状态过渡被丢弃。实测后果（浏览器点真按钮复现）：
  //   · 中断：记录照常提交（第一遍的副作用跑到了），但计时器**继续走**，看似「点了没反应」
  //   · 走完：记录照常提交，但相位永远到不了 done，**卡死在 00:00「专注中」**
  // 生产构建不开 StrictMode 所以一直没暴露 —— 这也是库里 stopped_early 长期为 0 的原因。
  const finish = useCallback(
    (reason: 'complete' | 'abort') => {
      if (settledRef.current) return;
      settledRef.current = true;

      const t = Date.now();
      const prev = stateRef.current;
      const payload = settle(prev, reason === 'complete', t);
      if (payload) opts.current.onSettle(payload);

      if (reason === 'complete') {
        const nextTomatoes = tomatoes + 1;
        setTomatoes(nextTomatoes);

        const isLong = opts.current.longBreakEnabled && nextTomatoes % opts.current.longBreakEvery === 0;
        const breakMinutes = isLong ? opts.current.longBreakMinutes : opts.current.shortBreakMinutes;
        setActiveBreak({
          kind: isLong ? 'long' : 'short',
          endsAt: t + breakMinutes * 60_000,
          totalSeconds: breakMinutes * 60,
        });

        notify(isLong ? '长休息时间' : '番茄完成', `该休息 ${breakMinutes} 分钟了`);
        setState(markDone(prev, t));
        return;
      }

      // 中断后回到 idle：保留科目方便接着练，但清空 clientId 与计时痕迹。
      // 这里传 prev.subjectId（可能是 null），绝不要写 ?? 0 ——
      // 0 不是合法科目 id，会一路带到提交时被服务端 positive() 拒掉。
      setState(createState(prev.subjectId, prev.plannedSeconds / 60, uuid()));
    },
    [tomatoes],
  );

  // ── 重绘心跳（只重绘，不计时）────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== 'running') return;

    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (isComplete(state, t)) finish('complete');
    };

    const id = window.setInterval(tick, TICK_MS);
    // 回前台立即重算并补触发到点（手机锁屏后 interval 会被冻结，这一步是兜底）
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [state, finish]);

  // ── 休息倒计时 ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeBreak) return;
    const tick = () => {
      if (Date.now() >= activeBreak.endsAt) {
        setActiveBreak(null);
        notify('休息结束', '可以开始下一个番茄了');
      } else {
        setNow(Date.now());
      }
    };
    const id = window.setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeBreak]);

  // ── 操作 ────────────────────────────────────────────────────────────

  const start = useCallback(() => {
    setState((prev) => {
      // 注意：这里的 settledRef / setActiveBreak 副作用**有意**留在更新器里 ——
      // 它们是幂等的（置 false / 清 null），且不参与决定返回值，所以 StrictMode
      // 把更新器跑两遍也不会丢过渡。finish() 就不一样：它的守卫会挡住第二遍，
      // 因此副作用必须放在外面（见 finish 处的长注释）。改之前想清楚这个区别。
      const t = Date.now();

      // 已完成 → 开下一个番茄：保留科目，换新的 clientId；startedAt 由 start() 盖章
      if (prev.phase === 'done') {
        settledRef.current = false;
        setActiveBreak(null);
        return startState(createState(prev.subjectId, prev.plannedSeconds / 60, uuid()), t);
      }

      // 已暂停 → 继续（不重置 settledRef，因为是同一段专注）
      if (prev.phase === 'paused') return resumeState(prev, t);

      if (prev.phase !== 'idle') return prev;

      // 从 idle 起步：补上 clientId 与目标时长
      settledRef.current = false;
      setActiveBreak(null);
      return startState(
        {
          ...prev,
          clientId: prev.clientId || uuid(),
          plannedSeconds: prev.plannedSeconds || opts.current.focusMinutes * 60,
        },
        t,
      );
    });
  }, []);

  const pause = useCallback(() => {
    setState((prev) => {
      if (prev.phase !== 'running') return prev;
      // 暂停时长的累计交给领域层（pause 记起点、resume 结算差值）。
      // 早期版本在这里用「本段已专注时长」当暂停时长，语义完全错了。
      return pauseState(prev, Date.now());
    });
  }, []);

  const abort = useCallback(() => finish('abort'), [finish]);

  const discard = useCallback(() => {
    settledRef.current = true;
    setActiveBreak(null);
    setState((prev) => createState(prev.subjectId, opts.current.focusMinutes, uuid()));
  }, []);

  const setSubject = useCallback((id: number | null) => {
    setState((prev) => (prev.phase === 'idle' ? { ...prev, subjectId: id } : prev));
  }, []);

  const setPlannedMinutes = useCallback((minutes: number) => {
    setState((prev) =>
      prev.phase === 'idle'
        ? { ...prev, plannedSeconds: Math.round(minutes * 60), clientId: prev.clientId || uuid() }
        : prev,
    );
  }, []);

  // 首次挂载时给 idle 状态补上默认时长与 clientId
  useEffect(() => {
    if (!hydrated) return;
    setState((prev) =>
      prev.phase === 'idle' && prev.plannedSeconds === 0
        ? { ...prev, plannedSeconds: opts.current.focusMinutes * 60, clientId: prev.clientId || uuid() }
        : prev,
    );
  }, [hydrated, options.focusMinutes]);

  const derived = useMemo(
    () => ({
      remaining: remainingSeconds(state, now),
      elapsed: elapsedSeconds(state, now),
      progress: progressState(state, now),
    }),
    [state, now],
  );

  const untilLongBreak = opts.current.longBreakEnabled
    ? opts.current.longBreakEvery - (tomatoes % opts.current.longBreakEvery)
    : 0;

  return {
    phase: state.phase,
    subjectId: state.subjectId,
    plannedMinutes: Math.round(state.plannedSeconds / 60),
    remaining: derived.remaining,
    elapsed: derived.elapsed,
    progress: derived.progress,
    pausedSeconds: state.pausedSeconds,
    tomatoesToday: tomatoes,
    untilLongBreak,
    activeBreak,
    canAbort: state.phase === 'running' || state.phase === 'paused',
    setSubject,
    setPlannedMinutes,
    start,
    pause,
    resume: start,
    abort,
    discard,
    requestNotificationPermission,
  };
}

/**
 * 结束提醒（IMPLEMENTATION.md §4.2）：页面弹窗由组件负责，这里只发浏览器通知。
 * 权限被拒或非安全上下文（局域网 HTTP）→ 静默返回，不报错、不打扰。
 */
export function notify(title: string, body: string): void {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;
  if (!window.isSecureContext) return; // 局域网 HTTP 下浏览器本就不允许
  if (Notification.permission !== 'granted') return;

  try {
    new Notification(title, { body, tag: 'shangan-pomodoro' });
  } catch {
    // 部分浏览器在非用户手势下会抛错，忽略即可
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  // 非安全上下文（局域网 HTTP）下浏览器不会弹权限框，直接告知不支持
  if (!window.isSecureContext) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;

  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}
