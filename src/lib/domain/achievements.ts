/**
 * 成就体系（IMPLEMENTATION.md §4.8）
 *
 * 表驱动：加一枚徽章 = 往 BADGES 里加一条。不改查询、不改 UI（徽章墙由 BADGES 自动渲染）。
 * 判定用「历史最长」而不是「当前」连续天数 —— 成就是持久事实，
 * 一旦达成就不应因为后来断链而反复解锁/锁定（也保证 JSON 恢复后判定稳定）。
 *
 * 纯函数，无 IO。
 */

import { CHECKIN_MINUTES, PASS_MINUTES, type StatsSnapshot } from '../types';

export interface BadgeDef {
  key: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  test: (ctx: StatsSnapshot) => boolean;
}

const HOUR = 60;

export const BADGES: readonly BadgeDef[] = [
  {
    key: 'first_focus',
    name: '初来乍到',
    desc: '首次专注打卡',
    icon: '初',
    color: '#059669',
    test: (c) => c.totalSessions >= 1,
  },
  {
    key: 'streak_7',
    name: '七日不辍',
    desc: '连续 7 天打卡（≥1h）',
    icon: '7',
    color: '#0891b2',
    test: (c) => c.longestStreak >= 7,
  },
  {
    key: 'streak_21',
    name: '廿一日成习',
    desc: '连续 21 天打卡',
    icon: '21',
    color: '#0d9488',
    test: (c) => c.longestStreak >= 21,
  },
  {
    key: 'streak_100',
    name: '百日筑基',
    desc: '连续 100 天打卡',
    icon: '100',
    color: '#047857',
    test: (c) => c.longestStreak >= 100,
  },
  {
    key: 'pass_first',
    name: '当日达标',
    desc: `首次单日 ≥${PASS_MINUTES / HOUR}h`,
    icon: '达',
    color: '#d97706',
    test: (c) => c.maxDayMinutes >= PASS_MINUTES,
  },
  {
    key: 'pass_week',
    name: '达标周',
    desc: `连续 7 天每日 ≥${PASS_MINUTES / HOUR}h`,
    icon: '周',
    color: '#ea580c',
    test: (c) => c.longestPassStreak >= 7,
  },
  {
    key: 'total_100h',
    name: '百小时俱乐部',
    desc: '累计专注 100h',
    icon: '100h',
    color: '#7c3aed',
    test: (c) => c.totalMinutes >= 100 * HOUR,
  },
  {
    key: 'total_200h',
    name: '双百小时',
    desc: '累计专注 200h',
    icon: '200h',
    color: '#6d28d9',
    test: (c) => c.totalMinutes >= 200 * HOUR,
  },
  {
    key: 'total_500h',
    name: '五百小时',
    desc: '累计专注 500h',
    icon: '500h',
    color: '#4c1d95',
    test: (c) => c.totalMinutes >= 500 * HOUR,
  },
  {
    key: 'iron_man',
    name: '铁人',
    desc: '单日 ≥10h',
    icon: '铁',
    color: '#b91c1c',
    test: (c) => c.maxDayMinutes >= 10 * HOUR,
  },
  {
    key: 'early_bird',
    name: '早鸟',
    desc: '7:00 前开始第一段专注',
    icon: '早',
    color: '#ca8a04',
    test: (c) => c.hasEarlyBird,
  },
  {
    key: 'all_subjects',
    name: '全科大满贯',
    desc: '累计 ≥4 个科目有专注记录',
    icon: '科',
    color: '#0369a1',
    test: (c) => c.subjectCount >= 4,
  },
];

export const BADGE_MAP: ReadonlyMap<string, BadgeDef> = new Map(BADGES.map((b) => [b.key, b]));

/** 返回本次快照下所有「已满足」的徽章 key */
export function evaluate(ctx: StatsSnapshot): string[] {
  return BADGES.filter((b) => b.test(ctx)).map((b) => b.key);
}

/** 相对已解锁集合，返回新解锁的 key（保持 BADGES 声明顺序，弹窗按此顺序展示） */
export function newlyUnlocked(ctx: StatsSnapshot, alreadyUnlocked: Iterable<string>): string[] {
  const have = new Set(alreadyUnlocked);
  return evaluate(ctx).filter((key) => !have.has(key));
}

/** 下一枚可达成的徽章（成就页给一点方向感），无则返回 null */
export function nextTarget(ctx: StatsSnapshot): BadgeDef | null {
  const locked = BADGES.filter((b) => !b.test(ctx));
  if (locked.length === 0) return null;

  const progressOf = (b: BadgeDef): number => {
    switch (b.key) {
      case 'streak_7':
        return (ctx.longestStreak || ctx.currentStreak) / 7;
      case 'streak_21':
        return (ctx.longestStreak || ctx.currentStreak) / 21;
      case 'streak_100':
        return (ctx.longestStreak || ctx.currentStreak) / 100;
      case 'pass_first':
        return ctx.maxDayMinutes / PASS_MINUTES;
      case 'pass_week':
        return (ctx.longestPassStreak || ctx.currentPassStreak) / 7;
      case 'total_100h':
        return ctx.totalMinutes / (100 * HOUR);
      case 'total_200h':
        return ctx.totalMinutes / (200 * HOUR);
      case 'total_500h':
        return ctx.totalMinutes / (500 * HOUR);
      case 'iron_man':
        return ctx.maxDayMinutes / (10 * HOUR);
      case 'all_subjects':
        return ctx.subjectCount / 4;
      case 'early_bird':
        return ctx.hasEarlyBird ? 1 : 0;
      case 'first_focus':
        return ctx.totalSessions >= 1 ? 1 : 0;
      default:
        return 0;
    }
  };

  return locked
    .map((b) => ({ b, p: progressOf(b) }))
    .sort((x, y) => y.p - x.p)[0].b;
}

/** 徽章进度（0-1），成就页未解锁徽章上显示 */
export function badgeProgress(key: string, ctx: StatsSnapshot): number {
  const def = BADGE_MAP.get(key);
  if (!def) return 0;
  if (def.test(ctx)) return 1;

  const ratio = (a: number, b: number) => Math.max(0, Math.min(0.99, a / b));
  switch (key) {
    case 'streak_7':
      return ratio(Math.max(ctx.currentStreak, ctx.longestStreak), 7);
    case 'streak_21':
      return ratio(Math.max(ctx.currentStreak, ctx.longestStreak), 21);
    case 'streak_100':
      return ratio(Math.max(ctx.currentStreak, ctx.longestStreak), 100);
    case 'pass_first':
      return ratio(ctx.maxDayMinutes, PASS_MINUTES);
    case 'pass_week':
      return ratio(Math.max(ctx.currentPassStreak, ctx.longestPassStreak), 7);
    case 'total_100h':
      return ratio(ctx.totalMinutes, 100 * HOUR);
    case 'total_200h':
      return ratio(ctx.totalMinutes, 200 * HOUR);
    case 'total_500h':
      return ratio(ctx.totalMinutes, 500 * HOUR);
    case 'iron_man':
      return ratio(ctx.maxDayMinutes, 10 * HOUR);
    case 'all_subjects':
      return ratio(ctx.subjectCount, 4);
    case 'early_bird':
      return 0;
    case 'first_focus':
      return 0;
    default:
      return 0;
  }
}

/** 昨日是否达到打卡线（供「昨天断了」之类提示使用，保留扩展点） */
export function isCheckin(minutes: number): boolean {
  return minutes >= CHECKIN_MINUTES;
}
