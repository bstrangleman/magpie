import { CheckIcon, CircleNotchIcon, XIcon, type Icon } from '@phosphor-icons/react';
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils.ts';

// --- Buttons -------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: Icon;
  /** Show the icon solid, e.g. a favorite's heart. */
  filled?: boolean;
  loading?: boolean;
};

/** Button styles, also used for links that look like buttons. */
export function buttonClass(variant: ButtonProps['variant'] = 'secondary', size: ButtonProps['size'] = 'md') {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors select-none disabled:opacity-50',
    size === 'sm' ? 'h-7 px-2.5 text-[0.8rem]' : 'h-8 px-3 text-sm',
    variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-110',
    variant === 'secondary' && 'border border-line bg-elevated text-ink hover:bg-hover',
    variant === 'ghost' && 'text-ink-2 hover:bg-hover hover:text-ink',
    variant === 'danger' && 'bg-danger text-white hover:brightness-110',
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, filled, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button ref={ref} disabled={disabled || loading} className={cn(buttonClass(variant, size), className)} {...rest}>
      {loading ? <CircleNotchIcon size={15} className="animate-spin" /> : Icon && <Icon size={15} weight={filled ? 'fill' : 'regular'} />}
      {children}
    </button>
  );
});

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: Icon;
  label: string;
  size?: number;
  active?: boolean;
  /** Show the icon solid, e.g. a favorite's heart. */
  filled?: boolean;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 16, active, filled, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink',
        active && 'text-accent hover:text-accent',
        className,
      )}
      {...rest}
    >
      <Icon size={size} weight={filled ? 'fill' : 'regular'} />
    </button>
  );
});

export const Spinner = ({ size = 16, className }: { size?: number; className?: string }) => (
  <CircleNotchIcon size={size} className={cn('animate-spin text-ink-3', className)} />
);

// --- Floating layer (menus, popovers, context menus) ---------------------------------

type Anchor = DOMRect | { x: number; y: number };

export function Floating({
  anchor,
  align = 'start',
  onClose,
  children,
  className,
  ignore,
}: {
  anchor: Anchor;
  align?: 'start' | 'end';
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Element whose clicks shouldn't count as "outside" (the trigger). */
  ignore?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if ('width' in anchor) {
      left = align === 'end' ? anchor.right - width : anchor.left;
      top = anchor.bottom + 4;
      if (top + height > vh - 8 && anchor.top - height - 4 > 8) top = anchor.top - height - 4;
    } else {
      left = anchor.x;
      top = anchor.y;
      if (top + height > vh - 8) top = Math.max(8, anchor.y - height);
    }
    left = Math.min(Math.max(8, left), vw - width - 8);
    top = Math.min(Math.max(8, top), vh - height - 8);
    setPos({ left, top });
  }, [anchor, align]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || ignore?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onBlur = () => onClose();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [onClose, ignore]);

  return createPortal(
    <div
      ref={ref}
      style={pos ?? { left: -9999, top: -9999 }}
      className={cn(
        // A column, so content that can shrink (min-h-0, like the collection list) fits the height
        // limit and scrolls itself, instead of the panel scrolling around it.
        'shadow-pop animate-pop fixed z-50 flex max-h-[min(70vh,560px)] min-w-44 flex-col overflow-y-auto rounded-lg border border-line bg-elevated py-1 text-sm text-ink',
        className,
      )}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function Popover({
  trigger,
  children,
  align = 'start',
  className,
}: {
  trigger: (props: { ref: Ref<HTMLButtonElement>; onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  className?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const close = () => setAnchor(null);
  return (
    <>
      {trigger({
        ref,
        onClick: () => setAnchor((a) => (a ? null : (ref.current?.getBoundingClientRect() ?? null))),
        'aria-expanded': !!anchor,
      })}
      {anchor && (
        <Floating anchor={anchor} align={align} onClose={close} ignore={ref.current} className={className}>
          {children(close)}
        </Floating>
      )}
    </>
  );
}

export function MenuItem({
  icon: Icon,
  children,
  onClick,
  checked,
  danger,
  disabled,
  hint,
  iconColor,
}: {
  icon?: Icon;
  children: ReactNode;
  onClick?: () => void;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  iconColor?: string;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-[0.35rem] text-left hover:bg-hover disabled:opacity-40',
        danger && 'text-danger',
      )}
    >
      {checked !== undefined && (
        <span className="flex w-3.5 justify-center text-accent">{checked && <CheckIcon size={14} weight="bold" />}</span>
      )}
      {Icon && <Icon size={16} className={cn('shrink-0', !danger && 'text-ink-2')} style={iconColor ? { color: iconColor } : undefined} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </button>
  );
}

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-3 pt-1.5 pb-1 text-xs font-medium text-ink-3">{children}</div>
);
export const MenuSeparator = () => <div className="my-1 border-t border-line" />;

// --- Modal --------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 'max-w-md',
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="animate-fade fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={cn('shadow-pop animate-pop w-full rounded-xl border border-line bg-elevated text-ink', width)}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton icon={XIcon} label="Close" onClick={onClose} className="-mr-2" />
        </div>
        <div className="px-5 pb-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// --- Form controls -------------------------------------------------------------

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.8rem] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(inputClass, 'w-full', className)} {...rest} />;
});

/** A textarea that grows with its content. */
export function AutoTextarea({ className, value, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} value={value} rows={1} className={cn(inputClass, 'w-full resize-none', className)} {...rest} />;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cn(inputClass, 'pr-8', className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      {children}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-2 rounded-md bg-danger/10 px-2.5 py-1.5 text-sm whitespace-pre-line text-danger">{children}</p>;
}
