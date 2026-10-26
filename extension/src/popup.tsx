import './dev-shim.ts';
import './styles.css';
import { Check, CircleAlert, ExternalLink, Heart, LoaderCircle, Settings, Trash2 } from 'lucide-react';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { phosphorName, type Bookmark, type Sidebar } from '../../shared/types.ts';
import { TagField } from '../../web/src/components/TagField.tsx';
import { AutoTextarea, Button, IconButton, inputClass } from '../../web/src/components/ui.tsx';
import { cn, flattenTrees } from '../../web/src/lib/utils.ts';
import { ApiError, client, getConnection, type Connection } from './api.ts';
import type { BadgeMessage } from './background.ts';
import { ext } from './browser.ts';
import { isWebUrl } from './menus.ts';
import { applyTheme } from './theme.ts';

applyTheme();

type Api = ReturnType<typeof client>;
type State =
  | { phase: 'loading' }
  | { phase: 'setup' }
  | { phase: 'unsupported' }
  | { phase: 'error'; message: string; reconnect: boolean }
  | { phase: 'ready'; existed: boolean }
  | { phase: 'removed' };

const badge = (tabId: number | undefined, state: BadgeMessage['state']) => {
  if (tabId !== undefined) ext.runtime.sendMessage({ type: 'badge', tabId, state } satisfies BadgeMessage).catch(() => {});
};

const openOptions = () => {
  ext.runtime.openOptionsPage();
  window.close();
};

function Popup() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [conn, setConn] = useState<Connection | null>(null);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [sidebar, setSidebar] = useState<Sidebar | null>(null);
  const [bookmark, setBookmark] = useState<Bookmark | null>(null);
  const api = useMemo(() => conn && client(conn), [conn]);

  // Opening the popup saves the current page straight away (or finds it if it's already saved).
  const start = async () => {
    setState({ phase: 'loading' });
    const c = await getConnection();
    if (!c) return setState({ phase: 'setup' });
    setConn(c);
    const [t] = await ext.tabs.query({ active: true, currentWindow: true });
    setTab(t ?? null);
    if (!isWebUrl(t?.url)) return setState({ phase: 'unsupported' });
    try {
      const a = client(c);
      const [sb, found] = await Promise.all([
        a.get<Sidebar>('/sidebar'),
        a.get<{ bookmark: Bookmark | null }>(`/bookmarks/lookup?url=${encodeURIComponent(t.url)}`),
      ]);
      const b = found.bookmark ?? (await a.post<Bookmark>('/bookmarks', { url: t.url, title: t.title }));
      setSidebar(sb);
      setBookmark(b);
      setState({ phase: 'ready', existed: !!found.bookmark });
      badge(t.id, 'saved');
    } catch (err) {
      const e = err as ApiError;
      setState({ phase: 'error', message: e.message, reconnect: e.status === 401 });
    }
  };

  const started = useRef(false);
  useEffect(() => {
    // Guard against StrictMode's double effect in development creating the bookmark twice.
    if (started.current) return;
    started.current = true;
    start();
  }, []);

  const openMagpie = (path = '/all') => {
    if (conn) ext.tabs.create({ url: `${conn.server}${path}` });
    window.close();
  };

  if (state.phase === 'loading') {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-2">
          <LoaderCircle size={16} className="animate-spin" /> Saving…
        </div>
      </Shell>
    );
  }
  if (state.phase === 'setup') {
    return (
      <Shell>
        <Message title="Connect to your Magpie server" body="Sign in once with your Magpie address, email and password.">
          <Button variant="primary" onClick={openOptions}>
            Set up
          </Button>
        </Message>
      </Shell>
    );
  }
  if (state.phase === 'unsupported') {
    return (
      <Shell onSettings={openOptions}>
        <Message title="This page can't be saved" body="Magpie can save web pages (http and https). Browser and extension pages can't be saved.">
          <Button onClick={() => openMagpie()}>Open Magpie</Button>
        </Message>
      </Shell>
    );
  }
  if (state.phase === 'error') {
    return (
      <Shell onSettings={openOptions}>
        <Message title={state.reconnect ? 'Your sign-in has expired' : "Couldn't save this page"} body={state.reconnect ? 'Reconnect the extension to keep saving.' : state.message} error>
          {state.reconnect ? (
            <Button variant="primary" onClick={openOptions}>
              Reconnect
            </Button>
          ) : (
            <Button onClick={start}>Try again</Button>
          )}
        </Message>
      </Shell>
    );
  }
  if (state.phase === 'removed') {
    return (
      <Shell onSettings={openOptions}>
        <Message title="Removed from Magpie" body="The bookmark is in your Trash.">
          <Button
            onClick={async () => {
              await api!.post('/bookmarks/bulk', { ids: [bookmark!.id], action: 'restore' });
              badge(tab?.id, 'saved');
              setState({ phase: 'ready', existed: true });
            }}
          >
            Undo
          </Button>
        </Message>
      </Shell>
    );
  }

  return (
    <Editor
      key={bookmark!.id}
      api={api!}
      bookmark={bookmark!}
      sidebar={sidebar!}
      tab={tab}
      existed={state.existed}
      onOpen={() => openMagpie(bookmark!.collectionId ? `/collection/${bookmark!.collectionId}` : '/unsorted')}
      onSettings={openOptions}
      onRemoved={(b) => {
        setBookmark(b);
        badge(tab?.id, 'clear');
        setState({ phase: 'removed' });
      }}
    />
  );
}

function Shell({ children, onSettings, status }: { children: React.ReactNode; onSettings?: () => void; status?: React.ReactNode }) {
  return (
    <div className="text-ink">
      <header className="flex h-12 items-center gap-2.5 border-b border-line pr-2 pl-3.5">
        <img src="icons/32.png" alt="" width={20} height={20} />
        <div className="min-w-0 flex-1 truncate text-[0.95rem] font-semibold">{status ?? 'Magpie'}</div>
        {onSettings && <IconButton icon={Settings} label="Extension settings" onClick={onSettings} />}
      </header>
      {children}
    </div>
  );
}

function Message({ title, body, error, children }: { title: string; body: string; error?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-7 text-center">
      {error && <CircleAlert size={22} className="mb-2 text-danger" />}
      <h1 className="font-semibold">{title}</h1>
      <p className="mt-1 text-[0.85rem] text-ink-2">{body}</p>
      {children && <div className="mt-4 flex gap-2">{children}</div>}
    </div>
  );
}

function Editor({
  api,
  bookmark,
  sidebar,
  tab,
  existed,
  onOpen,
  onSettings,
  onRemoved,
}: {
  api: Api;
  bookmark: Bookmark;
  sidebar: Sidebar;
  tab: chrome.tabs.Tab | null;
  existed: boolean;
  onOpen: () => void;
  onSettings: () => void;
  onRemoved: (b: Bookmark) => void;
}) {
  const [b, setB] = useState(bookmark);
  const [title, setTitle] = useState(bookmark.title);
  const [note, setNote] = useState(bookmark.note);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState('');
  const groups = useMemo(() => flattenTrees(sidebar.groups, sidebar.collections), [sidebar]);

  // Text edits are batched and sent shortly after typing stops — or immediately if the popup
  // closes mid-edit (keepalive lets that last request outlive the popup).
  const pending = useRef<Partial<Bookmark>>({});
  const timer = useRef<number | undefined>(undefined);

  const send = async (patch: Partial<Bookmark>, keepalive = false) => {
    setSaving('saving');
    try {
      setB(await api.patch<Bookmark>(`/bookmarks/${bookmark.id}`, patch, { keepalive }));
      setSaving('idle');
    } catch (err) {
      setSaving('error');
      setError((err as Error).message);
    }
  };
  const flush = (keepalive = false) => {
    clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) send(patch, keepalive);
  };
  const queue = (patch: Partial<Bookmark>) => {
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 600);
  };

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush(true);
    const onPageHide = () => flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  const remove = async () => {
    flush();
    try {
      await api.del(`/bookmarks/${b.id}`);
      onRemoved(b);
    } catch (err) {
      setSaving('error');
      setError((err as Error).message);
    }
  };

  const status =
    saving === 'saving' ? (
      <span className="flex items-center gap-1.5 text-ink-2">
        <LoaderCircle size={14} className="animate-spin" /> Saving…
      </span>
    ) : (
      <span className="flex items-center gap-1.5">
        <span className="flex size-[18px] items-center justify-center rounded-full bg-[#30a46c] text-white">
          <Check size={12} strokeWidth={3} />
        </span>
        {existed ? 'Already in Magpie' : 'Saved to Magpie'}
      </span>
    );

  const host = (() => {
    try {
      return new URL(b.url ?? '').hostname.replace(/^www\./, '');
    } catch {
      return b.url ?? '';
    }
  })();

  return (
    <Shell status={status} onSettings={onSettings}>
      <div className="space-y-3 p-3.5">
        <div className="flex items-center gap-2 text-[0.8rem] text-ink-3">
          {tab?.favIconUrl ? <img src={tab.favIconUrl} alt="" width={14} height={14} className="rounded-sm" /> : null}
          <span className="truncate">{host}</span>
        </div>
        <AutoTextarea
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            queue({ title: e.target.value });
          }}
          onBlur={() => flush()}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
          placeholder="Title"
          aria-label="Title"
          className="max-h-24 font-semibold"
        />
        <label className="block">
          <span className="mb-1 block text-[0.75rem] font-medium text-ink-2">Collection</span>
          <select
            value={b.collectionId ?? ''}
            onChange={(e) => send({ collectionId: e.target.value ? Number(e.target.value) : null })}
            className={cn(inputClass, 'w-full')}
          >
            <option value="">📥 Unsorted</option>
            {groups.map(({ group, items }) => (
              <optgroup key={group.id} label={group.name}>
                {items.map(({ collection: c, depth }) => (
                  <option key={c.id} value={c.id}>
                    {' '.repeat(depth)}
                    {c.icon && !phosphorName(c.icon) ? c.icon : '📁'} {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-1 block text-[0.75rem] font-medium text-ink-2">Tags</span>
          <TagField value={b.tags} onChange={(tags) => send({ tags })} suggestions={sidebar.tags} />
        </div>
        <label className="block">
          <span className="mb-1 block text-[0.75rem] font-medium text-ink-2">Note</span>
          <AutoTextarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              queue({ note: e.target.value });
            }}
            onBlur={() => flush()}
            placeholder="Add a note (Markdown supported)"
            className="max-h-40 min-h-16"
          />
        </label>
        {saving === 'error' && <p className="rounded-md bg-danger/10 px-2.5 py-1.5 text-[0.8rem] text-danger">{error}</p>}
      </div>
      <footer className="flex items-center gap-1 border-t border-line px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          icon={Heart}
          onClick={() => send({ favorite: !b.favorite })}
          className={cn(b.favorite && 'text-[#e5484d] hover:text-[#e5484d] [&_svg]:fill-current')}
        >
          {b.favorite ? 'Favorite' : 'Add to favorites'}
        </Button>
        <div className="flex-1" />
        <IconButton icon={ExternalLink} label="Open in Magpie" onClick={onOpen} />
        <IconButton icon={Trash2} label="Remove from Magpie" onClick={remove} className="hover:text-danger" />
      </footer>
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
