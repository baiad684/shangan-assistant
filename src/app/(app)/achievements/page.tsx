import { Card, CardHead, ProgressBar } from '@/components/ui/base';
import { getSnapshot, listAchievements } from '@/lib/server/data';
import { todayLocalDate } from '@/lib/domain/time';
import { resolveLevel } from '@/lib/domain/leveling';
import { badgeProgress, nextTarget } from '@/lib/domain/achievements';
import { formatMinutesCN } from '@/lib/domain/time';

export const dynamic = 'force-dynamic';

/**
 * 成就页（快捷键 3）
 *
 * 纯展示，没有交互状态，所以做成服务端组件：少一份客户端 bundle，也不需要 loading 态。
 */
export default async function AchievementsPage() {
  const today = todayLocalDate();
  // 快照只算一次，传给 listAchievements 复用 —— 否则它内部还会再算一遍（一屏两遍全量聚合）
  const snapshot = await getSnapshot(today);
  const badges = await listAchievements(today, snapshot);

  const level = resolveLevel(snapshot.totalMinutes);
  const unlockedCount = badges.filter((b) => b.unlockedAt !== null).length;
  const target = nextTarget(snapshot);

  return (
    <div className="px-4 pt-3 flex flex-col gap-3">
      {/* 等级与经验（深墨绿渐变 + 金色点缀） */}
      <Card className="border-none text-white" padded={false}>
        <div
          className="rounded-[var(--radius-card)] px-4 py-5"
          style={{ background: 'linear-gradient(135deg,#022c22,#047857)' }}
        >
          <div className="flex items-center gap-3.5">
            <div
              className="w-14 h-14 rounded-2xl shrink-0 flex items-center justify-center text-[20px] font-extrabold"
              style={{
                background: 'rgba(251,191,36,.14)',
                border: '1px solid rgba(251,191,36,.45)',
                color: '#fbbf24',
              }}
            >
              Lv{level.level}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-[18px] font-bold">{level.title}</div>
              <div className="mt-2 h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.18)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(level.progress * 100)}%`,
                    background: 'linear-gradient(90deg,#f59e0b,#fbbf24)',
                  }}
                />
              </div>
              <p className="text-[11.5px] mt-1.5" style={{ color: '#a7f3d0' }}>
                {level.xpIntoLevel} / {level.xpForNext} XP · 下一级还需{' '}
                {level.xpForNext - level.xpIntoLevel} 分钟专注
              </p>
            </div>
          </div>

          <p className="text-[11px] mt-3.5" style={{ color: '#6ee7b7' }}>
            1 分钟实际专注 = 1 XP（暂停不计、补记计入）· 累计 {formatMinutesCN(snapshot.totalMinutes)}
          </p>
        </div>
      </Card>

      {/* 关键指标 */}
      <Card>
        <CardHead title="当前状态" />
        <div className="grid grid-cols-2 gap-2.5">
          <Metric label="当前连续打卡" value={`${snapshot.currentStreak} 天`} />
          <Metric label="历史最长连续" value={`${snapshot.longestStreak} 天`} />
          <Metric label="累计专注" value={formatMinutesCN(snapshot.totalMinutes)} />
          <Metric label="单日峰值" value={formatMinutesCN(snapshot.maxDayMinutes)} />
          <Metric label="有记录的科目" value={`${snapshot.subjectCount} 科`} />
          <Metric label="专注次数" value={`${snapshot.totalSessions} 次`} />
        </div>
        {target && (
          <p className="text-[12px] text-ink3 mt-3">
            最接近解锁：<b className="text-brand-strong">{target.name}</b> — {target.desc}
          </p>
        )}
      </Card>

      {/* 徽章墙 */}
      <Card>
        <CardHead title="徽章墙" hint={`${unlockedCount} / ${badges.length}`} />

        <div className="grid grid-cols-4 gap-2.5">
          {badges.map((badge) => {
            const unlocked = badge.unlockedAt !== null;
            const progress = unlocked ? 1 : badgeProgress(badge.key, snapshot);

            return (
              <div
                key={badge.key}
                className="text-center px-1 py-2.5 rounded-[14px] bg-soft relative overflow-hidden"
                style={unlocked ? undefined : { opacity: 0.55, filter: 'grayscale(0.85)' }}
              >
                <div
                  className="w-11 h-11 rounded-full mx-auto mb-1.5 flex items-center justify-center text-white font-extrabold"
                  style={{
                    background: unlocked ? badge.color : '#d7ddd9',
                    fontSize: badge.icon.length > 2 ? 11 : 15,
                    color: unlocked ? '#fff' : '#9aa59f',
                  }}
                >
                  {badge.icon}
                </div>
                <div className="text-[11px] font-semibold leading-tight">{badge.name}</div>
                <div className="text-[9.5px] text-ink3 mt-0.5 leading-tight">{badge.desc}</div>

                {!unlocked && progress > 0 && (
                  <div className="mt-1.5 px-1">
                    <ProgressBar value={progress} height={3} />
                  </div>
                )}
                {unlocked && (
                  <div className="text-[9px] text-brand-strong mt-0.5 tnum">
                    {badge.unlockedAt?.slice(0, 10)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <p className="text-[11.5px] text-ink3 text-center pb-4">
        成就在服务端判定并持久化 —— 换设备、清缓存都不会丢，也不会重复弹窗。
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-soft px-3 py-2.5">
      <div className="text-[15px] font-bold">{value}</div>
      <div className="text-[11.5px] text-ink3">{label}</div>
    </div>
  );
}
