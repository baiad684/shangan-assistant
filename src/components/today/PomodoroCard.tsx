'use client';

/**
 * 番茄钟卡片。
 *
 * 计时正确性全部由 hooks/usePomodoro 保证，这里只负责渲染与交互：
 * 屏幕上的数字永远是 f(now, state) 的现算结果，因此切后台、锁屏、刷新都不会走偏。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardHead, Chip, Ring, cx } from '@/components/ui/base';
import { Modal, useToast } from '@/components/ui/overlay';
import { usePomodoroCtx } from './PomodoroProvider';
import { useToday } from './TodayProvider';
import { formatClock, formatMinutes } from '@/lib/domain/time';
import { FOCUS_MINUTES_MAX, FOCUS_MINUTES_MIN, PRESET_FOCUS_MINUTES } from '@/lib/types';

export function PomodoroCard() {
  const { controller, toggle, pendingSubmissions, canSwitchSubject } = usePomodoroCtx();
  const { subjects } = useToday();
  const toast = useToast();
  const [customOpen, setCustomOpen] = useState(false);
  const [endModalOpen, setEndModalOpen] = useState(false);

  // 「提前结束」按钮。名字原来是「中断放弃」—— 误导：它并不丢掉已专注的时间，
  // 而是按实际分钟结算入账（source=stopped_early），真正的「放弃」只发生在
  // 专注不足 1 分钟时（settle 会静默丢弃，见 MIN_RECORDABLE_MINUTES）。
  const abortNow = () => {
    // 与 settle 的丢弃线（30 秒）对齐，提前说一声，别让用户猜时间去哪了
    if (controller.elapsed < 30) toast.show('专注不足 1 分钟，这次不计入记录');
    controller.abort();
  };

  // 默认选中第一个科目（IMPLEMENTATION.md §4.2：开始前必须选科目）
  //
  // 依赖必须是「真正相关的值」，不能是 controller 本身：
  // controller 每跳一次（现在 1 秒）就是一个新对象，原来写 [controller, subjects]
  // 会让这个 effect 每次心跳都白跑一遍（靠 subjectId 守卫才没有变成死循环）。
  const subjectId = controller.subjectId;
  const setSubject = controller.setSubject;
  useEffect(() => {
    if (subjectId === null && subjects.length > 0) setSubject(subjects[0].id);
  }, [subjectId, subjects, setSubject]);

  // 计时结束时弹出页面弹窗（浏览器通知由 hook 内部负责）
  //
  // 这里必须是**边沿触发**，不能写成 `if (phase === 'done') open()`。
  // 原因：phase 会一直停在 done 直到用户点「开始下一个」，而切页面会让本卡片
  // 重新挂载、effect 重跑一遍 —— 电平写法等于每次切回今日页都重弹一次，
  // 用户点了「稍后再说」也躲不掉（历史 bug）。
  // ref 初值取当前 phase，所以重新挂载时 prev === 'done'，不会再弹；
  // 只有真正发生「running/paused → done」的跃迁才弹。
  const phaseRef = useRef(controller.phase);
  useEffect(() => {
    const prev = phaseRef.current;
    phaseRef.current = controller.phase;
    if (controller.phase === 'done' && prev !== 'done') setEndModalOpen(true);
  }, [controller.phase]);

  const activeSubject = useMemo(
    () => subjects.find((s) => s.id === controller.subjectId) ?? null,
    [subjects, controller.subjectId],
  );

  const isIdle = controller.phase === 'idle';
  const isRunning = controller.phase === 'running';
  const isPaused = controller.phase === 'paused';
  const isDone = controller.phase === 'done';

  const stateLabel = useMemo(() => {
    if (isRunning) return `专注中 · ${activeSubject?.name ?? '未选科目'}`;
    if (isPaused) return `已暂停 · 已专注 ${formatMinutes(controller.elapsed / 60)}`;
    if (isDone) return '这个番茄完成了';
    return `准备专注 · ${activeSubject?.name ?? '请选择科目'}`;
  }, [isRunning, isPaused, isDone, activeSubject, controller.elapsed]);

  const presets = controller.plannedMinutes;

  return (
    <Card>
      <CardHead
        title="番茄钟"
        hint={`${presets} 分钟 · 计时走真实时间，切后台不暂停`}
        right={
          pendingSubmissions > 0 ? (
            <span className="text-[11px] text-warn bg-warn/10 border border-warn/25 rounded-full px-2 py-0.5">
              {pendingSubmissions} 条待补交
            </span>
          ) : null
        }
      />

      {/* 科目选择：只在空闲时可切换 */}
      <div className={cx('flex gap-2 flex-wrap mb-3.5', !canSwitchSubject && 'opacity-60')}>
        {subjects.map((s) => (
          <Chip
            key={s.id}
            active={controller.subjectId === s.id}
            color={s.color}
            onClick={() => {
              if (!canSwitchSubject) return;
              controller.setSubject(s.id);
            }}
          >
            {s.name}
          </Chip>
        ))}
      </div>

      {/* 时长预设 */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {PRESET_FOCUS_MINUTES.map((m) => (
          <button
            key={m}
            type="button"
            disabled={!isIdle}
            onClick={() => controller.setPlannedMinutes(m)}
            className={cx(
              'px-3 py-1 rounded-lg text-[12.5px] border-[1.5px] transition-colors disabled:opacity-50',
              presets === m && isIdle
                ? 'border-brand text-brand-strong bg-brand-soft font-semibold'
                : 'border-line text-ink2',
            )}
          >
            {m} 分钟
          </button>
        ))}
        <button
          type="button"
          disabled={!isIdle}
          onClick={() => setCustomOpen(true)}
          className={cx(
            'px-3 py-1 rounded-lg text-[12.5px] border-[1.5px] transition-colors disabled:opacity-50',
            !PRESET_FOCUS_MINUTES.includes(presets as 25 | 45 | 50) && isIdle
              ? 'border-brand text-brand-strong bg-brand-soft font-semibold'
              : 'border-line text-ink2',
          )}
        >
          自定义
        </button>
      </div>

      {/* 休息倒计时横幅 */}
      {controller.activeBreak && (
        <div className="mb-4 rounded-xl bg-brand-soft border border-brand-line px-3.5 py-2.5 text-[13px] text-brand-strong anim-fade-up">
          {controller.activeBreak.kind === 'long' ? '长休息' : '短暂休息'}中 · 还剩{' '}
          <b className="tnum">
            {formatClock(Math.max(0, (controller.activeBreak.endsAt - Date.now()) / 1000))}
          </b>
          <span className="text-ink3">（到点会提醒你）</span>
        </div>
      )}

      <div className="flex flex-col items-center">
        <Ring
          progress={controller.progress}
          color={isPaused ? 'var(--c-ink3)' : undefined}
        >
          <div className="text-[38px] font-bold tnum tracking-wide leading-none">
            {formatClock(controller.remaining)}
          </div>
          <div className="text-[12px] text-ink3 mt-1.5 text-center px-6">{stateLabel}</div>
        </Ring>

        <div className="flex gap-3 mt-4 w-full max-w-[320px]">
          {isDone ? (
            <Button
              block
              onClick={() => {
                setEndModalOpen(false);
                controller.start();
              }}
            >
              开始下一个
            </Button>
          ) : (
            <Button
              block
              variant={isRunning ? 'ghost' : 'primary'}
              onClick={toggle}
              /* 没有有效科目就别让开始：结算时会被判定为无效而静默丢弃，等于白专注一场 */
              disabled={isIdle && !activeSubject}
            >
              {isIdle ? '开始专注' : isRunning ? '暂停' : '继续'}
            </Button>
          )}

          {/* 只在真的可中断（计时中/暂停）时渲染。空闲与已完成时它无事可做，
              一个灰按钮只会招来「点了没反应」的困惑 */}
          {controller.canAbort && (
            <Button variant="outline" onClick={abortNow}>
              提前结束
            </Button>
          )}
        </div>

        {/* 番茄计数（当日清零） */}
        <div className="flex items-center gap-1.5 mt-3.5 text-[12px] text-ink3 flex-wrap justify-center">
          <span className="flex gap-1.5">
            {Array.from({ length: 3 }, (_, i) => (
              <i
                key={i}
                className={cx(
                  'w-2.5 h-2.5 rounded-full inline-block',
                  i < controller.tomatoesToday % 3 ? 'bg-brand' : 'bg-line',
                )}
              />
            ))}
          </span>
          <span>
            今日 {controller.tomatoesToday} 个番茄
            {controller.tomatoesToday > 0 && controller.untilLongBreak > 0
              ? ` · 再 ${controller.untilLongBreak} 个后长休息`
              : ''}
            {controller.pausedSeconds > 0
              ? ` · 已暂停 ${formatMinutes(controller.pausedSeconds / 60)}（不计入统计）`
              : ''}
          </span>
        </div>

        <p className="text-[11.5px] text-ink3 mt-2 text-center">
          每 3 个番茄长休息 20 分钟（当日清零）· 断网也能继续，联网自动补交
        </p>
      </div>

      {/* 自定义时长 */}
      <CustomMinutesDialog
        open={customOpen}
        initial={presets}
        onClose={() => setCustomOpen(false)}
        onConfirm={(m) => {
          controller.setPlannedMinutes(m);
          setCustomOpen(false);
        }}
      />

      {/* 结束提醒：页面弹窗（浏览器通知由 hook 负责，权限被拒则静默降级） */}
      <Modal
        open={endModalOpen}
        onClose={() => setEndModalOpen(false)}
        closeOnBackdrop={false}
      >
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-brand-soft border border-brand-line mx-auto flex items-center justify-center text-[24px]">
            ✓
          </div>
          <h3 className="text-[17px] font-bold mt-3">
            {controller.pausedSeconds > 0 ? '专注完成' : '番茄完成！'}
          </h3>
          <p className="text-[13.5px] text-ink2 mt-1.5">
            {activeSubject?.name ?? '本段'} · 已记录 {formatMinutes(controller.plannedMinutes)}
          </p>
          {controller.activeBreak && (
            <p className="text-[12.5px] text-brand-strong mt-1">
              {controller.activeBreak.kind === 'long' ? '该长休息了' : '该休息了'} ·{' '}
              {Math.round(controller.activeBreak.totalSeconds / 60)} 分钟
            </p>
          )}
          <div className="flex gap-2.5 mt-5">
            <Button variant="ghost" block onClick={() => setEndModalOpen(false)}>
              稍后再说
            </Button>
            <Button block onClick={controller.start}>
              开始下一个
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function CustomMinutesDialog({
  open,
  initial,
  onClose,
  onConfirm,
}: {
  open: boolean;
  initial: number;
  onClose: () => void;
  onConfirm: (minutes: number) => void;
}) {
  const [value, setValue] = useState(String(initial));

  useEffect(() => {
    if (open) setValue(String(initial));
  }, [open, initial]);

  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= FOCUS_MINUTES_MIN && parsed <= FOCUS_MINUTES_MAX;

  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="text-[16px] font-bold">自定义专注时长</h3>
      <p className="text-[12.5px] text-ink3 mt-1">
        可填 {FOCUS_MINUTES_MIN}–{FOCUS_MINUTES_MAX} 分钟
      </p>
      <input
        type="number"
        inputMode="numeric"
        min={FOCUS_MINUTES_MIN}
        max={FOCUS_MINUTES_MAX}
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && valid) onConfirm(parsed);
        }}
        className="w-full mt-3 bg-card border-[1.5px] border-line rounded-xl px-3 py-2.5 text-[16px] tnum outline-none focus:border-brand"
      />
      {!valid && value !== '' && (
        <p className="text-[12px] text-danger mt-1.5">请输入 {FOCUS_MINUTES_MIN}–{FOCUS_MINUTES_MAX} 之间的整数</p>
      )}
      <div className="flex gap-2.5 mt-5">
        <Button variant="ghost" block onClick={onClose}>
          取消
        </Button>
        <Button block disabled={!valid} onClick={() => onConfirm(parsed)}>
          确定
        </Button>
      </div>
    </Modal>
  );
}
