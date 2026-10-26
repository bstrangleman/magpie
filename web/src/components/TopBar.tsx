import { ChevronDown, FileUp, FolderPlus, Link2, Menu, Plus, Search, SlidersHorizontal, StickyNote, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSidebar } from '../lib/queries.ts';
import { cn } from '../lib/utils.ts';
import { AddLinkDialog, CollectionDialog, NoteDialog, UploadDialog } from './dialogs.tsx';
import { IconButton, MenuItem, MenuLabel, MenuSeparator, Popover } from './ui.tsx';
import { useUI } from './ui-context.tsx';

const TIPS: [string, string][] = [
  ['#tag', 'Has tag'],
  ['-#tag', 'Without tag'],
  ['is:fav', 'Favorites'],
  ['type:article', 'Type: link, article, video, image, audio, document, note'],
  ['site:github.com', 'From a site'],
  ['"exact phrase"', 'Exact phrase'],
  ['before:2024-01-01', 'Saved before a date'],
  ['after:2024-01-01', 'Saved after a date'],
];

export function TopBar() {
  const { q, setQuery, openDialog, setSidebarOpen, view } = useUI();
  const { data } = useSidebar();
  const navigate = useNavigate();
  const [text, setText] = useState(q);
  const input = useRef<HTMLInputElement>(null);

  // Keep the box in sync when the URL changes (e.g. navigating to another view).
  useEffect(() => {
    setText(q);
  }, [q]);

  // Debounce typing into the URL.
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => setQuery(text), 220);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable;
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const placeholder = view.kind === 'collection' ? `Search in ${data?.collections.find((c) => c.id === view.id)?.name ?? 'collection'}` : 'Search';

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-3 md:px-4">
      <IconButton icon={Menu} label="Show sidebar" size={18} className="md:hidden" onClick={() => setSidebarOpen(true)} />
      <div className="relative flex h-8 w-full max-w-[26rem] items-center rounded-md bg-field focus-within:ring-2 focus-within:ring-accent-soft">
        <Search size={15} className="ml-2.5 shrink-0 text-ink-3" />
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText('');
              setQuery('');
              input.current?.blur();
            }
            if (e.key === 'Enter') setQuery(text);
          }}
          placeholder={placeholder}
          aria-label="Search bookmarks"
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-ink-3"
        />
        {text && <IconButton icon={X} label="Clear search" size={14} className="size-6" onClick={() => (setText(''), setQuery(''))} />}
        <Popover
          align="end"
          trigger={(p) => (
            <button {...p} aria-label="Search tips" className="mr-1 flex h-6 items-center gap-0.5 rounded px-1 text-ink-3 hover:bg-hover hover:text-ink-2">
              <SlidersHorizontal size={14} />
              <ChevronDown size={11} />
            </button>
          )}
        >
          {(close) => (
            <div className="w-80">
              <MenuLabel>Search operators — click to add</MenuLabel>
              {TIPS.map(([op, desc]) => (
                <button
                  key={op}
                  onClick={() => {
                    const next = `${text.trim()} ${op}`.trim();
                    setText(next);
                    setQuery(next);
                    close();
                    input.current?.focus();
                  }}
                  className="flex w-full items-baseline gap-3 px-3 py-1 text-left text-sm hover:bg-hover"
                >
                  <code className="shrink-0 font-mono text-[0.8rem] text-accent">{op}</code>
                  <span className="truncate text-xs text-ink-3">{desc}</span>
                </button>
              ))}
              <p className="px-3 pt-1.5 pb-1 text-xs text-ink-3">
                Press <kbd className="rounded border border-line px-1">/</kbd> anywhere to search.
              </p>
            </div>
          )}
        </Popover>
      </div>
      <div className="flex-1" />
      <div className="flex">
        <button
          onClick={() => openDialog(<AddLinkDialog />)}
          className="flex h-8 items-center gap-1.5 rounded-l-md bg-accent pr-3 pl-2.5 text-sm font-semibold text-accent-ink hover:brightness-110"
        >
          <Plus size={16} strokeWidth={2.2} /> Add
        </button>
        <Popover
          align="end"
          trigger={(p) => (
            <button {...p} aria-label="More ways to add" className={cn('flex h-8 w-7 items-center justify-center rounded-r-md border-l border-white/25 bg-accent text-accent-ink hover:brightness-110')}>
              <ChevronDown size={14} strokeWidth={2.2} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={Link2} onClick={() => (close(), openDialog(<AddLinkDialog />))}>
                Link
              </MenuItem>
              <MenuItem icon={StickyNote} onClick={() => (close(), openDialog(<NoteDialog />))}>
                Note
              </MenuItem>
              <MenuItem icon={Upload} onClick={() => (close(), openDialog(<UploadDialog />))}>
                Upload files
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={FolderPlus} onClick={() => (close(), openDialog(<CollectionDialog />))}>
                Collection
              </MenuItem>
              <MenuItem icon={FileUp} onClick={() => (close(), navigate('/settings/import'))}>
                Import bookmarks
              </MenuItem>
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}
