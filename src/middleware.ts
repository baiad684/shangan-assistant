/**
 * 边缘中间件：页面级会话守卫（ARCHITECTURE.md §4.2）
 *
 * 职责刻意收窄 —— 只验 JWT 签名并做重定向，不查数据库（Edge Runtime 用不了 Prisma）。
 * 「是否已完成引导」需要查库，交给页面服务端组件处理。
 *
 * 注意：中间件是体验优化，不是安全边界。真正的鉴权在 Route Handler 里由 requireSession()
 * 二次确认，页面则由 (app)/layout.tsx 兜底。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, verifySession } from '@/lib/server/jwt';

/** 无需登录即可访问的页面 */
const PUBLIC_PAGES = new Set(['/login', '/onboarding']);

/** 无需登录即可访问的接口前缀（登录本身、引导提交、状态查询） */
const PUBLIC_API_PREFIXES = ['/api/auth/', '/api/onboarding'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const authenticated = await verifySession(token);

  if (pathname.startsWith('/api')) {
    if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
    if (authenticated) return NextResponse.next();

    // 与 http.ts 的 toErrorResponse 保持完全一致的响应形状
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: '未登录或登录已过期' } },
      { status: 401 },
    );
  }

  if (PUBLIC_PAGES.has(pathname)) {
    // 已登录还去登录页 → 直接送进主页
    if (authenticated && pathname === '/login') {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  if (!authenticated) {
    const url = new URL('/login', req.url);
    // 记下来路，登录后原路返回
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 跳过静态资源与图标：
     * _next/static、_next/image、favicon、manifest、图片文件
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
