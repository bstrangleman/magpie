import {
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  EyeIcon,
  HeartIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Bookmark } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { qk, useBookmark, useBulk, useRefresh, useUpdateBookmark } from '../lib/queries.ts';
import { cn, formatBytes, longDate } from '../lib/utils.ts';
import { canPreview } from './BookmarkItem.tsx';
import { Favicon, TagInput } from './common.tsx';
import { CollectionSelect } from './dialogs.tsx';
import { toast, toastError } from './toast.tsx';
import { AutoTextarea, Field, IconButton, Input, Spinner } from './ui.tsx';
import { useUI } from './ui-context.tsx';

export function PanelShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  const { setPanel } = useUI();
  return (
    <>
      <div className="animate-fade fixed inset-0 z-20 bg-black/25 lg:hidden" onClick={() => setPanel(null)} />
      <aside
        className={cn(
          'animate-slide fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-line bg-surface shadow-2xl lg:static lg:z-auto lg:shadow-none',
          wide ? 'sm:w-[min(46rem,100vw)] lg:w-[min(46rem,52vw)]' : 'sm:w-[26rem]',
        )}
      >
        {children}
      </aside>
    </>
  );
}

export function BookmarkPanel({ id }: { id: number }) {
  const { setPanel } = useUI();
  const { data: b, isLoading, error } = useBookmark(id);

  return (
    <PanelShell>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line pr-2 pl-4">
        <h2 className="flex-1 text-[0.95rem] font-semibold">{b?.type === 'note' ? 'Edit note' : 'Edit bookmark'}</h2>
        {b && <PanelActions b={b} />}
        <IconButton icon={XIcon} label="Close" size={18} onClick={() => setPanel(null)} />
      </div>
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : error || !b ? (
        <p className="p-4 text-sm text-ink-2">This bookmark no longer exists.</p>
      ) : (
        <EditForm key={b.id} b={b} />
      )}
    </PanelShell>
  );
}

function PanelActions({ b }: { b: Bookmark }) {
  const { setPanel } = useUI();
  const update = useUpdateBookmark();
  const bulk = useBulk();
  if (b.deletedAt) {
    return (
      <IconButton
        icon={ArrowCounterClockwiseIcon}
        label="Restore"
        onClick={() => bulk.mutate({ ids: [b.id], action: 'restore' }, { onSuccess: () => toast('Restored'), onError: toastError })}
      />
    );
  }
  return (
    <>
      {canPreview(b) && <IconButton icon={EyeIcon} label="Preview" onClick={() => setPanel({ kind: 'preview', id: b.id })} />}
      {(b.url || b.file) && (
        <a href={b.url ?? b.file!.url} target="_blank" rel="noopener noreferrer" title="Open" className="flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
          <ArrowSquareOutIcon size={16} />
        </a>
      )}
      <IconButton
        icon={HeartIcon}
        label={b.favorite ? 'Remove from favorites' : 'Add to favorites'}
        active={b.favorite}
        filled={b.favorite}
        onClick={() => update.mutate({ id: b.id, patch: { favorite: !b.favorite } }, { onError: toastError })}
      />
      <IconButton
        icon={TrashIcon}
        label="Move to Trash"
        onClick={() =>
          bulk.mutate(
            { ids: [b.id], action: 'trash' },
            {
              onSuccess: () => {
                setPanel(null);
                toast('Moved to Trash', { action: { label: 'Undo', onClick: () => bulk.mutate({ ids: [b.id], action: 'restore' }) } });
              },
              onError: toastError,
            },
          )
        }
      />
    </>
  );
}

function EditForm({ b }: { b: Bookmark }) {
  const qc = useQueryClient();
  const update = useUpdateBookmark();
  const refresh = useRefresh();
  const [title, setTitle] = useState(b.title);
  const [description, setDescription] = useState(b.description);
  const [note, setNote] = useState(b.note);
  const [url, setUrl] = useState(b.url ?? '');

  // Pick up fields filled in by the metadata fetcher, unless the user is editing them.
  useEffect(() => {
    if (document.activeElement?.getAttribute('name') !== 'title') setTitle(b.title);
    if (document.activeElement?.getAttribute('name') !== 'description') setDescription(b.description);
  }, [b.title, b.description]);

  const save = (patch: Partial<Bookmark>) => update.mutate({ id: b.id, patch }, { onError: toastError });
  const saveIfChanged = <K extends 'title' | 'description' | 'note'>(key: K, value: string) => {
    if (value !== b[key]) save({ [key]: value });
  };

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      {b.cover && (
        <div className="group relative overflow-hidden rounded-lg border border-line bg-field">
          <img src={b.cover} alt="" referrerPolicy="no-referrer" className="max-h-52 w-full object-cover" />
          {!b.file && (
            <button
              onClick={() => save({ coverUrl: null } as Partial<Bookmark>)}
              className="absolute top-2 right-2 hidden rounded-md bg-black/60 px-2 py-1 text-xs text-white group-hover:block"
            >
              Remove cover
            </button>
          )}
        </div>
      )}

      <Field label="Title">
        <AutoTextarea
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => saveIfChanged('title', title)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
          placeholder={b.fetchStatus === 'pending' ? 'Fetching title…' : 'Title'}
          className="font-semibold"
        />
      </Field>

      {b.type !== 'note' && (
        <Field label="Description">
          <AutoTextarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => saveIfChanged('description', description)}
            placeholder="Add a description"
            className="text-ink-2"
          />
        </Field>
      )}

      <Field label="Note" hint="Markdown is supported.">
        <AutoTextarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => saveIfChanged('note', note)}
          placeholder="Your notes about this bookmark"
          className={cn('leading-relaxed', b.type === 'note' ? 'min-h-48' : 'min-h-20')}
        />
      </Field>

      <Field label="Collection">
        <CollectionSelect value={b.collectionId} onChange={(collectionId) => save({ collectionId })} />
      </Field>

      <Field label="Tags">
        <TagInput value={b.tags} onChange={(tags) => save({ tags })} />
      </Field>

      {!b.file && (
        <Field label="URL">
          <div className="flex items-center gap-2">
            {b.url && <Favicon src={b.favicon} size={16} />}
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => url.trim() && url.trim() !== b.url && save({ url: url.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              placeholder="https://"
              className="text-ink-2"
            />
          </div>
        </Field>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-4 text-[0.8rem]">
        <dt className="text-ink-3">Added</dt>
        <dd>{longDate(b.createdAt)}</dd>
        <dt className="text-ink-3">Type</dt>
        <dd className="capitalize">{b.type}</dd>
        {b.file && (
          <>
            <dt className="text-ink-3">File</dt>
            <dd className="truncate">
              {b.file.name} · {formatBytes(b.file.size)}
            </dd>
          </>
        )}
        {b.url && (
          <>
            <dt className="text-ink-3">Metadata</dt>
            <dd className="flex items-center gap-2">
              {b.fetchStatus === 'pending' ? (
                <>
                  <Spinner size={12} /> Fetching…
                </>
              ) : (
                <>
                  <span className={cn(b.fetchStatus === 'failed' && 'text-danger')}>
                    {{ done: 'Fetched', failed: b.broken ? 'Broken link' : 'Couldn’t fetch page', skipped: 'Skipped (private address)', pending: '' }[b.fetchStatus]}
                  </span>
                  <button
                    className="flex items-center gap-1 text-accent hover:underline"
                    onClick={() =>
                      api.post<Bookmark>(`/bookmarks/${b.id}/refetch`).then((fresh) => {
                        // Now "pending", so the panel shows progress and polls until the fetch is done.
                        qc.setQueryData(qk.bookmark(b.id), fresh);
                        refresh();
                        toast('Refreshing metadata…');
                      }, toastError)
                    }
                  >
                    <ArrowsClockwiseIcon size={12} /> Refresh
                  </button>
                </>
              )}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
