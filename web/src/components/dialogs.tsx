import { useQueryClient } from '@tanstack/react-query';
import { CaretDownIcon, MagnifyingGlassIcon, UploadSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PHOSPHOR_PREFIX, phosphorName, type Bookmark, type Collection } from '../../../shared/types.ts';
import { api, errorMessage } from '../lib/api.ts';
import { searchPhosphor, usePhosphor } from '../lib/phosphor.ts';
import { qk, useCollections, useRefresh } from '../lib/queries.ts';
import { cn, formatBytes } from '../lib/utils.ts';
import { CollectionIcon, CollectionPicker, TagInput } from './common.tsx';
import { toast } from './toast.tsx';
import { AutoTextarea, Button, ErrorText, Field, Input, Modal, Popover, Spinner } from './ui.tsx';
import { useUI } from './ui-context.tsx';

/** Button that opens a collection picker. */
export function CollectionSelect({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const collections = useCollections();
  const current = collections.find((c) => c.id === value);
  return (
    <Popover
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className="flex h-[2.1rem] w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-left text-sm hover:bg-hover"
        >
          {current ? <CollectionIcon collection={current} size={16} /> : <span className="text-base leading-none">📥</span>}
          <span className="flex-1 truncate">{current?.name ?? 'Unsorted'}</span>
          <CaretDownIcon size={14} className="text-ink-3" />
        </button>
      )}
    >
      {(close) => (
        <CollectionPicker
          value={value}
          onPick={(id) => {
            onChange(id);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function useDefaultCollection(): number | null {
  const { view } = useUI();
  return view.kind === 'collection' ? view.id : null;
}

export function AddLinkDialog({ initialUrl = '' }: { initialUrl?: string }) {
  const { closeDialog, setPanel } = useUI();
  const refresh = useRefresh();
  const collections = useCollections();
  const [url, setUrl] = useState(initialUrl);
  const [collectionId, setCollectionId] = useState(useDefaultCollection());
  const [tags, setTags] = useState<string[]>([]);
  const [existing, setExisting] = useState<Bookmark | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError('');
    try {
      if (!existing) {
        const { bookmark } = await api.get<{ bookmark: Bookmark | null }>(`/bookmarks/lookup?url=${encodeURIComponent(url.trim())}`);
        if (bookmark) {
          setExisting(bookmark);
          return;
        }
      }
      const b = await api.post<Bookmark>('/bookmarks', { url: url.trim(), collectionId, tags });
      refresh();
      closeDialog();
      setPanel({ kind: 'edit', id: b.id });
      toast('Bookmark saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const existingIn = existing && (collections.find((c) => c.id === existing.collectionId)?.name ?? 'Unsorted');
  return (
    <Modal
      title="Add bookmark"
      onClose={closeDialog}
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-link" loading={busy}>
            {existing ? 'Save anyway' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="add-link" onSubmit={submit} className="space-y-3">
        <Field label="URL">
          <Input
            autoFocus
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setExisting(null);
            }}
            placeholder="https://"
            inputMode="url"
            autoComplete="off"
          />
        </Field>
        {existing && (
          <div className="flex items-start gap-2 rounded-md bg-accent-soft px-3 py-2 text-sm">
            <WarningCircleIcon size={16} className="mt-0.5 shrink-0 text-accent" />
            <div className="flex-1">
              Already saved in <b>{existingIn}</b>.{' '}
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() => {
                  closeDialog();
                  setPanel({ kind: 'edit', id: existing.id });
                }}
              >
                Open it
              </button>
            </div>
          </div>
        )}
        <Field label="Collection">
          <CollectionSelect value={collectionId} onChange={setCollectionId} />
        </Field>
        <Field label="Tags">
          <TagInput value={tags} onChange={setTags} />
        </Field>
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}

export function NoteDialog() {
  const { closeDialog, setPanel } = useUI();
  const refresh = useRefresh();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [collectionId, setCollectionId] = useState(useDefaultCollection());
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const b = await api.post<Bookmark>('/bookmarks', { title, note, collectionId, tags });
      refresh();
      closeDialog();
      setPanel({ kind: 'preview', id: b.id });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New note"
      onClose={closeDialog}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-note" loading={busy} disabled={!note.trim()}>
            Save note
          </Button>
        </>
      }
    >
      <form id="add-note" onSubmit={submit} className="space-y-3">
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
        <AutoTextarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Write something… Markdown is supported."
          className="min-h-40 font-[inherit] leading-relaxed"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Collection">
            <CollectionSelect value={collectionId} onChange={setCollectionId} />
          </Field>
          <Field label="Tags">
            <TagInput value={tags} onChange={setTags} />
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}

export function UploadDialog({ initialFiles = [] }: { initialFiles?: File[] }) {
  const { closeDialog } = useUI();
  const refresh = useRefresh();
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [collectionId, setCollectionId] = useState(useDefaultCollection());
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const upload = async () => {
    setBusy(true);
    setError('');
    const failed: File[] = [];
    const errors: string[] = [];
    for (const file of files) {
      const form = new FormData();
      form.set('file', file);
      if (collectionId) form.set('collectionId', String(collectionId));
      try {
        await api.post('/bookmarks/upload', form);
      } catch (err) {
        failed.push(file);
        errors.push(`${file.name}: ${errorMessage(err)}`);
      }
    }
    const done = files.length - failed.length;
    setBusy(false);
    refresh();
    if (done) toast(`Uploaded ${done} file${done === 1 ? '' : 's'}`);
    if (!failed.length) return closeDialog();
    // Keep only the files that failed, so trying again doesn't upload the others twice.
    setFiles(failed);
    setError(errors.join('\n'));
  };

  return (
    <Modal
      title="Upload files"
      onClose={closeDialog}
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="primary" onClick={upload} loading={busy} disabled={!files.length}>
            Upload {files.length > 1 ? `${files.length} files` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            setFiles([...files, ...e.dataTransfer.files]);
          }}
          className={cn(
            'flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line px-4 py-8 text-sm text-ink-2 hover:bg-hover',
            dragging && 'border-accent bg-accent-soft',
          )}
        >
          <UploadSimpleIcon size={22} className="text-ink-3" />
          Drop images, PDFs or other files here, or click to choose
        </button>
        <input ref={input} type="file" multiple hidden onChange={(e) => setFiles([...files, ...(e.target.files ?? [])])} />
        {files.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {files.map((f, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-ink-3">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        )}
        <Field label="Collection">
          <CollectionSelect value={collectionId} onChange={setCollectionId} />
        </Field>
        <ErrorText>{error}</ErrorText>
      </div>
    </Modal>
  );
}

/** Common choices, shown first; the rest of the Phosphor set follows A–Z. */
const SUGGESTED_ICONS = (
  'folder folder-star bookmark-simple books book-open notebook note push-pin star heart lightbulb fire sparkle target ' +
  'rocket-launch code laptop device-mobile wrench gear flask robot brain palette paint-brush camera film-slate television ' +
  'music-notes headphones game-controller basketball barbell heartbeat cooking-pot hamburger coffee wine shopping-cart ' +
  'shopping-bag money chart-line-up bank house tree plant dog cat airplane globe-hemisphere-west map-trifold umbrella ' +
  'mountains car newspaper briefcase buildings graduation-cap receipt puzzle-piece lock key chat-circle megaphone gift ' +
  'baby dna package floppy-disk'
).split(' ');

const iconCell = (selected: boolean) =>
  cn('flex aspect-square items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink', selected && 'bg-accent-soft text-ink ring-1 ring-accent');

/** Pick a collection icon: the default folder, or any Phosphor icon, searchable by name and tags. */
function IconPicker({ value, color, onChange }: { value: string | null; color: string | null; onChange: (icon: string | null) => void }) {
  const icons = usePhosphor();
  const [query, setQuery] = useState('');
  const searching = !!query.trim();
  const results = useMemo(() => {
    if (!icons) return [];
    if (searching) return searchPhosphor(icons.values(), query);
    const first = SUGGESTED_ICONS.flatMap((name) => icons.get(name) ?? []);
    return [...first, ...[...icons.values()].filter((icon) => !SUGGESTED_ICONS.includes(icon.name))];
  }, [icons, query, searching]);
  // Collections made before Phosphor icons (or imported) may have an emoji: keep it selectable.
  const emoji = value && !phosphorName(value) ? value : null;
  const selected = phosphorName(value);

  return (
    <div className="overflow-hidden rounded-md border border-line">
      <label className="flex items-center gap-2 border-b border-line px-2.5">
        <MagnifyingGlassIcon size={14} className="shrink-0 text-ink-3" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter picks the best match instead of submitting the form.
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (searching && results[0]) onChange(PHOSPHOR_PREFIX + results[0].name);
          }}
          placeholder={icons ? `Search ${icons.size.toLocaleString()} icons by name` : 'Search icons by name'}
          aria-label="Search icons"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
        />
      </label>
      {/* A fixed height, so the dialog doesn't jump about as results narrow. */}
      <div className="grid h-44 auto-rows-min grid-cols-10 gap-0.5 overflow-y-auto p-1">
        {!searching && (
          <button type="button" title="Default folder" aria-label="Default folder" onClick={() => onChange(null)} className={iconCell(!value)}>
            <CollectionIcon collection={{ icon: null, color }} size={17} />
          </button>
        )}
        {!searching && emoji && (
          <button type="button" title="Current emoji" onClick={() => onChange(emoji)} className={cn(iconCell(true), 'text-lg')}>
            {emoji}
          </button>
        )}
        {results.map((icon) => (
          <button
            type="button"
            key={icon.name}
            title={icon.name}
            aria-label={icon.name}
            aria-pressed={selected === icon.name}
            onClick={() => onChange(PHOSPHOR_PREFIX + icon.name)}
            className={iconCell(selected === icon.name)}
          >
            <svg viewBox="0 0 256 256" width={18} height={18} fill="currentColor" aria-hidden>
              <path d={icon.d} />
            </svg>
          </button>
        ))}
        {!icons && (
          <div className="col-span-full flex justify-center py-4">
            <Spinner />
          </div>
        )}
        {icons && searching && !results.length && <p className="col-span-full px-2 py-3 text-sm text-ink-3">No icons match “{query.trim()}”.</p>}
      </div>
    </div>
  );
}

export const COLORS = ['#64748b', '#3a7bd5', '#0ea5e9', '#14b8a6', '#22a35a', '#84cc16', '#d4a017', '#f97316', '#e5484d', '#ec4899', '#a855f7', '#8b5e3c'];

export function CollectionDialog({
  collection,
  parentId = null,
  groupId = null,
}: {
  collection?: Collection;
  parentId?: number | null;
  groupId?: number | null;
}) {
  const { closeDialog } = useUI();
  const qc = useQueryClient();
  const [name, setName] = useState(collection?.name ?? '');
  const [icon, setIcon] = useState<string | null>(collection?.icon ?? null);
  const [color, setColor] = useState<string | null>(collection?.color ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const collections = useCollections();
  const parent = collections.find((c) => c.id === parentId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (collection) await api.patch(`/collections/${collection.id}`, { name, icon, color });
      else await api.post('/collections', { name, icon, color, parentId, groupId });
      qc.invalidateQueries({ queryKey: qk.sidebar });
      closeDialog();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={collection ? 'Edit collection' : parent ? `New collection in ${parent.name}` : 'New collection'}
      onClose={closeDialog}
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="collection" loading={busy} disabled={!name.trim()}>
            {collection ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form id="collection" onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex size-[2.1rem] items-center justify-center rounded-md border border-line">
            <CollectionIcon collection={{ icon, color }} size={20} />
          </span>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Collection name" />
        </div>
        <Field label="Icon">
          <IconPicker value={icon} color={color} onChange={setIcon} />
        </Field>
        <Field label="Colour" hint="Tints the icon, and the accent colour while you're in this collection.">
          <div className="flex flex-wrap gap-1.5">
            <Swatch selected={!color} onClick={() => setColor(null)} title="Default">
              <span className="size-full rounded-full border border-line bg-[linear-gradient(135deg,transparent_45%,var(--danger)_45%,var(--danger)_55%,transparent_55%)]" />
            </Swatch>
            {COLORS.map((c) => (
              <Swatch key={c} selected={color === c} onClick={() => setColor(c)} title={c}>
                <span className="size-full rounded-full" style={{ background: c }} />
              </Swatch>
            ))}
          </div>
        </Field>
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}

function Swatch({ selected, onClick, title, children }: { selected: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn('flex size-7 items-center justify-center rounded-full p-1', selected && 'ring-2 ring-accent')}
    >
      {children}
    </button>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = true,
  onConfirm,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | void;
}) {
  const { closeDialog } = useUI();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title={title}
      onClose={closeDialog}
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            autoFocus
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                closeDialog();
              } catch (err) {
                setError(errorMessage(err));
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-2">{message}</div>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}

export function PromptDialog({
  title,
  label,
  initial = '',
  confirmLabel = 'Save',
  onSubmit,
}: {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => Promise<unknown>;
}) {
  const { closeDialog } = useUI();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(value.trim());
      closeDialog();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={closeDialog}
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="prompt" loading={busy} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="prompt" onSubmit={submit}>
        <Field label={label}>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
        </Field>
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}

/** Delete a collection (its bookmarks go to the Trash), then refresh everything that showed them. */
export function DeleteCollectionDialog({ collection, onDeleted }: { collection: Collection; onDeleted: () => void }) {
  const qc = useQueryClient();
  return (
    <ConfirmDialog
      title={`Delete “${collection.name}”?`}
      message="The collection and any nested collections will be removed. Their bookmarks move to the Trash, where you can restore them."
      confirmLabel="Delete collection"
      onConfirm={async () => {
        try {
          await api.del(`/collections/${collection.id}`);
        } catch (err) {
          throw new Error(errorMessage(err));
        }
        onDeleted();
        qc.invalidateQueries({ queryKey: qk.sidebar });
        qc.invalidateQueries({ queryKey: qk.bookmarks });
      }}
    />
  );
}
