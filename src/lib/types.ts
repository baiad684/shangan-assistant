/**
 * 前后端共享的类型与常量。
 * 口径来源：IMPLEMENTATION.md §4。数值只在这里定义一次，任何地方不得再写字面量。
 */

/** 专注记录来源（IMPLEMENTATION.md §4.4 / QUESTIONS 三） */
export type FocusSource = 'pomodoro' | 'stopped_early' | 'manual';

export const FOCUS_SOURCES: readonly FocusSource[] = ['pomodoro', 'stopped_early', 'manual'];

/** 三层时长线。打卡线与达标线为固定保底线，只有目标线可配置。 */
export const CHECKIN_MINUTES = 60; // 打卡线 1h → 连续天数、热力图
export const PASS_MINUTES = 120; // 达标线 2h → 成就判定
export const DEFAULT_GOAL_MINUTES = 480; // 目标线 8h（可改）

/** 番茄钟参数默认值（IMPLEMENTATION.md §4.2） */
export const DEFAULT_POMODORO = {
  focusMinutes: 45,
  shortBreakMinutes: 10,
  longBreakMinutes: 20,
  longBreakEvery: 3,
  longBreakEnabled: true,
} as const;

export const PRESET_FOCUS_MINUTES = [25, 45, 50] as const;
export const FOCUS_MINUTES_MIN = 1;
export const FOCUS_MINUTES_MAX = 180;

/** 手动补记可回溯天数（当天 + 过去 7 天） */
export const MANUAL_BACKFILL_DAYS = 7;

/** 自动备份保留份数 */
export const BACKUP_KEEP = 30;

/** 登录失败锁定策略 */
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 10;
export const SESSION_DAYS = 30;

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  longBreakEnabled: boolean;
}

/** 面向客户端的设置（不含密码等敏感键） */
export interface AppSettings {
  /** 考试日期 YYYY-MM-DD */
  examDate: string;
  /** 目标线（分钟） */
  dailyGoalMinutes: number;
  /** 0 = 周日，1 = 周一 */
  weekStart: 0 | 1;
  pomodoro: PomodoroSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  examDate: '2027-12-18',
  dailyGoalMinutes: DEFAULT_GOAL_MINUTES,
  weekStart: 1,
  pomodoro: { ...DEFAULT_POMODORO },
};

/** 引导页预置科目（可选择/改名/删除） */
export const PRESET_SUBJECTS: ReadonlyArray<{ name: string; color: string }> = [
  { name: '政治', color: '#e05a5a' },
  { name: '英语', color: '#3b82f6' },
  { name: '数学', color: '#8b5cf6' },
  { name: '专业课一', color: '#f59e0b' },
  { name: '专业课二', color: '#0891b2' },
];

/** 科目可选色板 */
export const SUBJECT_PALETTE = [
  '#e05a5a',
  '#ef4444',
  '#f59e0b',
  '#ca8a04',
  '#10b981',
  '#059669',
  '#0891b2',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
] as const;

// ── DTO ────────────────────────────────────────────────────────────────

export interface SubjectDTO {
  id: number;
  name: string;
  color: string;
  archived: boolean;
  sortOrder: number;
}

export interface CompletedItemDTO {
  id: number;
  title: string;
  localDate: string;
  subjectId: number | null;
  note: string | null;
  createdAt: string;
}

export interface FocusSessionDTO {
  id: number;
  subjectId: number;
  subjectName: string;
  subjectColor: string;
  startedAt: string;
  localDate: string;
  focusMinutes: number;
  plannedMinutes: number | null;
  pausedSeconds: number;
  source: FocusSource;
  note: string | null;
}

export interface AchievementDTO {
  key: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  unlockedAt: string | null;
}

export interface LevelInfo {
  level: number;
  title: string;
  totalXp: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number;
}

/** 今日概览（今日页首屏一次取齐） */
export interface TodayOverview {
  today: string;
  todayMinutes: number;
  /** 目标线进度 0-100 */
  goalProgress: number;
  checkedIn: boolean;
  passed: boolean;
  currentStreak: number;
  dday: number;
  level: LevelInfo;
  subjects: SubjectDTO[];
  items: CompletedItemDTO[];
  todaySessions: FocusSessionDTO[];
}

/** 统计快照，供成就判定与统计页共用 */
export interface StatsSnapshot {
  totalSessions: number;
  totalMinutes: number;
  dailyMinutes: Record<string, number>;
  maxDayMinutes: number;
  subjectCount: number;
  currentStreak: number;
  longestStreak: number;
  currentPassStreak: number;
  longestPassStreak: number;
  hasEarlyBird: boolean;
}

// ── 图表数据契约（components/charts 的对外接口）──────────────────────────

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

export interface StackedPoint {
  label: string;
  /** key → 值（分钟） */
  values: Record<string, number>;
  meta?: string;
}

export interface HeatCell {
  date: string;
  minutes: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface SliceDatum {
  label: string;
  value: number;
  color: string;
}

// ── API 契约 ───────────────────────────────────────────────────────────

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'ONBOARDING_REQUIRED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'INTERNAL';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };
