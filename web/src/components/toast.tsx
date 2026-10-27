import { XIcon } from '@phosphor-icons/react';
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils.ts';

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; onClick: () => void };
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, opts: { tone?: Toast['tone']; action?: Toast['action'] } = {}) {
  const t: Toast = { id: nextId++, message, tone: opts.tone ?? 'info', action: opts.action };
  toasts = [...toasts.slice(-3), t];
  emit();
  setTimeout(() => dismiss(t.id), opts.action ? 6000 : 3500);
}

export const toastError = (err: unknown) => toast(err instanceof Error ? err.message : 'Something went wrong', { tone: 'error' });

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
  );
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'animate-pop pointer-events-auto flex max-w-md items-center gap-3 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg',
            t.tone === 'error' ? 'bg-[#c4332b]' : 'bg-[#26272b]',
          )}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              className="font-semibold text-[#8cc4ff] hover:underline"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button aria-label="Dismiss" className="text-white/60 hover:text-white" onClick={() => dismiss(t.id)}>
            <XIcon size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
