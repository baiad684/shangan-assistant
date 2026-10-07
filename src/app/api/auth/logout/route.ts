import { NextResponse } from 'next/server';
import { route } from '@/lib/server/http';
import { COOKIE_NAME } from '@/lib/server/jwt';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout —— 清 Cookie */
export const POST = route(async () => {
  const res = NextResponse.json({ ok: true, data: { authenticated: false } });
  res.cookies.set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return res;
});
