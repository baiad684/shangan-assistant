/*
 * 上岸助手 Service Worker —— 离线壳
 *
 * 范围（IMPLEMENTATION.md §7.5）：统计/战报等只读页面离线可看；写入类操作仍需在线
 * （番茄钟的离线续跑不依赖这里，它由 localStorage + 提交队列保证）。
 *
 * 策略：
 *   静态资源（/_next/static、图标、manifest）→ cache-first，命中即返回
 *   页面导航 → network-first，失败时回退到缓存的离线页
 *   接口请求 → 完全交给网络，不缓存（避免看到过期统计数据）
 */
const VERSION = 'v2';
const STATIC_CACHE = `shangan-static-${VERSION}`;
const PAGE_CACHE = `shangan-pages-${VERSION}`;
const OFFLINE_URL = '/offline';

const PRECACHE = [
  '/',
  '/stats',
  '/achievements',
  '/settings',
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.endsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 接口一律走网络，不缓存
  if (url.pathname.startsWith('/api/')) return;

  // 静态资源：cache-first
  if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
            return res;
          }),
      ),
    );
    return;
  }

  // 页面导航：network-first，离线回退到缓存/离线页
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGE_CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return (
            offline ||
            new Response('离线中，请连接网络后重试。', {
              status: 503,
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            })
          );
        }),
    );
  }
});
