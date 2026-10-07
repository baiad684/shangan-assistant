'use client';

/**
 * 注册 Service Worker（PWA 离线壳）
 *
 * 只在生产环境注册：开发环境下 SW 会缓存住 HMR 的产物，导致改了代码不生效，
 * 这是新手最常踩的 PWA 坑之一。
 */
import { useEffect } from 'react';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // 非安全上下文（局域网 HTTP）注册会直接失败，跳过以免刷错误日志
    if (!window.isSecureContext) return;

    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // 注册失败不影响任何核心功能，静默忽略
      });
    }, 1200);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
