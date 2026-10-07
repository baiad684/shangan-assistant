import { NextResponse } from 'next/server';
import { errors, readValidatedBody, route } from '@/lib/server/http';
import {
  assertLoginAllowed,
  clearLoginFailures,
  registerLoginFailure,
  verifyPassword,
} from '@/lib/server/auth';
import { getPasswordHash } from '@/lib/server/settings';
import { COOKIE_NAME, COOKIE_OPTIONS, signSession } from '@/lib/server/jwt';
import { loginSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login
 * 成功 → 下发 30 天 httpOnly Cookie；失败 → 计数，满 5 次锁 10 分钟。
 */
export const POST = route(async (req: Request) => {
  const body = await readValidatedBody(req, loginSchema);

  await assertLoginAllowed();

  const hash = await getPasswordHash();
  if (!hash) throw errors.onboardingRequired();

  const valid = await verifyPassword(body.password, hash);
  if (!valid) {
    const result = await registerLoginFailure();
    if (result.locked) {
      throw errors.rateLimited('密码连续错误 5 次，已锁定 10 分钟', { lockedSeconds: 600 });
    }
    throw errors.validation(`密码错误，还可尝试 ${result.attemptsLeft} 次`, {
      attemptsLeft: result.attemptsLeft,
    });
  }

  await clearLoginFailures();
  const token = await signSession();

  const res = NextResponse.json({ ok: true, data: { authenticated: true } });
  res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
  return res;
});
