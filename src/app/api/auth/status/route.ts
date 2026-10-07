import { ok, route } from '@/lib/server/http';
import { hasSession } from '@/lib/server/http';
import { hasPassword, lockedSecondsLeft } from '@/lib/server/auth';
import { isOnboarded } from '@/lib/server/settings';

/**
 * GET /api/auth/status
 * 公开端点（不受会话守卫），登录页与引导页据此决定往哪跳。
 */
export const GET = route(async () => {
  const [passwordSet, onboarded, authenticated, locked] = await Promise.all([
    hasPassword(),
    isOnboarded(),
    hasSession(),
    lockedSecondsLeft(),
  ]);

  return ok({
    passwordSet,
    onboarded,
    authenticated,
    lockedSeconds: locked,
  });
});
