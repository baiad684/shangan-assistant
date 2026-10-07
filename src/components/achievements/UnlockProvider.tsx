'use client';

/**
 * 成就解锁弹窗（IMPLEMENTATION.md §4.8：解锁当刻立即弹窗）
 *
 * 为什么做成全局 Provider 而不是页面内弹窗：
 * 解锁由任意一次专注/补记触发（可能在统计页、也可能在番茄钟结束的瞬间），
 * 把「弹窗队列」放在根部才能保证不管用户当前在哪一页都能看到。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AchievementDTO } from '@/lib/types';
import { Button } from '@/components/ui/base';

interface UnlockApi {
  /** 推入待展示的解锁成就，逐枚弹窗 */
  push: (items: AchievementDTO[]) => void;
}

const UnlockContext = createContext<UnlockApi | null>(null);

export function useUnlock(): UnlockApi {
  const ctx = useContext(UnlockContext);
  if (!ctx) throw new Error('useUnlock 必须在 UnlockProvider 内使用');
  return ctx;
}

export function UnlockProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<AchievementDTO[]>([]);

  const push = useCallback((items: AchievementDTO[]) => {
    if (items.length === 0) return;
    setQueue((prev) => [...prev, ...items]);
  }, []);

  const current = queue[0] ?? null;
  const dismiss = useCallback(() => setQueue((prev) => prev.slice(1)), []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <UnlockContext.Provider value={api}>
      {children}

      {current && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-6"
          onClick={dismiss}
          role="dialog"
          aria-modal="true"
          aria-label={`解锁成就 ${current.name}`}
        >
          <div
            className="bg-card border border-line rounded-3xl px-7 py-8 max-w-[300px] w-full text-center anim-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] tracking-[3px] text-ink3">成 就 解 锁</p>

            <div
              className="anim-badge w-[76px] h-[76px] rounded-full mx-auto my-5 flex items-center justify-center text-white text-[20px] font-extrabold"
              style={{ background: current.color }}
            >
              {current.icon}
            </div>

            <h3 className="text-[19px] font-bold text-ink">{current.name}</h3>
            <p className="text-[12.5px] text-ink3 mt-1.5">{current.desc}</p>

            {queue.length > 1 && (
              <p className="text-[11.5px] text-brand-strong mt-3">还有 {queue.length - 1} 枚待揭晓</p>
            )}

            <Button block className="mt-6" onClick={dismiss}>
              {queue.length > 1 ? '看下一枚' : '收下'}
            </Button>
          </div>
        </div>
      )}
    </UnlockContext.Provider>
  );
}
