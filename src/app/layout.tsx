import type { Metadata, Viewport } from 'next';
import './globals.css';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { ToastProvider } from '@/components/ui/overlay';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';

export const metadata: Metadata = {
  title: '上岸助手',
  description: '考研学习记录与督促工具：倒计时、番茄钟、打卡热力图、成就与战报。',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: '上岸助手',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // 手机上固定豎屏体验，同时避免输入框聚焦时被自动放大
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef2f0' },
    { media: '(prefers-color-scheme: dark)', color: '#0a120f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 同步执行，避免暗色用户先看到一帧白屏 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ToastProvider>
          {children}
          <ServiceWorkerRegistrar />
        </ToastProvider>
      </body>
    </html>
  );
}
