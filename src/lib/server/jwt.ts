/**
 * 会话令牌（Edge 兼容）
 *
 * 这个文件只依赖 jose，不碰 node API、不碰 Prisma —— 因为 middleware.ts 运行在 Edge Runtime，
 * 会把它打进 middleware bundle。需要查库的鉴权逻辑放在 session.ts。
 */
import { SignJWT, jwtVerify } from 'jose';
import { SESSION_DAYS } from '../types';

export const COOKIE_NAME = 'shangan_session';
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60; // 秒

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET 未配置或过短（至少 16 字符），生产环境拒绝启动登录功能');
    }
    return new TextEncoder().encode('shangan-dev-fallback-secret-please-change-me');
  }
  return new TextEncoder().encode(secret);
}

/** 签发会话令牌。单用户系统，载荷只放一个固定主体 + 签发时间。 */
export async function signSession(): Promise<string> {
  return new SignJWT({ sub: 'owner' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

/** 校验会话令牌。任何异常一律视为未登录，不向上抛。 */
export async function verifySession(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload.sub === 'owner';
  } catch {
    return false;
  }
}

export const COOKIE_OPTIONS = {
  name: COOKIE_NAME,
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE,
  // 局域网是 http 访问，secure 会让 cookie 直接被丢弃 —— 这里必须为 false
  secure: false,
};
