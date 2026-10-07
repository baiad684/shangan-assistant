'use client';

/** 弹层与全局提示：Modal / ConfirmDialog / ToastProvider */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button, cx } from './base';

// ── Toast ─────────────────────────────────────────────────────────────

type ToastTone = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = ++seq.current;
      setItems((prev) => [...prev.slice(-2), { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), tone === 'error' ? 3600 : 2400),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m: string) => show(m, 'success'),
      error: (m: string) => show(m, 'error'),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[99] flex flex-col gap-2 items-center pointer-events-none px-4">
        {items.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={cx(
              'anim-pop pointer-events-auto max-w-[88vw] px-4 py-2.5 rounded-xl text-[13.5px] shadow-lg',
              t.tone === 'error'
                ? 'bg-danger text-white'
                : t.tone === 'success'
                  ? 'bg-emerald-800 text-white dark:bg-emerald-700'
                  : 'bg-emerald-900/95 text-white',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  children,
  /** 'center' 适合确认框与战报；'sheet' 适合移动端表单 */
  variant = 'center',
  className,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  variant?: 'center' | 'sheet';
  className?: string;
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cx(
        'fixed inset-0 z-50 bg-black/55 flex p-4',
        variant === 'center' ? 'items-center justify-center' : 'items-end',
      )}
      onClick={closeOnBackdrop ? onClose : undefined}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'bg-card border border-line w-full',
          variant === 'center'
            ? 'max-w-sm rounded-2xl p-6 anim-pop'
            : 'max-w-md mx-auto rounded-t-2xl p-5 anim-sheet',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** 危险操作确认（删除记录/科目、导入覆盖） */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  tone = 'danger',
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onCancel}>
      <h3 className="text-[16px] font-bold text-ink">{title}</h3>
      {description ? <div className="mt-2 text-[13.5px] text-ink2 leading-relaxed">{description}</div> : null}
      <div className="flex gap-2.5 mt-5">
        <Button variant="ghost" block onClick={onCancel} disabled={busy}>
          {cancelText}
        </Button>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          block
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? '处理中…' : confirmText}
        </Button>
      </div>
    </Modal>
  );
}

// ── 分段控件式选择行（设置页用） ────────────────────────────────────────

export function SettingRow({
  label,
  value,
  onClick,
  children,
}: {
  label: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      className={cx(
        'flex items-center justify-between gap-3 py-3 border-b border-line/70 last:border-b-0',
        interactive && 'cursor-pointer',
      )}
    >
      <div className="text-[14px] text-ink min-w-0">{label}</div>
      <div className="shrink-0 flex items-center gap-2">{children ?? <span className="text-[13px] text-ink3">{value}</span>}</div>
    </div>
  );
}
