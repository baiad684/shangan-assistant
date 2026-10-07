import { errors, ok, readValidatedBody, requireSession, route } from '@/lib/server/http';
import { changePassword, verifyPassword } from '@/lib/server/auth';
import { getPasswordHash } from '@/lib/server/settings';
import { passwordChangeSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** PUT /api/password —— 修改密码（需验证当前密码） */
export const PUT = route(async (req: Request) => {
  await requireSession();
  const body = await readValidatedBody(req, passwordChangeSchema);

  const hash = await getPasswordHash();
  if (!hash) throw errors.onboardingRequired();

  if (!(await verifyPassword(body.currentPassword, hash))) {
    throw errors.validation('当前密码不正确');
  }
  if (body.currentPassword === body.newPassword) {
    throw errors.validation('新密码与当前密码相同');
  }

  await changePassword(body.newPassword);
  return ok({ changed: true });
});
