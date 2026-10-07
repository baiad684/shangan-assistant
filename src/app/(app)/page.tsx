import { GoalCard } from '@/components/today/GoalCard';
import { PomodoroCard } from '@/components/today/PomodoroCard';
import { ManualBackfillCard, RecordList } from '@/components/today/RecordList';
import { listManualSessions } from '@/lib/server/data';
import { formatDateCN, todayLocalDate } from '@/lib/domain/time';

export const dynamic = 'force-dynamic';

/**
 * 今日页（快捷键 1）
 *
 * 只取「手动补记列表」这一份数据 —— 其余（目标进度、连续天数、完成记录、科目）
 * 由 (app)/layout.tsx 一次取齐并注入客户端上下文，避免同一份数据取两遍。
 */
export default async function TodayPage() {
  const today = todayLocalDate();
  const manualSessions = await listManualSessions(today);

  return (
    <div className="px-4 pt-3 flex flex-col gap-3">
      <p className="text-[12.5px] text-ink3 px-1">{formatDateCN(today)}</p>

      <GoalCard />
      <PomodoroCard />
      <RecordList />
      <ManualBackfillCard initial={manualSessions} />

      <p className="text-[11.5px] text-ink3 text-center px-4 pb-4 leading-relaxed">
        电脑端快捷键：<kbd className="px-1.5 py-0.5 rounded border border-line bg-soft text-[10.5px]">空格</kbd> 开始/暂停 ·{' '}
        <kbd className="px-1.5 py-0.5 rounded border border-line bg-soft text-[10.5px]">N</kbd> 记一笔 ·{' '}
        <kbd className="px-1.5 py-0.5 rounded border border-line bg-soft text-[10.5px]">1–4</kbd> 切换页面
      </p>
    </div>
  );
}
