import { LoaderCircle, X } from 'lucide-react';
import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ---- buttons ----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'chip-amber text-ink shadow-control hover:brightness-105',
  secondary: 'bg-well text-white ring-1 ring-hairline hover:bg-black/30',
  danger: 'bg-alarm text-white shadow-control hover:brightness-110',
  ghost: 'text-white/80 hover:bg-white/10',
  success: 'panel-lime text-ink shadow-control hover:brightness-105',
};

const buttonSizes = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof buttonSizes;
  busy?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-xl font-bold whitespace-nowrap transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
        buttonSizes[size],
        buttonVariants[variant],
        className,
      )}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/** A square icon-only button; [label] is what a screen reader announces. */
export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-white/75 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---- surfaces ---------------------------------------------------------------

type PanelTone = 'blue' | 'lime' | 'sky' | 'grape' | 'deep';

const panelTones: Record<PanelTone, string> = {
  blue: 'panel-blue text-white',
  lime: 'panel-lime text-ink',
  sky: 'panel-sky text-white',
  grape: 'panel-grape text-white',
  deep: 'bg-page-deep/70 text-white ring-1 ring-hairline',
};

export function Panel({
  tone = 'blue',
  className,
  children,
}: {
  tone?: PanelTone;
  className?: string;
  children: ReactNode;
}) {
  return <section className={cx('rounded-[26px] shadow-panel', panelTones[tone], className)}>{children}</section>;
}

/** Page title with the orange rule the operator app puts under every heading. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-white/65">{subtitle}</p>}
        <div className="mt-3 h-[3px] w-12 rounded bg-amber-hi" />
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
      <h2 className="flex-1 text-xs font-bold tracking-[0.14em] text-white/70 uppercase">{children}</h2>
      {trailing}
    </div>
  );
}

// ---- form controls ----------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-semibold text-white/75">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-white/55">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-semibold text-signal">{error}</span>}
    </label>
  );
}

const control =
  'w-full rounded-xl bg-well px-3 py-2.5 text-[15px] text-white ring-1 ring-transparent placeholder:text-white/40 focus:ring-2 focus:ring-amber-hi focus:outline-none disabled:opacity-60';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(control, className)} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cx(control, 'cursor-pointer', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(control, 'min-h-20 resize-y', className)} />;
}

/** A row of mutually exclusive choices, one of which is always selected. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cx('flex flex-wrap gap-1 rounded-xl bg-well p-1', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(
            'flex-1 rounded-lg px-3 py-2 text-sm font-bold whitespace-nowrap transition',
            option.value === value ? 'chip-amber text-ink shadow-control' : 'text-white/75 hover:bg-white/10',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---- feedback ---------------------------------------------------------------

type BadgeTone = 'ok' | 'low' | 'out' | 'info' | 'muted' | 'amber' | 'grape';

const badgeTones: Record<BadgeTone, string> = {
  ok: 'bg-lime-hi/20 text-lime-hi ring-lime-hi/40',
  low: 'bg-signal/15 text-signal ring-signal/40',
  out: 'bg-alarm/35 text-red-100 ring-red-300/50',
  info: 'bg-sky-hi/20 text-sky-100 ring-sky-hi/40',
  muted: 'bg-white/10 text-white/75 ring-white/20',
  amber: 'bg-amber-hi/20 text-amber-hi ring-amber-hi/40',
  grape: 'bg-grape-hi/25 text-violet-100 ring-grape-hi/50',
};

export function Badge({
  tone = 'muted',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ring-1',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The orange readout the operator app uses wherever a number is shown. */
export function ValueChip({
  children,
  tone = 'amber',
  className,
}: {
  children: ReactNode;
  tone?: 'amber' | 'signal' | 'dark';
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex min-w-14 items-center justify-center rounded-lg px-2.5 py-1 text-sm font-extrabold tabular-nums',
        tone === 'amber' && 'chip-amber text-ink shadow-control',
        tone === 'signal' && 'chip-signal text-ink shadow-control',
        tone === 'dark' && 'bg-ink text-amber-hi ring-1 ring-hairline',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx('size-5 animate-spin text-amber-hi', className)} />;
}

export function Loading({ label = 'පූරණය වෙමින්...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-white/70">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-well text-white/55">{icon}</div>
      <p className="font-bold">{title}</p>
      {detail && <p className="mt-1 max-w-md text-sm text-white/60">{detail}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-alarm/30 px-3 py-2 text-sm font-semibold text-red-50 ring-1 ring-red-300/40">
      {children}
    </p>
  );
}

// ---- dialogs ----------------------------------------------------------------

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  footer,
  size = 'md',
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'flex max-h-[92vh] w-full flex-col rounded-t-[26px] bg-blue-lo shadow-panel ring-1 ring-hairline sm:rounded-[26px]',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
        )}
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-white/65">{subtitle}</p>}
            <div className="mt-2 h-[3px] w-11 rounded bg-amber-hi" />
          </div>
          <IconButton label="වසන්න" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </header>
        <div className="overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>
        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-hairline px-5 py-4 sm:px-6">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/** A table that scrolls sideways on a phone instead of squashing its columns. */
export function TableFrame({ children }: { children: ReactNode }) {
  return <div className="-mx-1 overflow-x-auto px-1">{children}</div>;
}

export const th = 'px-3 py-2.5 text-left text-[11px] font-bold tracking-[0.12em] text-white/60 uppercase';
export const td = 'px-3 py-3 align-middle';
