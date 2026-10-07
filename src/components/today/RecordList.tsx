'use client';

/**
 * 今日完成记录（IMPLEMENTATION.md §4.5）
 *
 * 交互取向是「低摩擦」：标题回车即记一笔，科目与备注收在二级展开里，
 * 不强迫填。所以这里没有勾选框、没有优先级、没有顺延 —— 记录式而非待办式。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardHead, EmptyHint, Input, Select, SubjectTag, cx } from '@/components/ui/base';
import { ConfirmDialog, Modal, useToast } from '@/components/ui/overlay';
import { useToday } from './TodayProvider';
import { api, errorMessage } from '@/lib/api-client';
import { formatMinutes, todayLocalDate } from '@/lib/domain/time';
import { MANUAL_BACKFILL_DAYS, type CompletedItemDTO, type FocusSessionDTO } from '@/lib/types';

/** 快捷键 N 与页面内按钮都通过这个事件把焦点交给输入框，避免跨组件传 ref */
export const NEW_RECORD_EVENT = 'shangan:new-record';

export function RecordList() {
  const { items, subjects, addItem, removeItem } = useToday();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CompletedItemDTO | null>(null);
  const [customDate, setCustomDate] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onNewRecord = () => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    window.addEventListener(NEW_RECORD_EVENT, onNewRecord);
    return () => window.removeEventListener(NEW_RECORD_EVENT, onNewRecord);
  }, []);

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    try {
      const res = await api.post<{ item: CompletedItemDTO }>('/api/records', {
        title: trimmed,
        subjectId,
        note: note.trim() || null,
      });
      addItem(res.item);
      setTitle('');
      setNote('');
      setExpanded(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setBusy(true);
    try {
      await api.del(`/api/records/${target.id}`);
      removeItem(target.id);
      setPendingDelete(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead title="今日完成" hint="做完就记一笔" right={<span className="text-[12px] text-ink3">{items.length} 项</span>} />

      {items.length === 0 ? (
        <EmptyHint>还没有记录。做完一件事随手记一笔，回看时就是一篇学习日记。</EmptyHint>
      ) : (
        <ul>
          {items.map((item) => {
            const subject = item.subjectId !== null ? subjectMap.get(item.subjectId) : null;
            return (
              <li
                key={item.id}
                className="flex items-start gap-2.5 py-2.5 border-b border-line/60 last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[14.5px] leading-snug break-words">
                    {subject ? <SubjectTag name={subject.name} color={subject.color} /> : null}
                    {item.title}
                  </div>
                  {item.note ? <div className="text-[12px] text-ink3 mt-0.5">{item.note}</div> : null}
                </div>
                <span className="text-[12px] text-ink3 tnum shrink-0 mt-0.5">
                  {item.createdAt.slice(11, 16)}
                </span>
                <button
                  type="button"
                  onClick={() => setPendingDelete(item)}
                  aria-label={`删除 ${item.title}`}
                  className="shrink-0 w-6 h-6 rounded-md text-ink3 hover:text-danger hover:bg-danger/10 transition-colors text-[13px] leading-6"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 记一笔 */}
      <div className="mt-3.5">
        <div className="flex gap-2">
          {/* min-w-0 必须加：input 的自动最小宽度由 size 属性决定（约 20 字符），
              不加它就会顶住空间、把右边的按钮压到换行（「记一」/「笔」）。 */}
          <Input
            ref={inputRef}
            className="flex-1 min-w-0"
            value={title}
            placeholder="刚完成了什么？记一笔（快捷键 N）"
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          {/* shrink-0 让它不被压缩；宽度用 Button 默认的 px-4，不要在调用点覆盖 px
              —— 与组件内的同名 utility 冲突时，胜负由 CSS 生成顺序决定，不可靠。 */}
          <Button className="shrink-0" onClick={() => void submit()} disabled={!title.trim() || busy}>
            记一笔
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[12px] text-ink3 hover:text-brand-strong transition-colors"
        >
          {expanded ? '收起科目与备注' : '+ 添加科目 / 备注（可选）'}
        </button>

        {expanded && (
          <div className="mt-2.5 flex flex-col gap-2 anim-fade-up">
            <div className="flex gap-2">
              <Select
                value={subjectId ?? ''}
                onChange={(e) => setSubjectId(e.target.value ? Number(e.target.value) : null)}
                className="flex-1"
              >
                <option value="">不关联科目</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <Input
              value={note}
              placeholder="备注（单行，可选）"
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条记录？"
        description={
          pendingDelete ? (
            <>
              「{pendingDelete.title}」将被永久删除，此操作不可撤销。
              <br />
              本地自动备份仍保留历史快照。
            </>
          ) : ''
        }
        confirmText="删除"
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  );
}

// ── 手动补记（IMPLEMENTATION.md §4.4）───────────────────────────────────

export function ManualBackfillCard({ initial }: { initial: FocusSessionDTO[] }) {
  const { subjects, patchAggregate, aggregate } = useToday();
  const toast = useToast();

  const [entries, setEntries] = useState<FocusSessionDTO[]>(initial);
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FocusSessionDTO | null>(null);
  const [busy, setBusy] = useState(false);

  const today = todayLocalDate();
  const [form, setForm] = useState({
    subjectId: subjects[0]?.id ?? 0,
    date: today,
    minutes: 60,
    note: '',
  });

  // 可回溯日期范围：当天 + 过去 7 天
  const dateOptions = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i <= MANUAL_BACKFILL_DAYS; i++) {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }, [today]);

  const submit = async () => {
    if (busy) return;
    if (!form.subjectId) {
      toast.error('请选择科目');
      return;
    }
    if (!Number.isInteger(form.minutes) || form.minutes <= 0) {
      toast.error('时长必须是正整数分钟');
      return;
    }

    setBusy(true);
    try {
      const res = await api.post<{
        session: FocusSessionDTO;
        today: { minutes: number; currentStreak: number; totalMinutes: number };
      }>('/api/focus-sessions', {
        subjectId: form.subjectId,
        startedAt: `${form.date}T00:00:00+08:00`,
        localDate: form.date,
        focusMinutes: form.minutes,
        source: 'manual',
        note: form.note.trim() || null,
      });

      if (res.session.localDate === today) {
        setEntries((prev) => [...prev, res.session]);
      } else {
        toast.success(`已补记到 ${form.date}`);
      }

      patchAggregate({
        minutes: res.today.minutes,
        totalMinutes: res.today.totalMinutes,
        currentStreak: res.today.currentStreak,
        checkedIn: res.today.minutes >= 60,
        passed: res.today.minutes >= 120,
      });

      setOpen(false);
      setForm((f) => ({ ...f, minutes: 60, note: '' }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setBusy(true);
    try {
      const res = await api.del<{
        today: { minutes: number; currentStreak: number; totalMinutes: number };
      }>(`/api/focus-sessions/${target.id}`);
      setEntries((prev) => prev.filter((e) => e.id !== target.id));
      patchAggregate({
        minutes: res.today.minutes,
        totalMinutes: res.today.totalMinutes,
        currentStreak: res.today.currentStreak,
        checkedIn: res.today.minutes >= 60,
        passed: res.today.minutes >= 120,
      });
      setPendingDelete(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const todayManualMinutes = entries.reduce((sum, e) => sum + e.focusMinutes, 0);

  return (
    <Card>
      <CardHead
        title="手动补记"
        hint={`只能补当天及过去 ${MANUAL_BACKFILL_DAYS} 天`}
        right={
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            补记一笔
          </Button>
        }
      />

      {entries.length === 0 ? (
        <p className="text-[12.5px] text-ink3">
          忘了开番茄钟？在这里补上。今日补记 {formatMinutes(todayManualMinutes)}。
        </p>
      ) : (
        <>
          <ul>
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2.5 py-2 border-b border-line/60 last:border-b-0"
              >
                <SubjectTag name={entry.subjectName} color={entry.subjectColor} />
                <span className="flex-1 text-[13px] text-ink2 tnum">
                  {formatMinutes(entry.focusMinutes)}
                </span>
                {entry.note ? <span className="text-[12px] text-ink3 truncate max-w-[120px]">{entry.note}</span> : null}
                <button
                  type="button"
                  onClick={() => setPendingDelete(entry)}
                  aria-label="删除补记"
                  className="w-6 h-6 rounded-md text-ink3 hover:text-danger hover:bg-danger/10 text-[13px] leading-6"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink3 mt-2">
            今日补记合计 {formatMinutes(todayManualMinutes)}，计入累计 {formatMinutes(aggregate.totalMinutes)} 与经验值。
          </p>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} variant="sheet">
        <h3 className="text-[16px] font-bold">手动补记</h3>
        <p className="text-[12.5px] text-ink3 mt-1">
          只记科目、日期和时长，不需要精确时间段。补记同样计入统计与经验值。
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <span className="block text-[12.5px] font-medium text-ink2 mb-1.5">科目</span>
            <div className="flex gap-2 flex-wrap">
              {subjects.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, subjectId: s.id }))}
                  className={cx(
                    'px-3.5 py-1.5 rounded-full border-[1.5px] text-[13px] transition-colors',
                    form.subjectId === s.id
                      ? 'font-semibold'
                      : 'border-line text-ink2',
                  )}
                  style={
                    form.subjectId === s.id
                      ? { borderColor: s.color, color: s.color, background: `${s.color}18` }
                      : undefined
                  }
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <span className="block text-[12.5px] font-medium text-ink2 mb-1.5">日期</span>
              <Select
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full"
              >
                {dateOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                    {d === today ? '（今天）' : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex-1">
              <span className="block text-[12.5px] font-medium text-ink2 mb-1.5">时长（分钟）</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={form.minutes}
                onChange={(e) => setForm((f) => ({ ...f, minutes: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div>
            <span className="block text-[12.5px] font-medium text-ink2 mb-1.5">备注（可选）</span>
            <Input
              value={form.note}
              maxLength={200}
              placeholder="例如：图书馆闭馆前刷了一套阅读"
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex gap-2.5 mt-5">
          <Button variant="ghost" block onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button block onClick={() => void submit()} disabled={busy}>
            {busy ? '提交中…' : '确认补记'}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条补记？"
        description="删除后当日时长与经验值会同步减少，连续打卡天数也可能回退。"
        confirmText="删除"
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  );
}
