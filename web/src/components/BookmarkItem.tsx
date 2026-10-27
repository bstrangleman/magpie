import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  EyeIcon,
  FileTextIcon,
  GhostIcon,
  HeartIcon,
  NoteIcon,
  PencilSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import type { MouseEvent, ReactNode } from 'react';
import type { Bookmark, Collection, ViewMode } from '../../../shared/types.ts';
import { useBulk, useSettings, useUpdateBookmark } from '../lib/queries.ts';
import { cn, plainText, shortDate } from '../lib/utils.ts';
import { CollectionIcon, Favicon } from './common.tsx';
import { ConfirmDialog } from './dialogs.tsx';
import { toast, toastError } from './toast.tsx';
import { Spinner } from './ui.tsx';
import { useUI } from './ui-context.tsx';

export interface ItemProps {
  b: Bookmark;
  mode: ViewMode;
  selected: boolean;
  selecting: boolean;
  active: boolean;
  collection?: Collection;
  onToggleSelect: (e: MouseEvent) => void;
  dropIndicator: 'before' | 'after' | null;
  dragProps: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}

export const canPreview = (b: Bookmark) => b.hasContent || b.type === 'note' || !!b.file || b.type === 'image' || b.type === 'video';

const displayTitle = (b: Bookmark) => b.title || (b.type === 'note' ? plainText(b.note.split('\n')[0]!).slice(0, 120) : '') || b.url || b.file?.name || 'Untitled';

export function BookmarkItem(props: ItemProps) {
  const { b, mode, selected, selecting, active, onToggleSelect, dropIndicator, dragProps } = props;
  const { setPanel } = useUI();
  const settings = useSettings();

  const onOpen = (e: MouseEvent) => {
    if (selecting || e.shiftKey) {
      e.preventDefault();
      onToggleSelect(e);
      return;
    }
    if (e.metaKey || e.ctrlKey) return; // let the browser open a new tab
    if (b.url && !b.file && settings.openAction === 'tab') return;
    e.preventDefault();
    setPanel({ kind: settings.openAction === 'edit' ? 'edit' : canPreview(b) ? 'preview' : 'edit', id: b.id });
  };

  const href = b.url ?? b.file?.url ?? '#';
  const title = (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
      draggable={false}
      className="after:absolute after:inset-0 after:content-['']"
    >
      {displayTitle(b)}
    </a>
  );

  // Room for the selection checkbox; on touch-sized screens only while selecting.
  const gutter = selecting ? 'pl-10' : 'pl-4 sm:pl-10';
  const shell = cn(
    'group/item relative',
    selected ? 'bg-accent-soft' : active ? 'bg-hover' : 'hover:bg-hover/60',
    b.deletedAt != null && 'opacity-80',
  );
  const indicator = dropIndicator && (
    <div
      className={cn(
        'pointer-events-none absolute z-10 rounded bg-accent',
        mode === 'cards' || mode === 'moodboard'
          ? cn('inset-y-0 w-0.5', dropIndicator === 'before' ? '-left-1.5' : '-right-1.5')
          : cn('inset-x-3 h-0.5', dropIndicator === 'before' ? '-top-px' : '-bottom-px'),
      )}
    />
  );

  if (mode === 'cards' || mode === 'moodboard') {
    return (
      <div {...dragProps} className={cn(shell, 'flex flex-col overflow-hidden rounded-lg border border-line', mode === 'moodboard' && 'mb-3 break-inside-avoid')}>
        {indicator}
        <Cover b={b} className={mode === 'cards' ? 'aspect-[16/10]' : b.cover ? '' : 'aspect-[4/3]'} natural={mode === 'moodboard'} />
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
          <div className="line-clamp-2 text-[0.93rem] leading-snug font-semibold">{title}</div>
          {mode === 'cards' && b.description && <p className="line-clamp-2 text-[0.82rem] leading-snug text-ink-2">{b.description}</p>}
          <div className="mt-auto pt-1">
            <Meta {...props} />
          </div>
        </div>
        <SelectBox selected={selected} selecting={selecting} onClick={onToggleSelect} className="top-2 left-2 shadow" />
        <Actions b={b} className="top-2 right-2" />
      </div>
    );
  }

  if (mode === 'headlines') {
    return (
      <div {...dragProps} className={cn(shell, 'flex h-[2.6rem] items-center gap-2.5 border-b border-line pr-3', gutter)}>
        {indicator}
        <SelectBox selected={selected} selecting={selecting} onClick={onToggleSelect} className="top-1/2 left-3 -translate-y-1/2" />
        <TypeIcon b={b} />
        <div className="min-w-0 flex-1 truncate text-[0.93rem] font-medium">
          {title}
          <span className="ml-2 text-[0.8rem] font-normal text-ink-3">{b.site}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-ink-3 group-hover/item:invisible">
          {b.tags.slice(0, 3).map((t) => (
            <span key={t} className="text-accent">
              #{t}
            </span>
          ))}
          <StatusIcons b={b} />
          <span className="tabular-nums">{shortDate(b.createdAt)}</span>
        </div>
        <Actions b={b} className="top-1/2 right-2 -translate-y-1/2" />
      </div>
    );
  }

  // list
  return (
    <div {...dragProps} className={cn(shell, 'flex gap-3.5 border-b border-line py-3 pr-4', gutter)}>
      {indicator}
      <SelectBox selected={selected} selecting={selecting} onClick={onToggleSelect} className="top-3.5 left-3" />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[0.95rem] leading-snug font-semibold">{title}</div>
        {b.description && <p className="mt-0.5 line-clamp-2 text-[0.85rem] leading-snug text-ink-2">{b.description}</p>}
        {b.note && b.type !== 'note' && (
          <p className="mt-1 line-clamp-2 border-l-2 border-[#e2a336] pl-2 text-[0.82rem] text-ink-2">{plainText(b.note)}</p>
        )}
        {b.type === 'note' && !b.description && b.title && <p className="mt-0.5 line-clamp-2 text-[0.85rem] text-ink-2">{plainText(b.note)}</p>}
        <div className="mt-1.5">
          <Meta {...props} />
        </div>
      </div>
      {b.cover && (
        <img
          src={b.cover}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-[4.2rem] w-[6.2rem] shrink-0 rounded-md border border-line object-cover"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      )}
      <Actions b={b} className="top-2.5 right-3" />
    </div>
  );
}

function Cover({ b, className, natural }: { b: Bookmark; className?: string; natural?: boolean }) {
  if (b.cover) {
    return (
      <div className={cn('relative overflow-hidden border-b border-line bg-field', className)}>
        <img
          src={b.cover}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className={cn('w-full', natural ? 'h-auto' : 'h-full object-cover')}
          onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
        />
      </div>
    );
  }
  if (b.type === 'note') {
    return (
      <div className={cn('overflow-hidden border-b border-line bg-[#fdf6dd] p-3 text-[0.8rem] leading-snug whitespace-pre-line text-[#5c4a1d]', className)}>
        <div className="line-clamp-6">{b.note}</div>
      </div>
    );
  }
  return (
    <div className={cn('flex items-center justify-center border-b border-line bg-field', className)}>
      {b.file ? <FileTextIcon size={30} className="text-ink-3" /> : <Favicon src={b.favicon} size={28} />}
    </div>
  );
}

function TypeIcon({ b }: { b: Bookmark }) {
  if (b.type === 'note') return <NoteIcon size={16} className="shrink-0 text-[#e2a336]" />;
  if (b.file) return <FileTextIcon size={16} className="shrink-0 text-ink-3" />;
  return <Favicon src={b.favicon} size={16} />;
}

function StatusIcons({ b }: { b: Bookmark }) {
  return (
    <>
      {b.fetchStatus === 'pending' && <Spinner size={12} />}
      {b.broken && (
        <span title="This link appears to be broken">
          <GhostIcon size={13} className="text-danger" />
        </span>
      )}
      {b.favorite && <HeartIcon size={12} weight="fill" className="text-[#e5484d]" />}
    </>
  );
}

function Meta({ b, collection }: ItemProps) {
  const parts: ReactNode[] = [];
  if (collection) {
    parts.push(
      <span key="c" className="flex min-w-0 items-center gap-1">
        <CollectionIcon collection={collection} size={13} />
        <span className="truncate">{collection.name}</span>
      </span>,
    );
  }
  parts.push(
    <span key="s" className="flex min-w-0 items-center gap-1">
      {b.type === 'note' ? <NoteIcon size={12} className="text-[#e2a336]" /> : <Favicon src={b.favicon} size={13} />}
      <span className="truncate">{b.type === 'note' ? 'Note' : b.file ? b.file.name : b.site}</span>
    </span>,
  );
  parts.push(
    <span key="d" className="shrink-0 tabular-nums">
      {shortDate(b.createdAt)}
    </span>,
  );
  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.78rem] text-ink-3">
      {b.tags.map((t) => (
        <span key={t} className="text-accent">
          #{t}
        </span>
      ))}
      <span className="flex max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap">
        {parts.map((p, i) => (
          <span key={i} className={cn('flex items-center gap-1.5', i === parts.length - 1 ? 'shrink-0' : 'min-w-0')}>
            {i > 0 && <span className="text-ink-3/60">·</span>}
            {p}
          </span>
        ))}
        <StatusIcons b={b} />
      </span>
    </div>
  );
}

function SelectBox({ selected, selecting, onClick, className }: { selected: boolean; selecting: boolean; onClick: (e: MouseEvent) => void; className?: string }) {
  return (
    <button
      role="checkbox"
      aria-checked={selected}
      aria-label="Select"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        'absolute z-[2] flex size-[1.05rem] items-center justify-center rounded border transition-opacity',
        selected ? 'border-accent bg-accent text-accent-ink' : 'border-ink-3/60 bg-surface',
        selected || selecting ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover/item:pointer-events-auto group-hover/item:opacity-100',
        className,
      )}
    >
      {selected && <CheckIcon size={12} weight="bold" />}
    </button>
  );
}

function Actions({ b, className }: { b: Bookmark; className?: string }) {
  const { setPanel, openDialog } = useUI();
  const update = useUpdateBookmark();
  const bulk = useBulk();
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  const btn = 'flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink';

  const content = b.deletedAt ? (
    <>
      <button
        className={btn}
        title="Restore"
        onClick={stop(() => bulk.mutate({ ids: [b.id], action: 'restore' }, { onSuccess: () => toast('Restored'), onError: toastError }))}
      >
        <ArrowCounterClockwiseIcon size={15} />
      </button>
      <button
        className={cn(btn, 'hover:text-danger')}
        title="Delete permanently"
        onClick={stop(() =>
          openDialog(
            <ConfirmDialog
              title="Delete permanently?"
              message="This bookmark will be gone for good."
              confirmLabel="Delete"
              onConfirm={() => bulk.mutateAsync({ ids: [b.id], action: 'delete' })}
            />,
          ),
        )}
      >
        <TrashIcon size={15} />
      </button>
    </>
  ) : (
    <>
      {canPreview(b) && (
        <button className={btn} title="Preview" onClick={stop(() => setPanel({ kind: 'preview', id: b.id }))}>
          <EyeIcon size={15} />
        </button>
      )}
      <button className={btn} title="Edit" onClick={stop(() => setPanel({ kind: 'edit', id: b.id }))}>
        <PencilSimpleIcon size={15} />
      </button>
      <button
        className={cn(btn, b.favorite && 'text-[#e5484d] hover:text-[#e5484d]')}
        title={b.favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={stop(() => update.mutate({ id: b.id, patch: { favorite: !b.favorite } }, { onError: toastError }))}
      >
        <HeartIcon size={15} weight={b.favorite ? 'fill' : 'regular'} />
      </button>
      <button
        className={cn(btn, 'hover:text-danger')}
        title="Move to Trash"
        onClick={stop(() =>
          bulk.mutate(
            { ids: [b.id], action: 'trash' },
            {
              onSuccess: () => toast('Moved to Trash', { action: { label: 'Undo', onClick: () => bulk.mutate({ ids: [b.id], action: 'restore' }) } }),
              onError: toastError,
            },
          ),
        )}
      >
        <TrashIcon size={15} />
      </button>
    </>
  );

  return (
    <div
      className={cn(
        'shadow-pop absolute z-[3] hidden items-center rounded-lg border border-line bg-elevated p-0.5 group-hover/item:flex',
        className,
      )}
    >
      {content}
    </div>
  );
}
