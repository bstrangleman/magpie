import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../lib/utils.ts';

/**
 * Chips + free text input with suggestions from existing tags. Data-free so the
 * browser extension can use it too; the web app wraps it as TagInput.
 */
export function TagField({
  value,
  onChange,
  suggestions: known,
  autoFocus,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: { name: string; count: number }[];
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const lower = new Set(value.map((t) => t.toLowerCase()));
  const q = text.trim().replace(/^#/, '').toLowerCase();
  const suggestions = known
    .filter((t) => !lower.has(t.name.toLowerCase()) && (!q || t.name.toLowerCase().includes(q)))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || b.count - a.count)
    .slice(0, 8);

  const add = (raw: string) => {
    const parts = raw.split(',').map((t) => t.trim().replace(/^#+/, '')).filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase())) next.push(p);
    if (next.length !== value.length) onChange(next);
    setText('');
    setActive(0);
  };

  const open = focused && !!q && suggestions.length > 0;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (open && e.key !== ',') {
        e.preventDefault();
        add(suggestions[active]!.name);
      } else if (text.trim()) {
        e.preventDefault();
        add(text);
      }
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-[2.1rem] flex-wrap items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-1 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft"
      >
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-0.5 rounded bg-field py-0.5 pr-1 pl-1.5 text-[0.8rem]">
            <span className="text-ink-3">#</span>
            {t}
            <button
              aria-label={`Remove ${t}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((x) => x !== t));
              }}
              className="ml-0.5 rounded text-ink-3 hover:text-ink"
            >
              <XIcon size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (text.trim()) add(text);
          }}
          placeholder={value.length ? '' : 'Add tags…'}
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-ink-3"
        />
      </div>
      {open && (
        <div className="shadow-pop absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-elevated py-1">
          {suggestions.map((s, i) => (
            <button
              key={s.name}
              onMouseDown={(e) => {
                e.preventDefault();
                add(s.name);
              }}
              className={cn('flex w-full items-center justify-between px-3 py-1 text-left text-sm', i === active && 'bg-hover')}
            >
              <span>
                <span className="text-ink-3">#</span>
                {s.name}
              </span>
              <span className="text-xs text-ink-3">{s.count}</span>
            </button>
          ))}
          {q && !suggestions.some((s) => s.name.toLowerCase() === q) && (
            <div className="flex items-center gap-1.5 border-t border-line px-3 pt-1.5 pb-0.5 text-xs text-ink-3">
              <PlusIcon size={12} /> Press Enter to create “{text.trim().replace(/^#/, '')}”
            </div>
          )}
        </div>
      )}
    </div>
  );
}
