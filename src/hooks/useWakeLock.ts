'use client';

/** 番茄钟运行期间保持屏幕常亮（IMPLEMENTATION.md §4.2 / §7.3） */

import { useEffect } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: string, listener: () => void) => void;
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
        };
        sentinel = await nav.wakeLock.request('screen');
        sentinel.addEventListener('release', () => {
          sentinel = null;
        });
      } catch {
        // 电量低 / 浏览器拒绝 / 非安全上下文：静默降级，锁屏后靠时间戳机制兜底
      }
    };

    void acquire();

    // 切到后台时浏览器会强制释放锁，回前台要重新申请
    const onVisible = () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
