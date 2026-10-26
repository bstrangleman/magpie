import { useQueryClient } from '@tanstack/react-query';
import {
  ChartColumn,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  FolderPlus,
  Hash,
  LogOut,
  Moon,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { FILTERS, type CollectionGroup, type Sidebar as SidebarData, type Tag } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { dnd, dropZone } from '../lib/dnd.ts';
import { qk, useBulk, useMe, useSaveSettings, useSidebar } from '../lib/queries.ts';
import { buildTrees, cn, descendantIds, type TreeNode } from '../lib/utils.ts';
import { FILTER_META, pathOf, sameView, SYSTEM_VIEWS, type View } from '../lib/view.ts';
import { Avatar, CollectionIcon } from './common.tsx';
import { CollectionDialog, ConfirmDialog, DeleteCollectionDialog, PromptDialog } from './dialogs.tsx';
import { toast, toastError } from './toast.tsx';
import { Floating, IconButton, MenuItem, MenuSeparator, Popover } from './ui.tsx';
import { useUI } from './ui-context.tsx';

type Zone = 'before' | 'after' | 'inside';

function useLocalFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v === '1';
    } catch {
      return initial;
    }
  });
  return [
    value,
    (v) => {
      setValue(v);
      try {
        localStorage.setItem(key, v ? '1' : '0');
      } catch {}
    },
  ];
}

function useSidebarCache() {
  const qc = useQueryClient();
  return (fn: (s: SidebarData) => SidebarData) => qc.setQueryData<SidebarData>(qk.sidebar, (s) => s && fn(s));
}

export function Sidebar() {
  const { data } = useSidebar();
  const { openDialog } = useUI();
  const settings = useMe().data!.settings;
  const [filtersOpen, setFiltersOpen] = useLocalFlag('magpie:filters-open', true);
  const [tagsOpen, setTagsOpen] = useLocalFlag('magpie:tags-open', true);
  const trees = useMemo(() => (data ? buildTrees(data.groups, data.collections) : new Map<number | null, TreeNode[]>()), [data]);

  const tags = useMemo(() => {
    const list = (data?.tags ?? []).filter((t) => t.count > 0);
    return settings.tagSort === 'count' ? [...list].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) : list;
  }, [data, settings.tagSort]);

  return (
    <aside className="sidebar-scope flex h-full w-[264px] shrink-0 flex-col border-r border-line bg-sidebar text-ink select-none">
      <header className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-1.5">
        <UserMenu />
        <IconButton
          icon={Plus}
          label="New collection"
          size={18}
          onClick={() => openDialog(<CollectionDialog groupId={data?.groups[0]?.id ?? null} />)}
        />
      </header>
      <nav className="flex-1 overflow-y-auto pb-8" aria-label="Collections">
        {SYSTEM_VIEWS.map((s) => (
          <SystemRow key={s.kind} kind={s.kind} label={s.label} icon={s.icon} count={data?.counts[s.kind] ?? 0} />
        ))}

        {data?.groups.map((g) => <GroupSection key={g.id} group={g} nodes={trees.get(g.id) ?? []} data={data} />)}

        <SectionHeader label="Filters" open={filtersOpen} onToggle={() => setFiltersOpen(!filtersOpen)} />
        {filtersOpen &&
          FILTERS.filter((f) => f === 'favorites' || (data?.counts.filters[f] ?? 0) > 0).map((f) => (
            <Row
              key={f}
              to={pathOf({ kind: 'filter', filter: f })}
              view={{ kind: 'filter', filter: f }}
              icon={<FilterIcon icon={FILTER_META[f].icon} color={FILTER_META[f].color} />}
              label={FILTER_META[f].label}
              count={data?.counts.filters[f]}
            />
          ))}

        {tags.length > 0 && (
          <>
            <SectionHeader label={`Tags (${tags.length})`} open={tagsOpen} onToggle={() => setTagsOpen(!tagsOpen)} />
            {tagsOpen && tags.map((t) => <TagRow key={t.id} tag={t} />)}
          </>
        )}
      </nav>
    </aside>
  );
}

const FilterIcon = ({ icon: Icon, color }: { icon: LucideIcon; color: string }) => (
  <Icon size={17} strokeWidth={1.8} style={{ color }} className="shrink-0" />
);

function UserMenu() {
  const me = useMe().data!;
  const navigate = useNavigate();
  const save = useSaveSettings();
  const qc = useQueryClient();
  const dark = document.documentElement.dataset.theme === 'dark';
  return (
    <Popover
      trigger={(p) => (
        <button {...p} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left hover:bg-hover">
          <Avatar name={me.name} size={22} />
          <span className="truncate text-[0.93rem] font-semibold">{me.name}</span>
          <ChevronDown size={13} className="shrink-0 text-ink-3" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-3 pt-1 pb-2 text-xs text-ink-3">{me.email}</div>
          <MenuItem icon={Settings} onClick={() => (close(), navigate('/settings/app'))}>
            Settings
          </MenuItem>
          <MenuItem icon={ChartColumn} onClick={() => (close(), navigate('/settings/stats'))}>
            Statistics
          </MenuItem>
          <MenuItem icon={Upload} onClick={() => (close(), navigate('/settings/import'))}>
            Import bookmarks
          </MenuItem>
          <MenuItem icon={dark ? Sun : Moon} onClick={() => (close(), save.mutate({ theme: dark ? 'light' : 'dark' }))}>
            {dark ? 'Light theme' : 'Dark theme'}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={LogOut}
            onClick={async () => {
              close();
              await api.post('/auth/logout');
              qc.clear();
              navigate('/login');
            }}
          >
            Log out
          </MenuItem>
        </>
      )}
    </Popover>
  );
}

function SectionHeader({ label, open, onToggle, actions }: { label: string; open: boolean; onToggle: () => void; actions?: ReactNode }) {
  return (
    <div className="group/section mt-3 flex h-7 items-center pr-2 pl-3">
      <button onClick={onToggle} className="flex flex-1 items-center gap-1 truncate text-left text-[0.8rem] text-ink-3 hover:text-ink-2">
        {label}
        <ChevronDown size={12} className={cn('opacity-0 transition group-hover/section:opacity-100', !open && '-rotate-90')} />
      </button>
      {actions && <div className="flex opacity-0 group-hover/section:opacity-100 focus-within:opacity-100">{actions}</div>}
    </div>
  );
}

interface RowProps {
  to: string;
  view: View;
  icon: ReactNode;
  label: string;
  count?: number;
  depth?: number;
  caret?: { open: boolean; onToggle: () => void };
  actions?: (open: (e: React.MouseEvent) => void) => ReactNode;
  menu?: (close: () => void) => ReactNode;
  drop?: Zone | null;
  rowProps?: React.HTMLAttributes<HTMLAnchorElement> & { draggable?: boolean };
}

function Row({ to, view, icon, label, count, depth = 0, caret, menu, drop, rowProps }: RowProps) {
  const ui = useUI();
  const active = sameView(ui.view, view);
  const [anchor, setAnchor] = useState<DOMRect | { x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const pad = 12 + depth * 17;
  // The caret and "…" buttons sit beside the link (not inside it) so the markup stays valid.
  return (
    <div className="group/row relative">
      <Link
        to={to}
        onClick={() => ui.setSidebarOpen(false)}
        onContextMenu={
          menu
            ? (e) => {
                e.preventDefault();
                setAnchor({ x: e.clientX, y: e.clientY });
              }
            : undefined
        }
        style={{ paddingLeft: pad }}
        className={cn(
          'flex h-[1.95rem] items-center gap-2.5 pr-2 text-[0.93rem] outline-offset-[-2px]',
          active ? 'bg-accent text-accent-ink' : 'hover:bg-hover',
          drop === 'inside' && 'bg-accent-soft ring-2 ring-accent ring-inset',
        )}
        {...rowProps}
      >
        <span className={cn('flex shrink-0', active && '[&_svg]:!text-accent-ink')}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!!count && (
          <span className={cn('text-[0.78rem] tabular-nums', active ? 'text-accent-ink/80' : 'text-ink-3', menu && 'group-hover/row:invisible', anchor && 'invisible')}>
            {count.toLocaleString()}
          </span>
        )}
      </Link>
      {caret && (
        <button
          aria-label={`${caret.open ? 'Collapse' : 'Expand'} ${label}`}
          aria-expanded={caret.open}
          onClick={caret.onToggle}
          style={{ left: pad - 15 }}
          className={cn('absolute inset-y-0 flex w-4 items-center justify-center', active ? 'text-accent-ink/80' : 'text-ink-3 hover:text-ink')}
        >
          {caret.open ? <ChevronDown size={12} strokeWidth={2.5} /> : <ChevronRight size={12} strokeWidth={2.5} />}
        </button>
      )}
      {menu && (
        <button
          ref={moreRef}
          aria-label={`${label} options`}
          onClick={() => setAnchor(moreRef.current!.getBoundingClientRect())}
          className={cn(
            'absolute top-1/2 right-1.5 hidden size-6 -translate-y-1/2 items-center justify-center rounded group-hover/row:flex focus-visible:flex',
            active ? 'text-accent-ink hover:bg-white/20' : 'text-ink-2 hover:bg-hover',
            anchor && 'flex',
          )}
        >
          <Ellipsis size={15} />
        </button>
      )}
      {drop === 'before' && <div className="pointer-events-none absolute inset-x-2 top-0 h-0.5 rounded bg-accent" style={{ left: pad }} />}
      {drop === 'after' && <div className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded bg-accent" style={{ left: pad }} />}
      {anchor && menu && (
        <Floating anchor={anchor} onClose={() => setAnchor(null)} align="end" ignore={moreRef.current}>
          {menu(() => setAnchor(null))}
        </Floating>
      )}
    </div>
  );
}

/** Drop target handling for rows that accept dragged bookmarks (and optionally collections). */
function useDropTarget(accept: (e: React.DragEvent, el: HTMLElement) => Zone | null, onDrop: (zone: Zone) => void) {
  const [zone, setZone] = useState<Zone | null>(null);
  return {
    zone,
    props: {
      onDragOver: (e: React.DragEvent<HTMLAnchorElement>) => {
        const z = accept(e, e.currentTarget);
        if (!z) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (z !== zone) setZone(z);
      },
      onDragLeave: () => setZone(null),
      onDrop: (e: React.DragEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        const z = zone ?? accept(e, e.currentTarget);
        setZone(null);
        if (z) onDrop(z);
        dnd.end();
      },
    },
  };
}

function SystemRow({ kind, label, icon: Icon, count }: { kind: 'all' | 'unsorted' | 'trash'; label: string; icon: LucideIcon; count: number }) {
  const bulk = useBulk();
  const target = useDropTarget(
    () => (kind !== 'all' && dnd.get()?.type === 'bookmarks' ? 'inside' : null),
    () => {
      const p = dnd.get();
      if (p?.type !== 'bookmarks') return;
      bulk.mutate(
        kind === 'trash' ? { ids: p.ids, action: 'trash' } : { ids: p.ids, action: 'move', collectionId: null },
        {
          onSuccess: () => toast(kind === 'trash' ? `Moved ${p.ids.length} to Trash` : `Moved ${p.ids.length} to Unsorted`),
          onError: toastError,
        },
      );
    },
  );
  return (
    <Row
      to={`/${kind}`}
      view={{ kind }}
      icon={<Icon size={18} strokeWidth={1.6} className="text-ink-2" />}
      label={label}
      count={count}
      drop={target.zone}
      rowProps={target.props}
    />
  );
}

function GroupSection({ group, nodes, data }: { group: CollectionGroup; nodes: TreeNode[]; data: SidebarData }) {
  const { openDialog } = useUI();
  const qc = useQueryClient();
  const patchCache = useSidebarCache();
  const [dropping, setDropping] = useState(false);

  const toggle = () => {
    patchCache((s) => ({ ...s, groups: s.groups.map((g) => (g.id === group.id ? { ...g, collapsed: !g.collapsed } : g)) }));
    api.patch(`/groups/${group.id}`, { collapsed: !group.collapsed }).catch(toastError);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: qk.sidebar });

  return (
    <div
      onDragOver={(e) => {
        if (dnd.get()?.type !== 'collection' || !(e.target as HTMLElement).closest('[data-group-header]')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        const p = dnd.get();
        if (p?.type !== 'collection' || !(e.target as HTMLElement).closest('[data-group-header]')) return;
        e.preventDefault();
        setDropping(false);
        dnd.end();
        api.post(`/collections/${p.id}/move`, { parentId: null, groupId: group.id }).then(refresh, toastError);
      }}
    >
      <div data-group-header className={cn(dropping && 'bg-accent-soft')}>
        <SectionHeader
          label={group.name}
          open={!group.collapsed}
          onToggle={toggle}
          actions={
            <>
              <IconButton icon={Plus} label="New collection" size={14} className="size-6" onClick={() => openDialog(<CollectionDialog groupId={group.id} />)} />
              <Popover align="end" trigger={(p) => <IconButton {...p} icon={Ellipsis} label="Group options" size={14} className="size-6" />}>
                {(close) => (
                  <>
                    <MenuItem icon={FolderPlus} onClick={() => (close(), openDialog(<CollectionDialog groupId={group.id} />))}>
                      New collection
                    </MenuItem>
                    <MenuItem
                      icon={Pencil}
                      onClick={() => {
                        close();
                        openDialog(
                          <PromptDialog title="Rename group" label="Name" initial={group.name} onSubmit={(name) => api.patch(`/groups/${group.id}`, { name }).then(refresh)} />,
                        );
                      }}
                    >
                      Rename group
                    </MenuItem>
                    <MenuItem
                      icon={Plus}
                      onClick={() => {
                        close();
                        openDialog(
                          <PromptDialog title="New group" label="Name" confirmLabel="Create" onSubmit={(name) => api.post('/groups', { name }).then(refresh)} />,
                        );
                      }}
                    >
                      New group
                    </MenuItem>
                    {data.groups.length > 1 && (
                      <MenuItem
                        icon={Trash2}
                        danger
                        onClick={() => {
                          close();
                          openDialog(
                            <ConfirmDialog
                              title={`Delete “${group.name}”?`}
                              message={`Its collections will move to “${data.groups.find((g) => g.id !== group.id)!.name}”. No bookmarks are deleted.`}
                              confirmLabel="Delete group"
                              onConfirm={() => api.del(`/groups/${group.id}`).then(refresh)}
                            />,
                          );
                        }}
                      >
                        Delete group
                      </MenuItem>
                    )}
                  </>
                )}
              </Popover>
            </>
          }
        />
      </div>
      {!group.collapsed && nodes.map((n) => <CollectionNode key={n.collection.id} node={n} siblings={nodes} groupId={group.id} />)}
      {!group.collapsed && nodes.length === 0 && (
        <button onClick={() => openDialog(<CollectionDialog groupId={group.id} />)} className="flex h-8 w-full items-center gap-2 pl-3 text-sm text-ink-3 hover:text-ink-2">
          <Plus size={15} /> Create collection
        </button>
      )}
    </div>
  );
}

function CollectionNode({ node, siblings, groupId }: { node: TreeNode; siblings: TreeNode[]; groupId: number }) {
  const c = node.collection;
  const { openDialog, view } = useUI();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const patchCache = useSidebarCache();
  const bulk = useBulk();
  const { data } = useSidebar();
  const collections = data?.collections ?? [];
  const open = !c.collapsed;
  const hasChildren = node.children.length > 0;
  const refresh = () => qc.invalidateQueries({ queryKey: qk.sidebar });

  const toggle = () => {
    patchCache((s) => ({ ...s, collections: s.collections.map((x) => (x.id === c.id ? { ...x, collapsed: open } : x)) }));
    api.patch(`/collections/${c.id}`, { collapsed: open }).catch(toastError);
  };

  const target = useDropTarget(
    (e, el) => {
      const p = dnd.get();
      if (!p) return null;
      if (p.type === 'bookmarks') return 'inside';
      if (descendantIds(collections, p.id).has(c.id)) return null;
      return dropZone(e, el, true);
    },
    (zone) => {
      const p = dnd.get();
      if (!p) return;
      if (p.type === 'bookmarks') {
        bulk.mutate(
          { ids: p.ids, action: 'move', collectionId: c.id },
          { onSuccess: () => toast(`Moved ${p.ids.length} to ${c.name}`), onError: toastError },
        );
        return;
      }
      const sibs = siblings.filter((s) => s.collection.id !== p.id);
      const at = sibs.findIndex((s) => s.collection.id === c.id);
      const body =
        zone === 'inside'
          ? { parentId: c.id }
          : {
              parentId: c.parentId,
              groupId: c.parentId ? null : groupId,
              prevId: zone === 'before' ? (sibs[at - 1]?.collection.id ?? null) : c.id,
              nextId: zone === 'before' ? c.id : (sibs[at + 1]?.collection.id ?? null),
            };
      api.post(`/collections/${p.id}/move`, body).then(refresh, toastError);
    },
  );

  const menu = (close: () => void) => (
    <>
      <MenuItem icon={FolderPlus} onClick={() => (close(), openDialog(<CollectionDialog parentId={c.id} />))}>
        New nested collection
      </MenuItem>
      <MenuItem icon={Pencil} onClick={() => (close(), openDialog(<CollectionDialog collection={c} />))}>
        Edit name, icon & colour
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={Trash2} danger onClick={() => (close(), openDialog(<DeleteCollectionDialog collection={c} onDeleted={() => view.kind === 'collection' && view.id === c.id && navigate('/all')} />))}>
        Delete collection
      </MenuItem>
    </>
  );

  return (
    <>
      <Row
        to={pathOf({ kind: 'collection', id: c.id })}
        view={{ kind: 'collection', id: c.id }}
        icon={<CollectionIcon collection={c} size={18} />}
        label={c.name}
        count={c.count}
        depth={node.depth}
        caret={hasChildren ? { open, onToggle: toggle } : undefined}
        menu={menu}
        drop={target.zone}
        rowProps={{
          ...target.props,
          draggable: true,
          onDragStart: (e) => dnd.start(e, { type: 'collection', id: c.id }),
          onDragEnd: () => dnd.end(),
        }}
      />
      {open && node.children.map((child) => <CollectionNode key={child.collection.id} node={child} siblings={node.children} groupId={groupId} />)}
    </>
  );
}

function TagRow({ tag }: { tag: Tag }) {
  const { openDialog, view } = useUI();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const bulk = useBulk();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.sidebar });
    qc.invalidateQueries({ queryKey: qk.bookmarks });
  };
  const target = useDropTarget(
    () => (dnd.get()?.type === 'bookmarks' ? 'inside' : null),
    () => {
      const p = dnd.get();
      if (p?.type === 'bookmarks')
        bulk.mutate({ ids: p.ids, action: 'addTags', tags: [tag.name] }, { onSuccess: () => toast(`Tagged ${p.ids.length} with #${tag.name}`), onError: toastError });
    },
  );
  const isCurrent = view.kind === 'tag' && view.tag.toLowerCase() === tag.name.toLowerCase();
  return (
    <Row
      to={pathOf({ kind: 'tag', tag: tag.name })}
      view={{ kind: 'tag', tag: tag.name }}
      icon={<Hash size={16} strokeWidth={1.8} className="text-ink-3" />}
      label={tag.name}
      count={tag.count}
      drop={target.zone}
      rowProps={target.props}
      menu={(close) => (
        <>
          <MenuItem
            icon={Pencil}
            onClick={() => {
              close();
              openDialog(
                <PromptDialog
                  title="Rename tag"
                  label="Name (renaming to an existing tag merges them)"
                  initial={tag.name}
                  onSubmit={async (name) => {
                    await api.patch(`/tags/${tag.id}`, { name });
                    refresh();
                    if (isCurrent) navigate(pathOf({ kind: 'tag', tag: name }), { replace: true });
                  }}
                />,
              );
            }}
          >
            Rename tag
          </MenuItem>
          <MenuItem
            icon={Trash2}
            danger
            onClick={() => {
              close();
              openDialog(
                <ConfirmDialog
                  title={`Delete #${tag.name}?`}
                  message="The tag is removed from all bookmarks. The bookmarks themselves are kept."
                  confirmLabel="Delete tag"
                  onConfirm={async () => {
                    await api.del(`/tags/${tag.id}`);
                    refresh();
                    if (isCurrent) navigate('/all');
                  }}
                />,
              );
            }}
          >
            Delete tag
          </MenuItem>
        </>
      )}
    />
  );
}
