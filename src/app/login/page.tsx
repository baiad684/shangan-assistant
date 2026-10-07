import { redirect } from 'next/navigation';
import { LoginForm } from './LoginForm';
import { hasSession } from '@/lib/server/http';
import { isOnboarded } from '@/lib/server/settings';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await hasSession()) redirect('/');

  // 还没走过引导 → 先去设置密码
  if (!(await isOnboarded())) redirect('/onboarding');

  return (
    <main className="min-h-dvh flex items-center justify-center px-6 bg-canvas">
      <LoginForm />
    </main>
  );
}
