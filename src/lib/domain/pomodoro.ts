/**
 * 番茄钟状态机（纯函数部分）
 *
 * 核心契约（IMPLEMENTATION.md §4.3 / ARCHITECTURE.md §5.1）：
 *   剩余时间 = 目标 − (已结算分段累计 + 当前分段已走时间)，任何时候现算。
 *   绝不使用定时器累加计时 —— 定时器只负责「触发重绘」，不负责「记录时间」。
 *   因此锁屏 / 切后台 / 刷新页面都不会让计时走偏：只要 startedAt 和分段起点还在，
 *   Date.now() 变了，结果自然就是对的。
 *
 * 把这段逻辑做成纯函数而非塞进组件，是为了能脱离浏览器直接断言（含锁屏 20 分钟的场景）。
 */

import type { FocusSource } from '../types';

export type PomodoroPhase = 'idle' | 'running' | 'paused' | 'done';

export interface PomodoroState {
  phase: PomodoroPhase;
  /** null = 尚未选择科目（注意：绝不要用 0 当「未选」哨兵，服务端校验是 positive()） */
  subjectId: number | null;
  plannedSeconds: number;
  /** 已结算的分段累计秒数（暂停时结算一次） */
  accumulatedSeconds: number;
  /** 当前分段起点（epoch ms）；paused/idle 时为 null */
  segmentStartedAt: number | null;
  /** 暂停累计秒数，如实记录，不计入统计与 XP */
  pausedSeconds: number;
  /** 本次暂停的起点（epoch ms）；仅 paused 时非 null，用于累计真实暂停时长 */
  pausedAt: number | null;
  /** 本次专注的绝对开始时间（ISO）—— 真正按下开始时才盖章，提交时作为 startedAt */
  startedAtIso: string | null;
  doneAtIso: string | null;
  /** 客户端 UUID，服务端据此做幂等，离线补交不会重复入库 */
  clientId: string | null;
}

export const IDLE_STATE: PomodoroState = {
  phase: 'idle',
  subjectId: null,
  plannedSeconds: 0,
  accumulatedSeconds: 0,
  segmentStartedAt: null,
  pausedSeconds: 0,
  pausedAt: null,
  startedAtIso: null,
  doneAtIso: null,
  clientId: null,
};

/** 中断/完成为 0 分钟时不予记录（避免堆积无意义的 0 分钟记录），架构决策 D12 */
export const MIN_RECORDABLE_MINUTES = 1;

export function createState(
  subjectId: number | null,
  plannedMinutes: number,
  clientId: string,
): PomodoroState {
  return {
    phase: 'idle',
    subjectId,
    plannedSeconds: Math.round(plannedMinutes * 60),
    accumulatedSeconds: 0,
    segmentStartedAt: null,
    pausedSeconds: 0,
    pausedAt: null,
    // 刻意不在这里盖 startedAt —— 此刻只是「准备好了」，
    // 真正的开始时间由 start() 盖章。否则先选科目、过一阵再开始，
    // 记录的开始时间会偏早，还会让「早鸟」徽章误判（真实踩过）。
    startedAtIso: null,
    doneAtIso: null,
    clientId,
  };
}

/** 已实际专注的秒数（不含暂停） */
export function elapsedSeconds(state: PomodoroState, now: number = Date.now()): number {
  const live = state.segmentStartedAt ? Math.max(0, (now - state.segmentStartedAt) / 1000) : 0;
  return state.accumulatedSeconds + live;
}

export function remainingSeconds(state: PomodoroState, now: number = Date.now()): number {
  return Math.max(0, state.plannedSeconds - elapsedSeconds(state, now));
}

/** 0-1，用于进度环 */
export function progress(state: PomodoroState, now: number = Date.now()): number {
  if (state.plannedSeconds <= 0) return 0;
  return Math.min(1, elapsedSeconds(state, now) / state.plannedSeconds);
}

export function isComplete(state: PomodoroState, now: number = Date.now()): boolean {
  return state.phase === 'running' && elapsedSeconds(state, now) >= state.plannedSeconds;
}

export function start(state: PomodoroState, now: number = Date.now()): PomodoroState {
  if (state.phase !== 'idle') return state;
  return {
    ...state,
    phase: 'running',
    segmentStartedAt: now,
    // 真正的开始时间在这里盖章（而不是 createState），见 createState 的注释。
    // start() 只处理 idle → running，继续暂停走的是 resume()，所以这里可以无条件盖章。
    startedAtIso: new Date(now).toISOString(),
  };
}

export function pause(state: PomodoroState, now: number = Date.now()): PomodoroState {
  if (state.phase !== 'running') return state;
  const settled = state.segmentStartedAt ? Math.max(0, (now - state.segmentStartedAt) / 1000) : 0;
  return {
    ...state,
    phase: 'paused',
    accumulatedSeconds: state.accumulatedSeconds + settled,
    segmentStartedAt: null,
    // 记下暂停起点。暂停时长要等 resume 时才知道，此刻一秒都还没暂停。
    pausedAt: now,
  };
}

export function resume(state: PomodoroState, now: number = Date.now()): PomodoroState {
  if (state.phase !== 'paused') return state;
  const pausedFor = state.pausedAt ? Math.max(0, (now - state.pausedAt) / 1000) : 0;
  return {
    ...state,
    phase: 'running',
    segmentStartedAt: now,
    pausedSeconds: state.pausedSeconds + pausedFor,
    pausedAt: null,
  };
}

/**
 * 结算为可提交的记录。
 * complete = true 走「走完全程」，focusMinutes 取原定时长；
 * complete = false 走「提前结束」，focusMinutes 取实际专注时长。
 */
export interface SettledSession {
  clientId: string;
  subjectId: number;
  startedAt: string;
  focusMinutes: number;
  plannedMinutes: number;
  pausedSeconds: number;
  source: FocusSource;
}

export function settle(
  state: PomodoroState,
  complete: boolean,
  now: number = Date.now(),
): SettledSession | null {
  if (!state.clientId || state.subjectId === null || !state.startedAtIso) return null;

  // 结算时若正处于暂停中，这段还没结算的暂停也要算进去，否则会漏报
  const ongoingPause = state.phase === 'paused' && state.pausedAt ? Math.max(0, (now - state.pausedAt) / 1000) : 0;
  const pausedSeconds = Math.round(state.pausedSeconds + ongoingPause);
  const plannedMinutes = Math.round(state.plannedSeconds / 60);

  // elapsedSeconds 本身就不含暂停时长（暂停时该分段已结算、segmentStartedAt 置空），
  // 所以中断的实际专注分钟直接取它即可，不需要额外扣除。
  const minutes = complete ? plannedMinutes : Math.round(elapsedSeconds(state, now) / 60);
  if (minutes < MIN_RECORDABLE_MINUTES) return null;

  return {
    clientId: state.clientId,
    subjectId: state.subjectId,
    startedAt: state.startedAtIso,
    focusMinutes: minutes,
    plannedMinutes,
    pausedSeconds,
    source: complete ? 'pomodoro' : 'stopped_early',
  };
}

/** 完成态：标记 done 并修正实际时长 */
export function markDone(state: PomodoroState, now: number = Date.now()): PomodoroState {
  const settled = state.segmentStartedAt ? Math.max(0, (now - state.segmentStartedAt) / 1000) : 0;
  return {
    ...state,
    phase: 'done',
    accumulatedSeconds: Math.min(state.plannedSeconds, state.accumulatedSeconds + settled),
    segmentStartedAt: null,
    pausedAt: null,
    doneAtIso: new Date(now).toISOString(),
  };
}

export function reset(): PomodoroState {
  return { ...IDLE_STATE };
}
