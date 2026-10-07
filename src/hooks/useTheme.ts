'use client';

/**
 * 主题切换（浅色默认 + 暗色，跟随系统，可手动覆盖）
 *
 * 首屏闪烁的避免方式见 layout.tsx 里的内联脚本：在 <head> 里同步写 class，
 * 这个 hook 只负责运行时的切换与持久化。
 */
import { useCallback, useEffect, useState } from 'react';
import { THEME_STORAGE_KEY } from '@/lib/theme';

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = THEME_STORAGE_KEY;

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(mode: ThemeMode): void {
  const dark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>('system');

  useEffect(() => {
    const stored = window.localStorage.getItem(KEY) as ThemeMode | null;
    const initial: ThemeMode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    setMode(initial);
    apply(initial);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if ((window.localStorage.getItem(KEY) as ThemeMode | null) ?? 'system' === 'system') {
        apply('system');
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const update = useCallback((next: ThemeMode) => {
    setMode(next);
    window.localStorage.setItem(KEY, next);
    apply(next);
  }, []);

  return { mode, setMode: update };
}
