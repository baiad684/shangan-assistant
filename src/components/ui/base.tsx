'use client';

/** 基础 UI 原子组件。全部无业务逻辑，样式统一走语义令牌，暗色模式自动跟随。 */
import type {
  ButtonHTMLAttributes,
  ComponentPropsWithRef,
  ReactNode,
} from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ── 卡片 ──────────────────────────────────────────────────────────────

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cx(
        'bg-card border border-line rounded-[var(--radius-card)]',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHead({
  title,
  hint,
  right,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx('flex items-center justify-between gap-3 mb-3', className)}>
      {/* 窄屏（320px 那档）标题会被挤着换行、断在词中间，所以标题禁止换行、提示省略号收尾 */}
      <h3 className="text-[13px] font-semibold text-ink flex items-center gap-2 min-w-0">
        <span className="whitespace-nowrap">{title}</span>
        {hint ? (
          <span className="text-[12px] font-normal text-ink3 truncate min-w-0">{hint}</span>
        ) : null}
      </h3>
      {right ? <div className="shrink-0 flex items-center">{right}</div> : null}
    </header>
  );
}

// ── 按钮 ──────────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
};

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-brand text-white hover:brightness-95 active:brightness-90',
  ghost: 'bg-soft text-ink2 hover:text-ink',
  outline: 'border border-line bg-card text-ink2 hover:border-brand-line hover:text-brand-strong',
  danger: 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/15',
};

const BUTTON_SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'text-[12.5px] px-3 py-1.5 rounded-lg',
  md: 'text-[14px] px-4 py-2.5 rounded-xl',
  lg: 'text-[15px] px-6 py-3 rounded-xl',
};

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(
        // whitespace-nowrap：按钮文字永远不该被容器压成两行。
        // 窄容器里宁可让相邻元素收缩（调用方给它们加 min-w-0），也不拆按钮的文案。
        'font-semibold whitespace-nowrap transition-[filter,background-color,border-color,color] disabled:opacity-45 disabled:cursor-not-allowed select-none',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── 表单 ──────────────────────────────────────────────────────────────

/** React 19 中 ref 是普通 prop，所以用 ComponentPropsWithRef 让调用方能直接传 ref */
export function Input({ className, ...rest }: ComponentPropsWithRef<'input'>) {
  return (
    <input
      className={cx(
        'w-full bg-card border-[1.5px] border-line rounded-xl px-3 py-2.5 text-[14px] outline-none',
        'focus:border-brand placeholder:text-ink3 transition-colors',
        className,
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: ComponentPropsWithRef<'select'>) {
  return (
    <select
      className={cx(
        'bg-card border-[1.5px] border-line rounded-xl px-3 py-2 text-[13.5px] outline-none focus:border-brand',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12.5px] font-medium text-ink2 mb-1.5">
        {label}
        {hint ? <span className="ml-2 font-normal text-ink3">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'w-11 h-6 rounded-full relative transition-colors shrink-0',
        checked ? 'bg-brand' : 'bg-line',
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all',
          checked ? 'left-[22px]' : 'left-0.5',
        )}
      />
    </button>
  );
}

// ── 选择器 ────────────────────────────────────────────────────────────

export function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={active && color ? { borderColor: color, color, background: `${color}18` } : undefined}
      className={cx(
        'px-3.5 py-1.5 rounded-full border-[1.5px] text-[13px] transition-colors whitespace-nowrap',
        active
          ? 'border-brand text-brand-strong bg-brand-soft font-semibold'
          : 'border-line text-ink2 bg-card hover:border-brand-line',
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex bg-soft rounded-xl p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cx(
            'rounded-[10px] font-medium transition-colors whitespace-nowrap',
            size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[12.5px]',
            value === opt.value
              ? 'bg-card text-ink shadow-sm'
              : 'text-ink3 hover:text-ink2',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── 进度 ──────────────────────────────────────────────────────────────

export function ProgressBar({
  value,
  color,
  height = 12,
  ticks,
  className,
}: {
  /** 0-1 */
  value: number;
  color?: string;
  height?: number;
  /** 刻度线位置（0-1）与标签 */
  ticks?: Array<{ at: number; label: string }>;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;

  return (
    <div className={cx('relative', className)} style={{ height }}>
      <div className="absolute inset-0 rounded-full bg-line/70 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: color ?? 'linear-gradient(90deg,#34d399,var(--c-brand))',
          }}
        />
      </div>

      {ticks?.map((tick) => (
        <div key={tick.label} className="absolute top-[-3px]" style={{ left: `${tick.at * 100}%` }}>
          <div className="w-0.5 rounded-full bg-ink3/60" style={{ height: height + 6 }} />
          <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 text-[10px] text-ink3 whitespace-nowrap">
            {tick.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Ring({
  progress,
  size = 210,
  stroke = 11,
  color,
  children,
}: {
  /** 0-1 */
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.max(0, Math.min(1, progress)));

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color ?? 'var(--c-brand)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-300 ease-linear"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

// ── 标签 ──────────────────────────────────────────────────────────────

export function SubjectTag({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-block text-[10.5px] font-semibold px-2 py-[1px] rounded-md mr-1.5 align-middle"
      style={{ background: `${color}1f`, color }}
    >
      {name}
    </span>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="text-center text-[12.5px] text-ink3 py-6">{children}</p>;
}
