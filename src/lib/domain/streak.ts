/**
 * 连续打卡天数（IMPLEMENTATION.md §4.1 + ARCHITECTURE.md §5.3）
 *
 * 口径：当日专注总时长 ≥ 打卡线（1h）即算当日打卡。
 *
 * 关于「今天还没学够」的处理（架构决策 D8）：
 *   从今天往回数连续达标天数；若今天尚未达标，则从昨天开始数（当天视为宽限中，不断链）。
 *   否则连续天数会在每天零点瞬间归零、白天恢复，既是 bug 观感也是激励灾难。
 *
 * 纯函数，无 IO。
 */

import { CHECKIN_MINUTES } from '../types';
import { addDays, diffDays } from './time';

export interface StreakResult {
  /** 当前连续天数（含宽限逻辑） */
  current: number;
  /** 历史最长连续天数 */
  longest: number;
  /** 今天是否已达标 */
  todayQualified: boolean;
}

/** 当前连续天数 */
export function currentStreak(
  dailyMinutes: Record<string, number>,
  today: string,
  threshold = CHECKIN_MINUTES,
): number {
  const qualified = (d: string) => (dailyMinutes[d] ?? 0) >= threshold;

  // 今天已达标 → 从今天数；否则从昨天数，但要求昨天达标，避免「中断很久仍显示宽限」
  let cursor = qualified(today) ? today : addDays(today, -1);
  let n = 0;
  let guard = 0;
  while (qualified(cursor) && guard++ < 5000) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** 历史最长连续天数 */
export function longestStreak(
  dailyMinutes: Record<string, number>,
  threshold = CHECKIN_MINUTES,
): number {
  const days = Object.keys(dailyMinutes)
    .filter((d) => (dailyMinutes[d] ?? 0) >= threshold)
    .sort();
  if (days.length === 0) return 0;

  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (diffDays(days[i - 1], days[i]) === 1) run++;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

export function computeStreak(
  dailyMinutes: Record<string, number>,
  today: string,
  threshold = CHECKIN_MINUTES,
): StreakResult {
  return {
    current: currentStreak(dailyMinutes, today, threshold),
    longest: longestStreak(dailyMinutes, threshold),
    todayQualified: (dailyMinutes[today] ?? 0) >= threshold,
  };
}
