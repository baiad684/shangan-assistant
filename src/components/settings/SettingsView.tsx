'use client';

/**
 * 设置页（快捷键 4）
 *
 * 所有改动即时保存（PUT /api/settings 局部更新），保存后 router.refresh() 让壳层的
 * 倒计时/目标线立刻跟上 —— 设置项分散在多个卡片，用「立即生效」比「底部保存按钮」摩擦更低。
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardHead, Input, Segmented, Select, Switch, cx } from '@/components/ui/base';
import { ConfirmDialog, Modal, SettingRow, useToast } from '@/components/ui/overlay';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';
import { api, errorMessage } from '@/lib/api-client';
import { formatMinutes } from '@/lib/domain/time';
import {
  DEFAULT_POMODORO,
  SUBJECT_PALETTE,
  type AppSettings,
  type PomodoroSettings,
  type SubjectDTO,
} from '@/lib/types';

interface BackupFile {
  name: string;
  size: number;
  mtime: string;
}

export function SettingsView({
  settings: initialSettings,
  subjects: initialSubjects,
  backups: initialBackups,
}: {
  settings: AppSettings;
  subjects: SubjectDTO[];
  backups: BackupFile[];
}) {
  const toast = useToast();
  const router = useRouter();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();

  const [settings, setSettings] = useState(initialSettings);
  const [subjects, setSubjects] = useState(initialSubjects);
  const [backups] = useState(initialBackups);
  const [saving, setSaving] = useState(false);

  const [newSubject, setNewSubject] = useState({ open: false, name: '', color: SUBJECT_PALETTE[0] as string });
  const [pendingArchive, setPendingArchive] = useState<SubjectDTO | null>(null);
  const [pendingImport, setPendingImport] = useState<unknown | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── 设置保存 ────────────────────────────────────────────────────────
  const patch = async (next: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...next }));
    setSaving(true);
    try {
      const res = await api.put<{ settings: AppSettings }>('/api/settings', next);
      setSettings(res.settings);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
      setSettings(initialSettings);
    } finally {
      setSaving(false);
    }
  };

  const patchPomodoro = (next: Partial<PomodoroSettings>) =>
    patch({ pomodoro: { ...settings.pomodoro, ...next } });

  // ── 科目 ────────────────────────────────────────────────────────────
  const addSubject = async () => {
    const name = newSubject.name.trim();
    if (!name) return;
    try {
      const res = await api.post<{ subject: SubjectDTO }>('/api/subjects', {
        name,
        color: newSubject.color,
      });
      setSubjects((prev) => [...prev, res.subject]);
      setNewSubject({ open: false, name: '', color: SUBJECT_PALETTE[0] });
      router.refresh();
      toast.success(`已添加科目「${res.subject.name}」`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const renameSubject = async (subject: SubjectDTO, name: string, color: string) => {
    try {
      const res = await api.patch<{ subject: SubjectDTO }>(`/api/subjects/${subject.id}`, { name, color });
      setSubjects((prev) => prev.map((s) => (s.id === subject.id ? res.subject : s)));
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const archiveSubject = async () => {
    if (!pendingArchive) return;
    try {
      const res = await api.del<{ retainedSessions: number }>(`/api/subjects/${pendingArchive.id}`);
      setSubjects((prev) => prev.filter((s) => s.id !== pendingArchive.id));
      setPendingArchive(null);
      router.refresh();
      toast.success(`已停用科目，${res.retainedSessions} 条历史记录仍保留在统计中`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  // ── 备份 ────────────────────────────────────────────────────────────
  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      setPendingImport(JSON.parse(text));
    } catch {
      toast.error('文件不是合法的 JSON');
    }
  };

  const confirmImport = async () => {
    if (pendingImport === null) return;
    setSaving(true);
    try {
      const res = await api.post<{ counts: Record<string, number> }>('/api/backup/import', {
        payload: pendingImport,
      });
      setPendingImport(null);
      toast.success(
        `恢复完成：科目 ${res.counts.subjects} · 记录 ${res.counts.sessions} · 事项 ${res.counts.items}`,
      );
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
      router.push('/login');
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="px-4 pt-3 flex flex-col gap-3">
      {/* 考试与目标 */}
      <Card>
        <CardHead title="考试与目标" right={saving ? <span className="text-[11.5px] text-ink3">保存中…</span> : null} />
        <SettingRow label="考试日期">
          <Input
            type="date"
            value={settings.examDate}
            onChange={(e) => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) void patch({ examDate: e.target.value });
            }}
            className="w-[150px] py-1.5 text-[13px]"
          />
        </SettingRow>
        <SettingRow label="每日目标" value={`${formatMinutes(settings.dailyGoalMinutes)}`}>
          <Select
            value={settings.dailyGoalMinutes}
            onChange={(e) => void patch({ dailyGoalMinutes: Number(e.target.value) })}
            className="py-1.5"
          >
            {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
              <option key={h} value={h * 60}>
                {h} 小时
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow label="每周起始日">
          <Segmented
            size="sm"
            value={String(settings.weekStart) as '0' | '1'}
            onChange={(v) => void patch({ weekStart: v === '1' ? 1 : 0 })}
            options={[
              { value: '1', label: '周一' },
              { value: '0', label: '周日' },
            ]}
          />
        </SettingRow>
        <p className="text-[11.5px] text-ink3 pt-2">
          打卡线 1 小时、达标线 2 小时为固定保底线；上方的「每日目标」是目标线，只影响进度条。
        </p>
      </Card>

      {/* 番茄钟 */}
      <Card>
        <CardHead title="番茄钟" />
        <SettingRow label="专注时长" value={`${settings.pomodoro.focusMinutes} 分钟`}>
          <Select
            value={settings.pomodoro.focusMinutes}
            onChange={(e) => void patchPomodoro({ focusMinutes: Number(e.target.value) })}
            className="py-1.5"
          >
            {[15, 20, 25, 30, 40, 45, 50, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} 分钟
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow label="短休息" value={`${settings.pomodoro.shortBreakMinutes} 分钟`}>
          <Select
            value={settings.pomodoro.shortBreakMinutes}
            onChange={(e) => void patchPomodoro({ shortBreakMinutes: Number(e.target.value) })}
            className="py-1.5"
          >
            {[3, 5, 10, 15, 20].map((m) => (
              <option key={m} value={m}>
                {m} 分钟
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow
          label={`长休息（每 ${settings.pomodoro.longBreakEvery} 个番茄）`}
          value={`${settings.pomodoro.longBreakMinutes} 分钟`}
        >
          <Select
            value={settings.pomodoro.longBreakEvery}
            onChange={(e) => void patchPomodoro({ longBreakEvery: Number(e.target.value) })}
            className="py-1.5"
          >
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                每 {n} 个
              </option>
            ))}
          </Select>
          <Select
            value={settings.pomodoro.longBreakMinutes}
            onChange={(e) => void patchPomodoro({ longBreakMinutes: Number(e.target.value) })}
            className="py-1.5"
          >
            {[15, 20, 25, 30].map((m) => (
              <option key={m} value={m}>
                {m} 分钟
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow label="启用长休息">
          <Switch
            label="启用长休息"
            checked={settings.pomodoro.longBreakEnabled}
            onChange={(v) => void patchPomodoro({ longBreakEnabled: v })}
          />
        </SettingRow>
        <button
          type="button"
          onClick={() => void patch({ pomodoro: { ...DEFAULT_POMODORO } })}
          className="mt-2 text-[12px] text-ink3 hover:text-brand-strong transition-colors"
        >
          恢复默认（45 / 10 / 20 · 每 3 个）
        </button>
      </Card>

      {/* 科目管理 */}
      <Card>
        <CardHead
          title="科目管理"
          hint="删除为停用，历史统计保留"
          right={
            <Button size="sm" variant="outline" onClick={() => setNewSubject((s) => ({ ...s, open: !s.open }))}>
              新增
            </Button>
          }
        />

        {newSubject.open && (
          <div className="mb-3 rounded-xl bg-soft p-3 anim-fade-up">
            <Input
              autoFocus
              value={newSubject.name}
              maxLength={20}
              placeholder="科目名称，例如：408 计算机"
              onChange={(e) => setNewSubject((s) => ({ ...s, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addSubject();
              }}
            />
            <ColorPicker
              value={newSubject.color}
              onChange={(color) => setNewSubject((s) => ({ ...s, color }))}
            />
            <div className="flex gap-2 mt-2.5">
              <Button size="sm" variant="ghost" block onClick={() => setNewSubject((s) => ({ ...s, open: false }))}>
                取消
              </Button>
              <Button size="sm" block disabled={!newSubject.name.trim()} onClick={() => void addSubject()}>
                添加
              </Button>
            </div>
          </div>
        )}

        {subjects.map((subject) => (
          <EditableSubjectRow
            key={subject.id}
            subject={subject}
            canRemove={subjects.length > 1}
            onSave={(name, color) => void renameSubject(subject, name, color)}
            onRemove={() => setPendingArchive(subject)}
          />
        ))}
      </Card>

      {/* 外观 */}
      <Card>
        <CardHead title="外观" />
        <SettingRow label="主题">
          <Segmented
            size="sm"
            value={themeMode}
            onChange={(v) => setThemeMode(v as ThemeMode)}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '暗色' },
            ]}
          />
        </SettingRow>
      </Card>

      {/* 数据与安全 */}
      <Card>
        <CardHead title="数据与安全" hint="考研数据无价，勤备份" />

        <SettingRow
          label="导出 JSON 备份"
          onClick={() => {
            window.location.href = '/api/backup/export';
          }}
        >
          <span className="text-[13px] text-ink3">下载</span>
        </SettingRow>

        <SettingRow label="导入恢复" onClick={() => fileRef.current?.click()}>
          <span className="text-[13px] text-ink3">选择文件</span>
        </SettingRow>

        <SettingRow label="修改密码" onClick={() => setPasswordOpen(true)}>
          <span className="text-[13px] text-ink3">{passwordOpen ? '修改中' : ''}</span>
        </SettingRow>

        <SettingRow label="退出登录" onClick={() => void logout()}>
          <span className="text-[13px] text-ink3">→</span>
        </SettingRow>

        <p className="text-[11.5px] text-ink3 pt-2">
          每次启动会自动备份到 backups/（按自然天去重，保留最近 30 份）。忘记密码时在项目目录运行{' '}
          <code className="px-1 py-0.5 rounded bg-soft text-[11px]">npm run reset-password</code> 重置。
        </p>

        {backups.length > 0 && (
          <details className="mt-2">
            <summary className="text-[12px] text-ink3 cursor-pointer">
              查看已有自动备份（{backups.length} 份）
            </summary>
            <ul className="mt-2 space-y-1">
              {backups.slice(0, 12).map((b) => (
                <li key={b.name} className="flex items-center justify-between text-[12px] text-ink2">
                  <span className="tnum">{b.name}</span>
                  <span className="text-ink3 tnum">{(b.size / 1024).toFixed(0)} KB</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = '';
        }}
      />

      <ConfirmDialog
        open={pendingArchive !== null}
        title={`停用科目「${pendingArchive?.name ?? ''}」？`}
        description="科目将从选择列表中移除，但它的历史专注记录与统计仍会保留。"
        confirmText="停用"
        tone="danger"
        onCancel={() => setPendingArchive(null)}
        onConfirm={() => void archiveSubject()}
      />

      <ConfirmDialog
        open={pendingImport !== null}
        title="导入会覆盖当前全部数据"
        description="导入后当前的科目、完成记录、专注记录、成就都会被备份文件里的内容替换，且不可撤销。建议先导出一份当前备份。"
        confirmText="确认覆盖导入"
        tone="danger"
        busy={saving}
        onCancel={() => setPendingImport(null)}
        onConfirm={() => void confirmImport()}
      />

      <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />

      <p className="text-[11.5px] text-ink3 text-center pb-4">
        单用户本地应用 · 数据存于本机 SQLite 文件
      </p>
    </div>
  );
}

// ── 子组件 ─────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {SUBJECT_PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`选择颜色 ${color}`}
          onClick={() => onChange(color)}
          className={cx(
            'w-6 h-6 rounded-full transition-transform',
            value === color ? 'ring-2 ring-offset-2 ring-brand scale-110' : '',
          )}
          style={{ background: color }}
        />
      ))}
    </div>
  );
}

function EditableSubjectRow({
  subject,
  canRemove,
  onSave,
  onRemove,
}: {
  subject: SubjectDTO;
  canRemove: boolean;
  onSave: (name: string, color: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(subject.name);
  const [color, setColor] = useState(subject.color);

  if (!editing) {
    return (
      <SettingRow
        label={
          <span className="flex items-center gap-2">
            <i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: subject.color }} />
            {subject.name}
          </span>
        }
      >
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[12.5px] text-ink3 hover:text-brand-strong transition-colors"
        >
          改名 / 颜色
        </button>
        <button
          type="button"
          disabled={!canRemove}
          onClick={onRemove}
          className="text-[12.5px] text-ink3 hover:text-danger disabled:opacity-40 transition-colors ml-2"
        >
          停用
        </button>
      </SettingRow>
    );
  }

  return (
    <div className="py-3 border-b border-line/70 last:border-b-0 anim-fade-up">
      <Input
        value={name}
        maxLength={20}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            onSave(name.trim(), color);
            setEditing(false);
          }
        }}
      />
      <ColorPicker value={color} onChange={setColor} />
      <div className="flex gap-2 mt-2.5">
        <Button
          size="sm"
          variant="ghost"
          block
          onClick={() => {
            setName(subject.name);
            setColor(subject.color);
            setEditing(false);
          }}
        >
          取消
        </Button>
        <Button
          size="sm"
          block
          disabled={!name.trim()}
          onClick={() => {
            onSave(name.trim(), color);
            setEditing(false);
          }}
        >
          保存
        </Button>
      </div>
    </div>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.put('/api/password', { currentPassword: current, newPassword: next });
      toast.success('密码已修改');
      setCurrent('');
      setNext('');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="text-[16px] font-bold">修改密码</h3>
      <div className="flex flex-col gap-3 mt-3">
        <Input
          type="password"
          placeholder="当前密码"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          type="password"
          placeholder="新密码（至少 4 位）"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && current && next.length >= 4) void submit();
          }}
        />
      </div>
      <div className="flex gap-2.5 mt-5">
        <Button variant="ghost" block onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button block disabled={busy || next.length < 4 || !current} onClick={() => void submit()}>
          {busy ? '提交中…' : '确认修改'}
        </Button>
      </div>
    </Modal>
  );
}
