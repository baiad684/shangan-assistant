/**
 * 登录与密码（IMPLEMENTATION.md §4.11）
 *   - bcrypt hash 存储，绝不明文
 *   - 连续错 5 次锁定 10 分钟，锁定状态存库（决策 D10：进程重启后仍生效）
 */
import bcrypt from 'bcryptjs';
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_ATTEMPTS } from '../types';
import { errors } from './http';
import { getAuthGuard, getPasswordHash, setAuthGuard, setPasswordHash } from './settings';

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export async function hasPassword(): Promise<boolean> {
  return (await getPasswordHash()) !== null;
}

export async function changePassword(plain: string): Promise<void> {
  await setPasswordHash(await hashPassword(plain));
  await clearLoginFailures();
}

/** 剩余锁定秒数，未锁定返回 0 */
export async function lockedSecondsLeft(): Promise<number> {
  const guard = await getAuthGuard();
  if (!guard.lockedUntil) return 0;
  const left = guard.lockedUntil - Date.now();
  if (left <= 0) {
    // 锁定期已过，顺手清掉计数
    await setAuthGuard({ attempts: 0, lockedUntil: null });
    return 0;
  }
  return Math.ceil(left / 1000);
}

export async function assertLoginAllowed(): Promise<void> {
  const left = await lockedSecondsLeft();
  if (left > 0) {
    throw errors.rateLimited(`密码错误次数过多，请 ${Math.ceil(left / 60)} 分钟后再试`, {
      lockedSeconds: left,
    });
  }
}

/** 记一次失败，返回剩余可尝试次数（0 表示本次已触发锁定） */
export async function registerLoginFailure(): Promise<{ attemptsLeft: number; locked: boolean }> {
  const guard = await getAuthGuard();
  const attempts = guard.attempts + 1;

  if (attempts >= LOGIN_MAX_ATTEMPTS) {
    await setAuthGuard({ attempts: 0, lockedUntil: Date.now() + LOGIN_LOCK_MINUTES * 60_000 });
    return { attemptsLeft: 0, locked: true };
  }

  await setAuthGuard({ attempts, lockedUntil: null });
  return { attemptsLeft: LOGIN_MAX_ATTEMPTS - attempts, locked: false };
}

export async function clearLoginFailures(): Promise<void> {
  await setAuthGuard({ attempts: 0, lockedUntil: null });
}

export async function failedAttempts(): Promise<number> {
  return (await getAuthGuard()).attempts;
}
