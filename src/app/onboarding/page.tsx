import { redirect } from 'next/navigation';
import { OnboardingWizard } from './OnboardingWizard';
import { isOnboarded } from '@/lib/server/settings';
import { PRESET_SUBJECTS } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  // 已完成引导就不该再进来（也避免它被当成「免登录重置入口」）
  if (await isOnboarded()) redirect('/');

  return (
    <main className="min-h-dvh bg-canvas py-8">
      <OnboardingWizard presets={PRESET_SUBJECTS.map((p) => ({ ...p, enabled: true }))} />
    </main>
  );
}
