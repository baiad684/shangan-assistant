/**
 * 设置读写（ARCHITECTURE.md §3.2 决策 D4）
 *
 * Setting 表是 key/value + JSON。加一个设置项 = 在 DEFAULTS 加一行 + 设置页加一个控件，
 * 不产生 migration。读取时永远与 DEFAULTS 合并，所以旧库缺新字段也不会崩。
 */
import { prisma } from './db';
import { DEFAULT_SETTINGS, PRESET_SUBJECTS, type AppSettings, type PomodoroSettings } from '../types';

/** 不对外暴露的内部键 */
const INTERNAL_KEYS = ['passwordHash', 'authGuard', 'onboarded'] as const;
type InternalKey = (typeof INTERNAL_KEYS)[number];

export async function readRaw(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await readRaw(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 值被写坏时退回默认值，不让整个应用起不来
    console.warn(`[settings] 键 ${key} 的值不是合法 JSON，已退回默认值`);
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: serialized },
    update: { value: serialized },
  });
  // 兜住「绕过 updateSettings 直接写 app 键」的路径
  if (key === 'app') invalidateSettingsCache();
}

export async function unset(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
  if (key === 'app') invalidateSettingsCache();
}

function normalizeSettings(raw: Partial<AppSettings> | null): AppSettings {
  const base = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...base, pomodoro: { ...base.pomodoro } };

  const pomodoro: PomodoroSettings = { ...base.pomodoro, ...(raw.pomodoro ?? {}) };
  return {
    examDate: typeof raw.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.examDate) ? raw.examDate : base.examDate,
    dailyGoalMinutes:
      typeof raw.dailyGoalMinutes === 'number' && raw.dailyGoalMinutes > 0
        ? Math.round(raw.dailyGoalMinutes)
        : base.dailyGoalMinutes,
    weekStart: raw.weekStart === 0 ? 0 : 1,
    pomodoro: {
      focusMinutes: clamp(pomodoro.focusMinutes, 1, 180, base.pomodoro.focusMinutes),
      shortBreakMinutes: clamp(pomodoro.shortBreakMinutes, 1, 60, base.pomodoro.shortBreakMinutes),
      longBreakMinutes: clamp(pomodoro.longBreakMinutes, 1, 120, base.pomodoro.longBreakMinutes),
      longBreakEvery: clamp(pomodoro.longBreakEvery, 1, 12, base.pomodoro.longBreakEvery),
      longBreakEnabled: pomodoro.longBreakEnabled !== false,
    },
  };
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * 设置的内存缓存。
 *
 * 动机：打开一次统计页会调 getSettings 三次（layout / summaryData / heatmapData），
 * 每次一个 SQL 往返读同一行。设置是「读极多、写极少」的数据，最适合缓存。
 *
 * 一致性由两件事兜住：
 *   1. 写入侧（updateSettings / writeJson('app') / unset('app')）显式对齐缓存 —— 本进程内永不过期
 *   2. TTL 兜住「另一个进程改了库」：reset-data / seed-demo / verify-auth 都是独立进程写库的场景。
 *      这些脚本都是用户在终端里主动跑的，1 秒的窗口不可能被感知。
 *
 * 把 TTL 设为 0 即退化成「纯写失效」——本进程内依然正确，只是独立进程改库后需要重启 dev server。
 */
const CACHE_TTL_MS = 1000;
let appCache: { value: AppSettings; at: number } | null = null;

export function invalidateSettingsCache(): void {
  appCache = null;
}

export async function getSettings(): Promise<AppSettings> {
  const now = Date.now();
  if (appCache && now - appCache.at < CACHE_TTL_MS) return appCache.value;

  const raw = await readJson<Partial<AppSettings> | null>('app', null);
  const value = normalizeSettings(raw);
  appCache = { value, at: now };
  return value;
}

/** 局部更新用的补丁类型：pomodoro 允许只提交部分字段，与 pomodoroSchema.partial() 对齐 */
export interface SettingsPatch {
  examDate?: string;
  dailyGoalMinutes?: number;
  weekStart?: 0 | 1;
  pomodoro?: Partial<PomodoroSettings>;
}

/**
 * 局部更新。逐键合并而不是整体替换：
 * 客户端只提交「改动的字段」，未提及的设置项保持原值，不会被清空。
 */
export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  const current = await getSettings();

  const next: AppSettings = {
    examDate: patch.examDate ?? current.examDate,
    dailyGoalMinutes: patch.dailyGoalMinutes ?? current.dailyGoalMinutes,
    weekStart: patch.weekStart ?? current.weekStart,
    pomodoro: { ...current.pomodoro, ...(patch.pomodoro ?? {}) },
  };

  const normalized = normalizeSettings(next);
  await writeJson('app', normalized);
  // 写后立即对齐，不靠 TTL 过期 —— 设置页 PUT 完马上会读回来，这里不能有窗口
  appCache = { value: normalized, at: Date.now() };
  return normalized;
}

// ── 内部键（密码 / 锁定 / 引导状态）────────────────────────────────────

export interface AuthGuard {
  attempts: number;
  lockedUntil: number | null; // epoch ms
}

/**
 * 读取密码 hash。
 *
 * 必须用 readJson 而不是 readRaw —— setPasswordHash 是通过 writeJson 落库的，
 * 值在库里是带引号的 JSON 字符串。用 readRaw 会得到 "$2b$10$..." 这样首尾带引号的内容，
 * bcrypt.compare 会永远失败（这个坑真实踩过一次）。
 */
export async function getPasswordHash(): Promise<string | null> {
  const value = await readJson<string | null>('passwordHash', null);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function setPasswordHash(hash: string): Promise<void> {
  await writeJson('passwordHash', hash);
}

export async function getAuthGuard(): Promise<AuthGuard> {
  return readJson<AuthGuard>('authGuard', { attempts: 0, lockedUntil: null });
}

export async function setAuthGuard(guard: AuthGuard): Promise<void> {
  await writeJson('authGuard', guard);
}

export async function isOnboarded(): Promise<boolean> {
  const hash = await getPasswordHash();
  const flag = await readJson<boolean>('onboarded', false);
  return Boolean(hash) && flag;
}

export async function markOnboarded(): Promise<void> {
  await writeJson('onboarded', true);
}

export async function resetOnboarding(): Promise<void> {
  await unset('onboarded');
}

export { INTERNAL_KEYS, PRESET_SUBJECTS };
export type { InternalKey };
