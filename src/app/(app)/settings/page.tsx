import { SettingsView } from '@/components/settings/SettingsView';
import { getSettings } from '@/lib/server/settings';
import { listSubjects } from '@/lib/server/data';
import { listBackups } from '@/lib/server/backup';

export const dynamic = 'force-dynamic';

/** 设置页（快捷键 4） */
export default async function SettingsPage() {
  const [settings, subjects, backups] = await Promise.all([
    getSettings(),
    listSubjects({ includeArchived: false }),
    listBackups().catch(() => []),
  ]);

  return <SettingsView settings={settings} subjects={subjects} backups={backups} />;
}
