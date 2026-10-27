import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  ArrowsDownUpIcon,
  CheckSquareIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HashIcon,
  HeartIcon,
  LayoutIcon,
  ListIcon,
  PencilSimpleIcon,
  PlusIcon,
  RowsIcon,
  SquaresFourIcon,
  TrashIcon,
  UploadSimpleIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Bookmark, BookmarkPage, Sort, ViewMode } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { dnd, dropZone } from '../lib/dnd.ts';
import { qk, useBookmarkList, useBulk, useRefresh, useSidebar, useViewPrefs } from '../lib/queries.ts';
import { cn, collectionPath, plural } from '../lib/utils.ts';
import { canSortManually, FILTER_META, listQuery, SORT_LABELS, SYSTEM_VIEWS, type View } from '../lib/view.ts';
import { BookmarkItem } from './BookmarkItem.tsx';
import { CollectionIcon, CollectionPicker, TagInput } from './common.tsx';
import { AddLinkDialog, CollectionDialog, ConfirmDialog, DeleteCollectionDialog, UploadDialog } from './dialogs.tsx';
import { toast, toastError } from './toast.tsx';
import { Button, IconButton, MenuItem, MenuLabel, MenuSeparator, Popover, Spinner } from './ui.tsx';
import { useUI } from './ui-context.tsx';

const VIEW_MODES: { value: ViewMode; label: string; icon: Icon }[] = [
  { value: 'list', label: 'List', icon: ListIcon },
  { value: 'cards', label: 'Cards', icon: SquaresFourIcon },
  { value: 'headlines', label: 'Headlines', icon: RowsIcon },
  { value: 'moodboard', label: 'Moodboard', icon: LayoutIcon },
];

export function BookmarkList() {
  const { view, q, panel, openDialog } = useUI();
  const searching = !!q.trim();
  const prefs = useViewPrefs(view, searching);
  const list = useBookmarkList(view, q, prefs.sort);
  const { data: sidebar } = useSidebar();
  const qc = useQueryClient();
  const bulk = useBulk();
  const refresh = useRefresh();

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const collectionsById = useMemo(() => new Map(sidebar?.collections.map((c) => [c.id, c])), [sidebar]);
  const canReorder = prefs.sort === 'manual' && canSortManually(view) && !searching;

  // --- Selection -------------------------------------------------------------
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selecting, setSelecting] = useState(false);
  // After "select all": every matching id in list order, including ones not loaded yet.
  const [allIds, setAllIds] = useState<number[] | null>(null);
  const anchor = useRef<number | null>(null);
  const clearSelection = () => {
    setSelected(new Set());
    setSelecting(false);
    setAllIds(null);
  };
  useEffect(clearSelection, [view, q]);
  useEffect(() => {
    // Drop ids that are no longer listed (moved, deleted…).
    setSelected((s) => {
      const ids = new Set(allIds ?? items.map((b) => b.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [items, allIds]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !panel && !document.querySelector('[role=dialog]')) clearSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel]);

  const toggle = (id: number, e: MouseEvent) => {
    setSelecting(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && anchor.current !== null) {
        const a = items.findIndex((b) => b.id === anchor.current);
        const b = items.findIndex((x) => x.id === id);
        if (a !== -1 && b !== -1) {
          for (const x of items.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x.id);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      anchor.current = id;
      return next;
    });
  };

  const selectAll = async () => {
    try {
      const { ids } = await api.get<{ ids: number[] }>(`/bookmarks/ids?${listQuery(view, q, prefs.sort)}`);
      setAllIds(ids);
      setSelected(new Set(ids));
      setSelecting(true);
    } catch (err) {
      toastError(err);
    }
  };

  // --- Infinite scroll --------------------------------------------------------
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage(),
      { root: scroller.current, rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [view, q, prefs.sort]);

  // --- Drag & drop --------------------------------------------------------------
  const [dropTarget, setDropTarget] = useState<{ id: number; zone: 'before' | 'after' } | null>(null);
  const [externalDrag, setExternalDrag] = useState(false);
  const queryKey = qk.list(listQuery(view, q, prefs.sort));

  const reorder = async (dragId: number, targetId: number, zone: 'before' | 'after') => {
    const ids = items.map((b) => b.id).filter((id) => id !== dragId);
    const at = ids.indexOf(targetId) + (zone === 'after' ? 1 : 0);
    const prevId = ids[at - 1] ?? null;
    const nextId = ids[at] ?? null;
    qc.setQueryData<InfiniteData<BookmarkPage>>(queryKey, (data) => {
      if (!data) return data;
      const flat = data.pages.flatMap((p) => p.items);
      const moving = flat.find((b) => b.id === dragId);
      if (!moving) return data;
      const rest = flat.filter((b) => b.id !== dragId);
      rest.splice(at, 0, moving);
      let i = 0;
      return { ...data, pages: data.pages.map((p) => ({ ...p, items: rest.slice(i, (i += p.items.length)) })) };
    });
    try {
      await api.post(`/bookmarks/${dragId}/reorder`, { prevId, nextId });
    } catch (err) {
      toastError(err);
    }
    qc.invalidateQueries({ queryKey });
  };

  const itemDragProps = (b: Bookmark) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      dnd.start(e, { type: 'bookmarks', ids: selected.has(b.id) ? selectedIds : [b.id] });
      if (b.url) e.dataTransfer.setData('text/uri-list', b.url);
      e.dataTransfer.setData('text/plain', b.url ?? b.title);
    },
    onDragEnd: () => {
      dnd.end();
      setDropTarget(null);
    },
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      const p = dnd.get();
      if (!canReorder || p?.type !== 'bookmarks' || p.ids.length !== 1 || p.ids[0] === b.id) return;
      e.preventDefault();
      e.stopPropagation();
      const zone = dropZone(e, e.currentTarget, false, prefs.mode === 'cards' || prefs.mode === 'moodboard' ? 'x' : 'y') as 'before' | 'after';
      if (dropTarget?.id !== b.id || dropTarget.zone !== zone) setDropTarget({ id: b.id, zone });
    },
    onDrop: (e: React.DragEvent) => {
      const p = dnd.get();
      if (!dropTarget || p?.type !== 'bookmarks') return;
      e.preventDefault();
      e.stopPropagation();
      reorder(p.ids[0]!, dropTarget.id, dropTarget.zone);
      setDropTarget(null);
      dnd.end();
    },
  });

  // Links or files dragged in from outside the app.
  const isExternal = (e: React.DragEvent) => !dnd.get() && (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('Files'));
  const onExternalDrop = async (e: React.DragEvent) => {
    if (!isExternal(e)) return;
    e.preventDefault();
    setExternalDrag(false);
    if (e.dataTransfer.files.length) {
      openDialog(<UploadDialog initialFiles={[...e.dataTransfer.files]} />);
      return;
    }
    const urls = e.dataTransfer
      .getData('text/uri-list')
      .split(/\r?\n/)
      .filter((u) => u && !u.startsWith('#'));
    for (const url of urls) {
      try {
        await api.post('/bookmarks', { url, collectionId: view.kind === 'collection' ? view.id : null });
      } catch (err) {
        toastError(err);
      }
    }
    if (urls.length) toast(`Saved ${plural(urls.length, 'bookmark')}`);
    refresh();
  };

  const inTrash = view.kind === 'trash';
  const children = view.kind === 'collection' && !searching ? (sidebar?.collections ?? []).filter((c) => c.parentId === view.id) : [];
  const selectedIds = (allIds ?? items.map((b) => b.id)).filter((id) => selected.has(id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selecting || selected.size ? (
        <SelectionBar
          ids={selectedIds}
          total={total}
          inTrash={inTrash}
          onSelectAll={selectAll}
          onClear={clearSelection}
          run={(action, done) =>
            bulk.mutate({ ids: selectedIds, ...action } as Parameters<typeof bulk.mutate>[0], {
              onSuccess: () => {
                toast(done);
                if (action.action !== 'favorite' && action.action !== 'addTags' && action.action !== 'removeTags' && action.action !== 'refetch') clearSelection();
              },
              onError: toastError,
            })
          }
        />
      ) : (
        <Header view={view} prefs={prefs} searching={searching} total={total} loading={list.isLoading} onSelect={() => setSelecting(true)} />
      )}

      <div
        ref={scroller}
        className={cn('relative flex-1 overflow-y-auto', externalDrag && 'bg-accent-soft')}
        onDragOver={(e) => {
          if (!isExternal(e)) return;
          e.preventDefault();
          setExternalDrag(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setExternalDrag(false)}
        onDrop={onExternalDrop}
      >
        {children.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1 md:px-5">
            {children.map((c) => (
              <Link
                key={c.id}
                to={`/collection/${c.id}`}
                className="flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-sm hover:bg-hover"
              >
                <CollectionIcon collection={c} size={16} />
                {c.name}
                {c.count > 0 && <span className="text-xs text-ink-3">{c.count}</span>}
              </Link>
            ))}
          </div>
        )}

        {list.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={22} />
          </div>
        ) : list.isError ? (
          <Empty title="Couldn't load bookmarks" body={(list.error as Error).message} />
        ) : items.length === 0 ? (
          <EmptyState view={view} q={q} />
        ) : (
          <div
            className={cn(
              prefs.mode === 'cards' && 'grid grid-cols-[repeat(auto-fill,minmax(14.5rem,1fr))] gap-3 p-4 md:px-5',
              prefs.mode === 'moodboard' && 'columns-[14rem] gap-3 p-4 md:px-5',
              (prefs.mode === 'list' || prefs.mode === 'headlines') && 'md:px-1',
            )}
          >
            {items.map((b) => (
              <BookmarkItem
                key={b.id}
                b={b}
                mode={prefs.mode}
                selected={selected.has(b.id)}
                selecting={selecting || selected.size > 0}
                active={panel?.id === b.id}
                collection={view.kind !== 'collection' && b.collectionId ? collectionsById.get(b.collectionId) : undefined}
                onToggleSelect={(e) => toggle(b.id, e)}
                dropIndicator={dropTarget?.id === b.id ? dropTarget.zone : null}
                dragProps={itemDragProps(b)}
              />
            ))}
          </div>
        )}

        <div ref={sentinel} className="h-px" />
        {list.isFetchingNextPage && (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        )}
        {items.length > 0 && !list.hasNextPage && (
          <p className="py-5 text-center text-[0.8rem] text-ink-3">{plural(total, searching ? 'result' : 'bookmark')}</p>
        )}
      </div>
    </div>
  );
}

function viewTitle(view: View, sidebarName?: string): { icon: ReactNode; title: string } {
  switch (view.kind) {
    case 'collection':
      return { icon: null, title: sidebarName ?? 'Collection' };
    case 'filter': {
      const m = FILTER_META[view.filter];
      return { icon: <m.icon size={20} style={{ color: m.color }} />, title: m.label };
    }
    case 'tag':
      return { icon: <HashIcon size={20} className="text-ink-3" />, title: view.tag };
    default: {
      const s = SYSTEM_VIEWS.find((x) => x.kind === view.kind)!;
      return { icon: <s.icon size={20} className="text-ink-2" />, title: s.label };
    }
  }
}

function Header({
  view,
  prefs,
  searching,
  total,
  loading,
  onSelect,
}: {
  view: View;
  prefs: ReturnType<typeof useViewPrefs>;
  searching: boolean;
  total: number;
  loading: boolean;
  onSelect: () => void;
}) {
  const { openDialog } = useUI();
  const { data: sidebar } = useSidebar();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const collections = sidebar?.collections ?? [];
  const collection = view.kind === 'collection' ? collections.find((c) => c.id === view.id) : undefined;
  const path = collection ? collectionPath(collections, collection.id).slice(0, -1) : [];
  const { icon, title } = viewTitle(view, collection?.name);
  const modeMeta = VIEW_MODES.find((m) => m.value === prefs.mode)!;

  const sorts: Sort[] = [
    ...(searching ? (['relevance'] as Sort[]) : []),
    ...(canSortManually(view) && !searching ? (['manual'] as Sort[]) : []),
    '-created',
    'created',
    'title',
    '-title',
    'site',
    '-site',
  ];
  const exportQuery = collection ? `&collection=${collection.id}` : '';

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line pr-2 pl-4 md:pr-3 md:pl-5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {collection ? <CollectionIcon collection={collection} size={21} /> : icon}
        <h1 className="flex min-w-0 items-baseline gap-1 text-[1.07rem] font-semibold">
          {path.map((p) => (
            <Link key={p.id} to={`/collection/${p.id}`} className="hidden shrink-0 font-normal text-ink-3 hover:text-ink-2 lg:inline">
              {p.name} /
            </Link>
          ))}
          <span className="truncate">{title}</span>
        </h1>
        {searching && !loading && <span className="shrink-0 text-sm text-ink-3">· {plural(total, 'result')}</span>}
      </div>

      {view.kind !== 'trash' && (
        <Popover
          align="end"
          trigger={(p) => (
            <Button {...p} variant="ghost" size="sm" icon={ArrowsDownUpIcon} className="max-sm:hidden">
              {SORT_LABELS[prefs.sort].replace(/ \(.*|\s[↑↓]/, '')}
            </Button>
          )}
        >
          {(close) => (
            <>
              <MenuLabel>Sort by</MenuLabel>
              {sorts.map((s) => (
                <MenuItem key={s} checked={prefs.sort === s} onClick={() => (prefs.setSort(s), close())}>
                  {s === 'manual' ? 'Manual (drag & drop)' : SORT_LABELS[s]}
                </MenuItem>
              ))}
            </>
          )}
        </Popover>
      )}
      <Popover
        align="end"
        trigger={(p) => (
          <Button {...p} variant="ghost" size="sm" icon={modeMeta.icon}>
            <span className="hidden sm:inline">{modeMeta.label}</span>
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>View</MenuLabel>
            {VIEW_MODES.map((m) => (
              <MenuItem key={m.value} icon={m.icon} checked={prefs.mode === m.value} onClick={() => (prefs.setMode(m.value), close())}>
                {m.label}
              </MenuItem>
            ))}
          </>
        )}
      </Popover>
      {view.kind !== 'trash' && (
        <Popover
          align="end"
          trigger={(p) => (
            <Button {...p} variant="ghost" size="sm" icon={DownloadSimpleIcon} className="max-md:hidden">
              Export
            </Button>
          )}
        >
          {(close) => (
            <>
              <MenuLabel>{collection ? `Export “${collection.name}”` : 'Export all bookmarks'}</MenuLabel>
              {(['html', 'csv', 'json'] as const).map((f) => (
                <a key={f} href={`/api/export?format=${f}${exportQuery}`} download onClick={close} className="block px-3 py-1.5 text-sm hover:bg-hover">
                  {f === 'html' ? 'HTML (browser bookmarks)' : f.toUpperCase()}
                </a>
              ))}
            </>
          )}
        </Popover>
      )}
      <Popover align="end" trigger={(p) => <IconButton {...p} icon={DotsThreeIcon} label="More" size={18} />}>
        {(close) => (
          <>
            <MenuItem icon={CheckSquareIcon} onClick={() => (close(), onSelect())}>
              Select bookmarks
            </MenuItem>
            {view.kind !== 'trash' && (
              <MenuItem icon={PlusIcon} onClick={() => (close(), openDialog(<AddLinkDialog />))}>
                Add bookmark
              </MenuItem>
            )}
            {collection && (
              <>
                <MenuSeparator />
                <MenuItem icon={PencilSimpleIcon} onClick={() => (close(), openDialog(<CollectionDialog collection={collection} />))}>
                  Edit collection
                </MenuItem>
                <MenuItem icon={FolderPlusIcon} onClick={() => (close(), openDialog(<CollectionDialog parentId={collection.id} />))}>
                  New nested collection
                </MenuItem>
                <MenuItem
                  icon={TrashIcon}
                  danger
                  onClick={() => (close(), openDialog(<DeleteCollectionDialog collection={collection} onDeleted={() => navigate('/all')} />))}
                >
                  Delete collection
                </MenuItem>
              </>
            )}
            {view.kind === 'trash' && total > 0 && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={TrashIcon}
                  danger
                  onClick={() => {
                    close();
                    openDialog(
                      <ConfirmDialog
                        title="Empty Trash?"
                        message={`${plural(total, 'bookmark')} will be permanently deleted.`}
                        confirmLabel="Empty Trash"
                        onConfirm={async () => {
                          await api.del('/trash');
                          qc.invalidateQueries({ queryKey: qk.bookmarks });
                          qc.invalidateQueries({ queryKey: qk.sidebar });
                        }}
                      />,
                    );
                  }}
                >
                  Empty Trash
                </MenuItem>
              </>
            )}
          </>
        )}
      </Popover>
    </div>
  );
}

type BulkActionInput =
  | { action: 'move'; collectionId: number | null }
  | { action: 'addTags' | 'removeTags'; tags: string[] }
  | { action: 'favorite'; value: boolean }
  | { action: 'trash' | 'restore' | 'delete' | 'refetch' };

function SelectionBar({
  ids,
  total,
  inTrash,
  onSelectAll,
  onClear,
  run,
}: {
  ids: number[];
  total: number;
  inTrash: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  run: (action: BulkActionInput, done: string) => void;
}) {
  const { openDialog } = useUI();
  const [tags, setTags] = useState<string[]>([]);
  const n = ids.length;
  const none = n === 0;
  const label = plural(n, 'bookmark');
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-accent-soft pr-2 pl-3 md:pr-3">
      <IconButton icon={XIcon} label="Cancel selection" onClick={onClear} />
      <span className="mr-1 text-sm font-semibold whitespace-nowrap">{n} selected</span>
      {n < total && (
        <Button variant="ghost" size="sm" onClick={onSelectAll} className="max-sm:hidden">
          Select all {total.toLocaleString()}
        </Button>
      )}
      <div className="flex-1" />
      {inTrash ? (
        <>
          <Button size="sm" variant="ghost" icon={ArrowCounterClockwiseIcon} disabled={none} onClick={() => run({ action: 'restore' }, `Restored ${label}`)}>
            Restore
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={TrashIcon}
            disabled={none}
            className="text-danger"
            onClick={() =>
              openDialog(
                <ConfirmDialog
                  title={`Delete ${label} permanently?`}
                  message="This can't be undone."
                  confirmLabel="Delete"
                  onConfirm={() => run({ action: 'delete' }, `Deleted ${label}`)}
                />,
              )
            }
          >
            <span className="hidden sm:inline">Delete permanently</span>
          </Button>
        </>
      ) : (
        <>
          <Popover
            align="end"
            trigger={(p) => (
              <Button {...p} size="sm" variant="ghost" icon={FolderOpenIcon} disabled={none}>
                <span className="hidden sm:inline">Move</span>
              </Button>
            )}
          >
            {(close) => (
              <CollectionPicker
                onPick={(id) => {
                  close();
                  run({ action: 'move', collectionId: id }, `Moved ${label}`);
                }}
              />
            )}
          </Popover>
          <Popover
            align="end"
            trigger={(p) => (
              <Button {...p} size="sm" variant="ghost" icon={HashIcon} disabled={none}>
                <span className="hidden sm:inline">Tags</span>
              </Button>
            )}
          >
            {(close) => (
              <div className="w-72 space-y-2 px-3 py-2">
                <TagInput value={tags} onChange={setTags} autoFocus />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    disabled={!tags.length}
                    onClick={() => {
                      close();
                      run({ action: 'removeTags', tags }, `Removed tags from ${label}`);
                      setTags([]);
                    }}
                  >
                    Remove
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!tags.length}
                    onClick={() => {
                      close();
                      run({ action: 'addTags', tags }, `Tagged ${label}`);
                      setTags([]);
                    }}
                  >
                    Add tags
                  </Button>
                </div>
              </div>
            )}
          </Popover>
          <Popover
            align="end"
            trigger={(p) => <IconButton {...p} icon={DotsThreeIcon} label="More actions" disabled={none} />}
          >
            {(close) => (
              <>
                <MenuItem icon={HeartIcon} onClick={() => (close(), run({ action: 'favorite', value: true }, 'Added to favorites'))}>
                  Add to favorites
                </MenuItem>
                <MenuItem icon={HeartIcon} onClick={() => (close(), run({ action: 'favorite', value: false }, 'Removed from favorites'))}>
                  Remove from favorites
                </MenuItem>
                <MenuItem icon={ArrowsClockwiseIcon} onClick={() => (close(), run({ action: 'refetch' }, 'Refreshing metadata…'))}>
                  Refresh metadata
                </MenuItem>
              </>
            )}
          </Popover>
          <Button size="sm" variant="ghost" icon={TrashIcon} disabled={none} className="hover:text-danger" onClick={() => run({ action: 'trash' }, `Moved ${label} to Trash`)}>
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </>
      )}
    </div>
  );
}

function Empty({ title, body, children }: { title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-20 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      {body && <p className="mt-1.5 text-sm text-ink-2">{body}</p>}
      {children && <div className="mt-5 flex gap-2">{children}</div>}
    </div>
  );
}

function EmptyState({ view, q }: { view: View; q: string }) {
  const { openDialog } = useUI();
  const navigate = useNavigate();
  if (q.trim()) return <Empty title="Nothing found" body={`No bookmarks match “${q.trim()}”. Try fewer words, or search operators like #tag or site:.`} />;
  if (view.kind === 'trash') return <Empty title="Trash is empty" body="Deleted bookmarks stay here until you empty the Trash." />;
  if (view.kind === 'filter' || view.kind === 'tag') return <Empty title="Nothing here yet" />;
  const add = (
    <Button variant="primary" icon={PlusIcon} onClick={() => openDialog(<AddLinkDialog />)}>
      Add bookmark
    </Button>
  );
  if (view.kind === 'all')
    return (
      <Empty title="Welcome to Magpie" body="Save links, notes and files, then organise them into collections. Paste or drag a link anywhere on this page to save it.">
        {add}
        <Button icon={UploadSimpleIcon} onClick={() => navigate('/settings/import')}>
          Import bookmarks
        </Button>
      </Empty>
    );
  return (
    <Empty title={view.kind === 'unsorted' ? 'Nothing unsorted' : 'This collection is empty'} body="Add a link, or drag bookmarks here from another collection.">
      {add}
    </Empty>
  );
}
