/**
 * XP 与等级（IMPLEMENTATION.md §4.7）
 *   1 XP = 1 分钟实际专注时长（暂停不计、中断按实际分钟、手动补记计入）。
 *   下一级所需 XP（增量）= 120 × 1.4^(当前等级 − 1)，四舍五入到整数分钟。
 *
 * 纯函数，无 IO。
 */

import type { LevelInfo } from '../types';

export const XP_PER_MINUTE = 1;
const BASE_XP = 120;
const GROWTH = 1.4;

/** 从 level 升到 level+1 所需 XP 增量（这里是「还要多少」，不是累计） */
export function xpForNextLevel(level: number): number {
  const lv = Math.max(1, Math.floor(level));
  return Math.round(BASE_XP * Math.pow(GROWTH, lv - 1));
}

/** 达到 level 级所需的累计 XP（level 1 时为 0） */
export function cumulativeXpForLevel(level: number): number {
  const lv = Math.max(1, Math.floor(level));
  let sum = 0;
  for (let k = 1; k < lv; k++) sum += xpForNextLevel(k);
  return sum;
}

const TITLES = [
  '启程', // Lv1
  '入门',
  '渐入佳境',
  '稳中有进',
  '稳步前进', // Lv5
  '渐成大器',
  '势如破竹',
  '一往无前',
  '登峰在望',
  '上岸可期', // Lv10+
];

export function levelTitle(level: number): string {
  const lv = Math.max(1, Math.floor(level));
  return TITLES[Math.min(lv, TITLES.length) - 1];
}

/** 总 XP → 等级信息。等级无上限，曲线持续放缓。 */
export function resolveLevel(totalXp: number, maxLevel = 999): LevelInfo {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  let consumed = 0;
  while (level < maxLevel) {
    const need = xpForNextLevel(level);
    if (consumed + need > xp) {
      return {
        level,
        title: levelTitle(level),
        totalXp: xp,
        xpIntoLevel: xp - consumed,
        xpForNext: need,
        progress: need > 0 ? (xp - consumed) / need : 0,
      };
    }
    consumed += need;
    level++;
  }
  const need = xpForNextLevel(level);
  return {
    level,
    title: levelTitle(level),
    totalXp: xp,
    xpIntoLevel: xp - consumed,
    xpForNext: need,
    progress: need > 0 ? (xp - consumed) / need : 0,
  };
}

/** 分钟 → XP */
export function minutesToXp(minutes: number): number {
  return Math.max(0, Math.round(minutes)) * XP_PER_MINUTE;
}
