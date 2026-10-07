'use client';

/**
 * 首次引导（IMPLEMENTATION.md §6 首次启动流程）
 *
 * 四步：设密码 → 考试日期 → 科目 → 每日目标。考试日期必填，默认 2027-12-18
 * （大三对应 2027 年 12 月那场初试，以研招网公告为准）。
 *
 * 末尾一次性提交 /api/onboarding，服务端会把科目按「改名复用 + 新增补齐 + 多余归档」
 * 落到库里，不会因为重跑引导把已有记录的 subjectId 变成脏引用。
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, cx } from '@/components/ui/base';
import { api, errorMessage } from '@/lib/api-client';
import { eachDate, diffDays, formatMinutes, todayLocalDate } from '@/lib/domain/time';

interface DraftSubject {
  name: string;
  color: string;
  enabled: boolean;
}

const STEPS = ['设置密码', '考试日期', '选择科目', '每日目标'] as const;

export function OnboardingWizard({ presets }: { presets: DraftSubject[] }) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [examDate, setExamDate] = useState('2027-12-18');
  const [draft, setDraft] = useState<DraftSubject[]>(presets);
  const [goalHours, setGoalHours] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => draft.filter((d) => d.enabled), [draft]);

  const dday = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) return null;
    return diffDays(todayLocalDate(), examDate);
  }, [examDate]);

  const canNext = useMemo(() => {
    if (step === 0) return password.length >= 4 && password === confirm;
    if (step === 1) return /^\d{4}-\d{2}-\d{2}$/.test(examDate) && (dday ?? -1) > 0;
    if (step === 2) return selected.length >= 1;
    return true;
  }, [step, password, confirm, examDate, dday, selected.length]);

  const next = () => {
    setError(null);
    if (!canNext) {
      if (step === 0) setError(password.length < 4 ? '密码至少 4 位' : '两次输入的密码不一致');
      if (step === 1) setError((dday ?? -1) <= 0 ? '考试日期需要晚于今天' : '请选择考试日期');
      if (step === 2) setError('至少保留一个科目');
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/onboarding', {
        password,
        examDate,
        dailyGoalMinutes: goalHours * 60,
        subjects: selected.map((s) => ({ name: s.name.trim(), color: s.color })),
      });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[430px] px-5">
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 text-[20px] font-bold">
          <i className="w-3 h-3 rounded-[3px] bg-brand inline-block" />
          上岸助手
        </div>
        <p className="text-[12.5px] text-ink3 mt-1.5">先花一分钟把基础设置定下来</p>
      </div>

      {/* 步骤指示 */}
      <div className="flex items-center gap-1.5 mb-5">
        {STEPS.map((label, i) => (
          <div key={label} className="flex-1">
            <div
              className={cx(
                'h-1 rounded-full transition-colors',
                i <= step ? 'bg-brand' : 'bg-line',
              )}
            />
            <p className={cx('text-[10.5px] mt-1.5 text-center', i === step ? 'text-brand-strong font-semibold' : 'text-ink3')}>
              {label}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-line rounded-2xl p-5">
        {step === 0 && (
          <div className="flex flex-col gap-3 anim-fade-up">
            <div>
              <h2 className="text-[16px] font-bold">设置登录密码</h2>
              <p className="text-[12.5px] text-ink3 mt-1">
                单用户本地应用，密码用来防止数据被误动。忘记可在项目目录运行{' '}
                <code className="px-1 rounded bg-soft text-[11px]">npm run reset-password</code> 重置。
              </p>
            </div>
            <Input
              type="password"
              autoFocus
              placeholder="密码（至少 4 位）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input
              type="password"
              placeholder="再输入一次"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') next();
              }}
            />
            {password.length >= 4 && confirm.length > 0 && password !== confirm && (
              <p className="text-[12px] text-danger">两次输入的密码不一致</p>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="anim-fade-up">
            <h2 className="text-[16px] font-bold">你的考试日期</h2>
            <p className="text-[12.5px] text-ink3 mt-1">
              用来算倒计时。大三同学默认对应 2027 年 12 月那场初试，具体以研招网公告为准；随时可在设置里改。
            </p>

            <Input
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className="mt-4 text-[15px]"
            />

            <div className="flex gap-2 mt-3 flex-wrap">
              {[
                { label: '2026-12-19', hint: '大四这年' },
                { label: '2027-12-18', hint: '大三这年' },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setExamDate(opt.label)}
                  className={cx(
                    'px-3 py-1.5 rounded-lg text-[12.5px] border-[1.5px] transition-colors',
                    examDate === opt.label
                      ? 'border-brand text-brand-strong bg-brand-soft font-semibold'
                      : 'border-line text-ink2',
                  )}
                >
                  {opt.label} · {opt.hint}
                </button>
              ))}
            </div>

            {dday !== null && dday > 0 && (
              <p className="mt-4 text-[13px] text-ink2">
                距考试还有 <b className="text-[18px] text-brand-strong tnum">{dday}</b> 天
                <span className="text-ink3 text-[12px]">
                  （约 {Math.round(dday / 7)} 周）
                </span>
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="anim-fade-up">
            <h2 className="text-[16px] font-bold">要考哪些科目</h2>
            <p className="text-[12.5px] text-ink3 mt-1">
              勾掉不考的，或者直接改名字（应对 408、自命题、二外等情况）。之后随时可增删。
            </p>

            <div className="mt-4 flex flex-col gap-2.5">
              {draft.map((item, index) => (
                <div key={index} className="flex items-center gap-2.5">
                  <button
                    type="button"
                    aria-label={item.enabled ? '取消选择' : '选择'}
                    onClick={() =>
                      setDraft((prev) =>
                        prev.map((d, i) => (i === index ? { ...d, enabled: !d.enabled } : d)),
                      )
                    }
                    className={cx(
                      'w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-colors',
                      item.enabled ? 'bg-brand border-brand' : 'border-line',
                    )}
                  >
                    {item.enabled && (
                      <span className="w-[5px] h-[9px] border-solid border-white border-0 border-r-2 border-b-2 rotate-45 -translate-y-[1px]" />
                    )}
                  </button>
                  <Input
                    value={item.name}
                    maxLength={20}
                    disabled={!item.enabled}
                    onChange={(e) =>
                      setDraft((prev) => prev.map((d, i) => (i === index ? { ...d, name: e.target.value } : d)))
                    }
                    className={cx('flex-1 py-2', !item.enabled && 'opacity-50')}
                  />
                  <i
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ background: item.color, opacity: item.enabled ? 1 : 0.35 }}
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                setDraft((prev) => [
                  ...prev,
                  { name: `科目${prev.length + 1}`, color: '#64748b', enabled: true },
                ])
              }
              className="mt-3 text-[12.5px] text-ink3 hover:text-brand-strong transition-colors"
            >
              + 再加一个科目
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="anim-fade-up">
            <h2 className="text-[16px] font-bold">每天打算学多久</h2>
            <p className="text-[12.5px] text-ink3 mt-1">
              这是「目标线」，用来画今日进度条。没达成也不影响打卡 —— 打卡线固定在 1 小时。
            </p>

            <div className="mt-5 text-center">
              <div className="text-[34px] font-bold tnum leading-none">
                {goalHours}
                <span className="text-[15px] font-semibold text-ink2">小时</span>
              </div>
            </div>

            <input
              type="range"
              min={2}
              max={14}
              step={1}
              value={goalHours}
              onChange={(e) => setGoalHours(Number(e.target.value))}
              className="w-full mt-5 accent-[var(--c-brand)]"
            />

            <div className="flex justify-between text-[11px] text-ink3 mt-1">
              <span>2h</span>
              <span>8h（默认）</span>
              <span>14h</span>
            </div>

            <div className="mt-5 rounded-xl bg-soft p-3.5 text-[12.5px] text-ink2 leading-relaxed">
              <b className="text-ink">确认一下</b>
              <br />
              考试日期 {examDate}（{dday} 天后）
              <br />
              科目 {selected.map((s) => s.name).join('、')}
              <br />
              每日目标 {formatMinutes(goalHours * 60)}
              <br />
              备考总天数约 {dday ? eachDate(todayLocalDate(), examDate).length : 0} 天
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}

        <div className="flex gap-2.5 mt-5">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              上一步
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button block onClick={next}>
              下一步
            </Button>
          ) : (
            <Button block disabled={busy || !canNext} onClick={() => void submit()}>
              {busy ? '创建中…' : '开始使用'}
            </Button>
          )}
        </div>
      </div>

      <p className="text-[11.5px] text-ink3 text-center mt-4 leading-relaxed">
        数据存在本机，会自动备份 · 手机和电脑连同一 WiFi 时可同时访问
      </p>
    </div>
  );
}
