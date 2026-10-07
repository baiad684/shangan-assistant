'use client';

/**
 * 电脑端快捷键（IMPLEMENTATION.md §2 页面与导航）
 *   空格 = 开始/暂停番茄钟，N = 记一笔，1–4 = 切换页面
 *
 * 输入框聚焦时全部让行 —— 否则打字打不出空格和数字。
 */
import { useEffect } from 'react';

export interface HotkeyHandlers {
  onTogglePomodoro?: () => void;
  onNewRecord?: () => void;
  onNavigate?: (index: number) => void;
}

export function useHotkeys(handlers: HotkeyHandlers): void {
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable ||
        target.getAttribute('role') === 'textbox'
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // 弹层打开时不抢键
      if (document.querySelector('[role="dialog"]')) return;
      if (isTypingTarget(e.target)) return;

      if (e.code === 'Space') {
        if (!handlers.onTogglePomodoro) return;
        e.preventDefault();
        handlers.onTogglePomodoro();
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        if (!handlers.onNewRecord) return;
        e.preventDefault();
        handlers.onNewRecord();
        return;
      }

      if (e.key >= '1' && e.key <= '4') {
        handlers.onNavigate?.(Number(e.key) - 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}

/** 页面切换顺序与导航项一一对应，快捷键 1-4 复用它 */
export const HOTKEY_ROUTES = ['/', '/stats', '/achievements', '/settings'] as const;
