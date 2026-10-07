'use client';

/** 今日目标卡：三层时长线可视化（打卡线 1h / 达标线 2h / 目标线可配置） */
import { Card, CardHead, ProgressBar } from '@/components/ui/base';
import { useToday } from './TodayProvider';
import { formatMinutes } from '@/lib/domain/time';

const CHECKIN_LINE = 60;
const PASS_LINE = 120;

export function GoalCard() {
  const { aggregate, goalMinutes, items } = useToday();

  const goalRatio = goalMinutes > 0 ? aggregate.minutes / goalMinutes : 0;
  const pct = Math.round(Math.min(1, goalRatio) * 100);

  // 刻度只在目标线之内才显示，否则会挤在一起
  const ticks = [
    { at: CHECKIN_LINE / goalMinutes, label: '打卡线 1h' },
    { at: PASS_LINE / goalMinutes, label: '达标线 2h' },
  ].filter((t) => t.at > 0.04 && t.at < 0.97);

  const hours = Math.floor(aggregate.minutes / 60);
  const mins = aggregate.minutes % 60;

  return (
    <Card>
      <CardHead title="今日目标" hint={`目标线 ${formatMinutes(goalMinutes)} · 可在设置中修改`} />

      <div className="flex items-baseline gap-2">
        <div className="text-[32px] font-bold tracking-tight leading-none">
          {hours}
          <span className="text-[14px] font-semibold text-ink2">h</span> {mins}
          <span className="text-[14px] font-semibold text-ink2">m</span>
        </div>
        <div className="text-[12.5px] text-ink3">
          / {formatMinutes(goalMinutes)} ·{' '}
          <b className={goalRatio >= 1 ? 'text-brand' : 'text-ink2'}>{pct}%</b>
        </div>
      </div>

      <div className="mt-3">
        <ProgressBar value={goalRatio} ticks={ticks} />
      </div>

      <div className="flex gap-2.5 mt-7">
        <StatBox
          value={aggregate.checkedIn ? '已打卡' : '未打卡'}
          label={aggregate.currentStreak > 0 ? `连续 ${aggregate.currentStreak} 天` : '连续 0 天'}
          ok={aggregate.checkedIn}
        />
        <StatBox
          value={aggregate.passed ? '已达标' : '未达标'}
          label="今日 ≥2h"
          ok={aggregate.passed}
        />
        <StatBox value={String(items.length)} label="完成事项" />
      </div>
    </Card>
  );
}

function StatBox({ value, label, ok }: { value: string; label: string; ok?: boolean }) {
  return (
    <div className="flex-1 bg-soft rounded-xl px-3 py-2.5">
      <div className={`text-[16px] font-bold ${ok ? 'text-brand' : ''}`}>{value}</div>
      <div className="text-[11.5px] text-ink3">{label}</div>
    </div>
  );
}
