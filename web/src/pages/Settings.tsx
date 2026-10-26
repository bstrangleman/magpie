import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bookmark,
  Check,
  Copy,
  Download,
  HardDriveDownload,
  KeyRound,
  PanelLeft,
  ChartColumn,
  Plug,
  Plus,
  Trash2,
  Upload,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import type { ApiKey, ImportResult, Me, Theme, UserSettings, ViewMode } from '../../../shared/types.ts';
import { Avatar } from '../components/common.tsx';
import { toast, toastError } from '../components/toast.tsx';
import { Button, buttonClass, Checkbox, ErrorText, Input, Select, Spinner } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { qk, useBackups, useMe, useSaveSettings, useSettings } from '../lib/queries.ts';
import { cn, formatBytes, longDate, plural } from '../lib/utils.ts';
import { StatsPage } from './Stats.tsx';

const SECTIONS: { path: string; label: string; icon: LucideIcon }[] = [
  { path: 'app', label: 'App', icon: PanelLeft },
  { path: 'account', label: 'Account', icon: User },
  { path: 'stats', label: 'Statistics', icon: ChartColumn },
  { path: 'import', label: 'Import', icon: Upload },
  { path: 'integrations', label: 'Integrations', icon: Plug },
  { path: 'backups', label: 'Backups', icon: HardDriveDownload },
];

export function SettingsLayout() {
  const me = useMe().data!;
  const navigate = useNavigate();
  // The statistics dashboard gets more room than the form-style sections.
  const wide = useLocation().pathname.endsWith('/stats');
  useEffect(() => {
    document.title = 'Settings · Magpie';
  }, []);
  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row">
      <aside className="sidebar-scope shrink-0 border-line bg-sidebar md:w-[17rem] md:border-r">
        <div className="p-3">
          <button onClick={() => navigate('/all')} aria-label="Back to bookmarks" className="flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover">
            <ArrowLeft size={19} />
          </button>
        </div>
        <div className="flex items-center gap-3 px-4 pb-4">
          <Avatar name={me.name} size={38} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{me.name}</div>
            <div className="truncate text-[0.82rem] text-ink-2">{me.email}</div>
          </div>
        </div>
        <div className="px-4 pb-1 text-[0.8rem] text-ink-3">Settings</div>
        <nav className="flex gap-0.5 overflow-x-auto px-2 pb-2 md:block md:px-0">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.path}
              to={`/settings/${s.path}`}
              className={({ isActive }) =>
                cn(
                  'flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-[0.95rem] md:rounded-none md:px-4',
                  isActive ? 'bg-accent text-accent-ink' : 'hover:bg-hover',
                )
              }
            >
              <s.icon size={18} strokeWidth={1.6} />
              {s.label}
            </NavLink>
          ))}
        </nav>
        <p className="hidden px-4 pt-5 text-[0.8rem] text-ink-3 md:block">Magpie {__APP_VERSION__}</p>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className={cn('mx-auto px-5 py-6 md:py-8', wide ? 'max-w-[70rem]' : 'max-w-[44rem]')}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function SettingsSection() {
  const { section } = useParams();
  switch (section) {
    case 'app':
      return <AppSettings />;
    case 'account':
      return <AccountSettings />;
    case 'import':
      return <ImportSettings />;
    case 'integrations':
      return <IntegrationSettings />;
    case 'stats':
      return <StatsPage />;
    case 'backups':
      return <BackupSettings />;
    default:
      return <Navigate to="/settings/app" replace />;
  }
}

function Heading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-lg font-semibold">{children}</h1>
      {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-5 gap-y-1.5 py-2.5 sm:grid-cols-[10rem_1fr] sm:items-baseline">
      <div className="text-[0.9rem] text-ink-2 sm:text-right">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const Divider = () => <hr className="my-3 border-line" />;

// --- App ----------------------------------------------------------------------

const THEME_PREVIEWS: { value: Theme; label: string; sidebar: string; main: string; line: string }[] = [
  { value: 'system', label: 'Match system', sidebar: '', main: '', line: '' },
  { value: 'light', label: 'Light', sidebar: '#f1f1f0', main: '#ffffff', line: '#cfcfcf' },
  { value: 'dark', label: 'Dark', sidebar: '#161617', main: '#232325', line: '#4a4a4e' },
  { value: 'dark-sidebar', label: 'Dark sidebar', sidebar: '#1b1b1c', main: '#ffffff', line: '#cfcfcf' },
  { value: 'sepia', label: 'Sepia', sidebar: '#efe6d2', main: '#faf4e8', line: '#d5c6a6' },
];

function ThemePreview({ sidebar, main, line }: { sidebar: string; main: string; line: string }) {
  return (
    <span className="flex h-full w-full overflow-hidden rounded-[5px]" style={{ background: main }}>
      <span className="flex w-[34%] flex-col gap-1 p-1.5" style={{ background: sidebar }}>
        <span className="h-0.5 w-3/4 rounded" style={{ background: line }} />
        <span className="h-0.5 w-1/2 rounded" style={{ background: line }} />
        <span className="h-0.5 w-2/3 rounded" style={{ background: line }} />
      </span>
      <span className="grid flex-1 grid-cols-2 content-start gap-1 p-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-2 rounded-[2px]" style={{ background: line }} />
        ))}
      </span>
    </span>
  );
}

function AppSettings() {
  const settings = useSettings();
  const save = useSaveSettings();
  const set = (patch: Partial<UserSettings>) => save.mutate(patch, { onError: toastError });
  return (
    <>
      <Heading>App</Heading>
      <Row label="Theme">
        <div className="flex flex-wrap gap-2.5">
          {THEME_PREVIEWS.map((t) => (
            <button
              key={t.value}
              title={t.label}
              onClick={() => set({ theme: t.value })}
              className={cn(
                'h-12 w-[4.6rem] rounded-lg border p-[3px]',
                settings.theme === t.value ? 'border-accent ring-2 ring-accent' : 'border-line hover:border-ink-3',
              )}
            >
              {t.value === 'system' ? (
                <span className="relative flex h-full w-full overflow-hidden rounded-[5px]">
                  <span className="w-1/2">
                    <ThemePreview {...THEME_PREVIEWS[1]!} />
                  </span>
                  <span className="w-1/2">
                    <ThemePreview {...THEME_PREVIEWS[2]!} />
                  </span>
                </span>
              ) : (
                <ThemePreview {...t} />
              )}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-ink-3">{THEME_PREVIEWS.find((t) => t.value === settings.theme)?.label}</p>
      </Row>
      <Row label="Font size">
        <Checkbox checked={settings.largeFont} onChange={(largeFont) => set({ largeFont })}>
          Large
        </Checkbox>
      </Row>
      <Divider />
      <Row label="Default view mode">
        <Select<ViewMode>
          value={settings.defaultView}
          onChange={(defaultView) => set({ defaultView })}
          options={[
            { value: 'list', label: 'List' },
            { value: 'cards', label: 'Cards' },
            { value: 'headlines', label: 'Headlines' },
            { value: 'moodboard', label: 'Moodboard' },
          ]}
        />
        <p className="mt-1.5 text-xs text-ink-3">Collections remember their own view once you change it there.</p>
      </Row>
      <Row label="Click on a bookmark">
        <Select
          value={settings.openAction}
          onChange={(openAction) => set({ openAction })}
          options={[
            { value: 'tab', label: 'Open in new tab' },
            { value: 'preview', label: 'Show preview' },
            { value: 'edit', label: 'Edit bookmark' },
          ]}
        />
      </Row>
      <Divider />
      <Row label="Sort tags">
        <div className="space-y-2">
          {(['name', 'count'] as const).map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input type="radio" name="tagSort" checked={settings.tagSort === v} onChange={() => set({ tagSort: v })} className="size-4 accent-[var(--accent)]" />
              {v === 'name' ? 'By name' : 'By number of bookmarks'}
            </label>
          ))}
        </div>
      </Row>
    </>
  );
}

// --- Account -------------------------------------------------------------------

function AccountSettings() {
  const me = useMe().data!;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [busy, setBusy] = useState<'profile' | 'password' | null>(null);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('profile');
    setProfileError('');
    try {
      qc.setQueryData(qk.me, await api.patch<Me>('/me', { name, email }));
      toast('Profile updated');
    } catch (err) {
      setProfileError(errorMessage(err));
    }
    setBusy(null);
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('password');
    setPasswordError('');
    try {
      await api.post('/me/password', { current, next });
      setCurrent('');
      setNext('');
      toast('Password changed. Other sessions were signed out.');
    } catch (err) {
      setPasswordError(errorMessage(err));
    }
    setBusy(null);
  };

  return (
    <>
      <Heading>Account</Heading>
      <form onSubmit={saveProfile}>
        <Row label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        </Row>
        <Row label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" />
        </Row>
        <Row label="">
          <Button type="submit" variant="primary" loading={busy === 'profile'} disabled={name === me.name && email === me.email}>
            Save changes
          </Button>
          <ErrorText>{profileError}</ErrorText>
        </Row>
      </form>
      <Divider />
      <form onSubmit={changePassword}>
        <Row label="Current password">
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" className="max-w-xs" />
        </Row>
        <Row label="New password">
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} className="max-w-xs" />
        </Row>
        <Row label="">
          <Button type="submit" loading={busy === 'password'} disabled={!current || next.length < 8}>
            Change password
          </Button>
          <ErrorText>{passwordError}</ErrorText>
        </Row>
      </form>
      <Divider />
      <Row label="Session">
        <Button
          onClick={async () => {
            await api.post('/auth/logout');
            qc.clear();
            navigate('/login');
          }}
        >
          Log out
        </Button>
        <p className="mt-2 text-xs text-ink-3">Member since {longDate(me.createdAt)}.</p>
      </Row>
    </>
  );
}

// --- Import --------------------------------------------------------------------

const FORMATS = [
  ['Browsers', 'Chrome, Firefox, Safari, Edge — export bookmarks as HTML'],
  ['Raindrop.io', 'Settings → Backups → HTML (keeps nested collections)'],
  ['Karakeep / Hoarder', 'Settings → Import / Export → Export (JSON, keeps lists)'],
  ['Pocket, Instapaper & others', 'CSV with a url column (title, tags, folder optional)'],
  ['Magpie', 'JSON export or backup'],
];

function ImportSettings() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [fetchMetadata, setFetchMetadata] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragging, setDragging] = useState(false);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    setResult(null);
    const form = new FormData();
    form.set('file', file);
    form.set('skipDuplicates', String(skipDuplicates));
    form.set('fetchMetadata', String(fetchMetadata));
    try {
      setResult(await api.post<ImportResult>('/import', form));
      qc.invalidateQueries({ queryKey: qk.sidebar });
      qc.invalidateQueries({ queryKey: qk.bookmarks });
      setFile(null);
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  };

  return (
    <>
      <Heading sub="Bring your bookmarks from a browser or another bookmark manager. Folders become collections.">Import</Heading>
      <button
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
        }}
        className={cn(
          'flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-10 text-sm text-ink-2 hover:bg-hover',
          dragging && 'border-accent bg-accent-soft',
        )}
      >
        <Upload size={24} className="text-ink-3" />
        {file ? (
          <span className="font-medium text-ink">
            {file.name} <span className="font-normal text-ink-3">({formatBytes(file.size)})</span>
          </span>
        ) : (
          'Drop an export file here, or click to choose (.html, .csv, .json)'
        )}
      </button>
      <input ref={input} type="file" accept=".html,.htm,.csv,.json,text/html,text/csv,application/json" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="mt-4 space-y-2">
        <Checkbox checked={skipDuplicates} onChange={setSkipDuplicates}>
          Skip links that are already saved
        </Checkbox>
        <Checkbox checked={fetchMetadata} onChange={setFetchMetadata}>
          Fetch titles, previews and article text in the background
        </Checkbox>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" icon={Upload} onClick={run} loading={busy} disabled={!file}>
          Import
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {result && (
        <div className="mt-4 rounded-lg border border-line bg-field/50 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <Check size={16} className="text-[#30a46c]" /> Imported {plural(result.created, 'bookmark')} from {result.format}
          </p>
          <p className="mt-1 text-ink-2">
            {result.collections > 0 && `${plural(result.collections, 'new collection')}. `}
            {result.skipped > 0 && `${plural(result.skipped, 'item')} skipped (duplicates or invalid links).`}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-ink-3">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <Link to="/all" className="mt-2 inline-block font-medium text-accent hover:underline">
            View bookmarks →
          </Link>
        </div>
      )}
      <h2 className="mt-10 mb-3 text-sm font-semibold">Supported formats</h2>
      <div className="divide-y divide-line rounded-lg border border-line">
        {FORMATS.map(([name, how]) => (
          <div key={name} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
            <span className="w-52 shrink-0 text-sm font-medium">{name}</span>
            <span className="text-sm text-ink-2">{how}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// --- Integrations -----------------------------------------------------------------

function IntegrationSettings() {
  const origin = window.location.origin;
  // Each browser gets its own extension package; offer this one's first.
  const firefox = /\bFirefox\//.test(navigator.userAgent);
  const bookmarklet = `javascript:(function(){var u=encodeURIComponent(location.href),t=encodeURIComponent(document.title);window.open('${origin}/save?url='+u+'&title='+t,'magpie','width=520,height=640');})();`;
  const link = useRef<HTMLAnchorElement>(null);
  // React blocks javascript: URLs in JSX, so set it directly.
  useEffect(() => {
    link.current?.setAttribute('href', bookmarklet);
  }, [bookmarklet]);

  return (
    <>
      <Heading>Integrations</Heading>
      <h2 className="mb-2 text-sm font-semibold">Browser extension</h2>
      <div className="rounded-lg border border-line p-4 text-sm">
        <p className="text-ink-2">
          Save the page you're on with one click, or right-click any link, image or selected text. Works in Chrome, Edge, Brave, Arc and
          Firefox.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href={`/api/extension.zip?browser=${firefox ? 'firefox' : 'chrome'}`} download className={buttonClass('primary')}>
            <Download size={15} strokeWidth={1.9} /> Download for {firefox ? 'Firefox' : 'Chrome'}
          </a>
          <a href={`/api/extension.zip?browser=${firefox ? 'chrome' : 'firefox'}`} download className="font-medium text-accent hover:underline">
            {firefox ? 'Chrome, Edge, Brave or Arc version' : 'Firefox version'}
          </a>
        </div>
        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-ink-2">
          <li>Unzip the download somewhere it can stay.</li>
          <li>
            <b className="text-ink">Chrome, Edge, Brave, Arc:</b> open <code className="rounded bg-field px-1">chrome://extensions</code>, turn on
            Developer mode, click <i>Load unpacked</i> and choose the unzipped folder.
          </li>
          <li>
            <b className="text-ink">Firefox:</b> open <code className="rounded bg-field px-1">about:debugging#/runtime/this-firefox</code>, click{' '}
            <i>Load Temporary Add-on</i> and choose <code className="rounded bg-field px-1">manifest.json</code> (Firefox removes it on restart).
          </li>
          <li>
            In the extension's settings, enter <code className="rounded bg-field px-1">{origin}</code> and sign in.
          </li>
        </ol>
      </div>
      <h2 className="mt-8 mb-2 text-sm font-semibold">Bookmarklet</h2>
      <div className="rounded-lg border border-line p-4">
        <p className="text-sm text-ink-2">Drag this button to your browser's bookmarks bar. Click it on any page to save that page to Magpie.</p>
        <a
          ref={link}
          onClick={(e) => {
            e.preventDefault();
            toast('Drag the button to your bookmarks bar instead of clicking it');
          }}
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-semibold text-accent-ink"
        >
          <Bookmark size={15} /> Save to Magpie
        </a>
      </div>
      <ApiKeys />
      <h2 className="mt-8 mb-2 text-sm font-semibold">REST API</h2>
      <div className="rounded-lg border border-line p-4 text-sm">
        <p className="text-ink-2">Send your key as a bearer token. Everything the web app does is available through the API.</p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-field p-3 text-xs leading-relaxed">
          {`curl -X POST ${origin}/api/bookmarks \\
  -H "Authorization: Bearer mp_…" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com", "tags": ["reading"]}'`}
        </pre>
        <table className="mt-3 w-full text-xs">
          <tbody className="divide-y divide-line">
            {[
              ['GET /api/bookmarks', 'List / search (view, collection, filter, tag, q, sort, offset, limit)'],
              ['POST /api/bookmarks', 'Create (url or note, title, collectionId, tags, favorite)'],
              ['PATCH /api/bookmarks/:id', 'Update fields'],
              ['DELETE /api/bookmarks/:id', 'Move to Trash (?permanent=true to delete)'],
              ['POST /api/bookmarks/bulk', 'Bulk move, tag, favorite, trash, restore'],
              ['GET /api/sidebar', 'Collections, groups, tags and counts'],
              ['POST /api/collections', 'Create a collection (name, icon, color, parentId)'],
              ['GET /api/export?format=html|csv|json', 'Export bookmarks'],
            ].map(([route, desc]) => (
              <tr key={route}>
                <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{route}</td>
                <td className="py-1.5 text-ink-2">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ApiKeys() {
  const qc = useQueryClient();
  const { data: keys, isLoading } = useQuery({ queryKey: qk.keys, queryFn: () => api.get<ApiKey[]>('/keys') });
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState('');

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const r = await api.post<{ key: string }>('/keys', { name });
      setCreated(r.key);
      setName('');
      qc.invalidateQueries({ queryKey: qk.keys });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <h2 className="mt-8 mb-2 text-sm font-semibold">API keys</h2>
      <div className="divide-y divide-line rounded-lg border border-line">
        <form onSubmit={create} className="flex items-center gap-2 px-4 py-2.5">
          <KeyRound size={16} className="shrink-0 text-ink-3" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. “Raycast” or “iOS Shortcut”" className="flex-1" />
          <Button type="submit" icon={Plus} disabled={!name.trim()}>
            Create
          </Button>
        </form>
        {created && (
          <div className="bg-accent-soft px-4 py-3 text-sm">
            <p className="font-medium">Copy your new key now — it won't be shown again.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-xs">{created}</code>
              <Button
                size="sm"
                icon={Copy}
                onClick={() => navigator.clipboard.writeText(created).then(() => toast('Copied'), toastError)}
              >
                Copy
              </Button>
            </div>
          </div>
        )}
        {isLoading && (
          <div className="px-4 py-3">
            <Spinner />
          </div>
        )}
        {keys?.map((k) => (
          <div key={k.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{k.name}</div>
              <div className="text-xs text-ink-3">
                <code>{k.prefix}…</code> · created {longDate(k.createdAt)}
                {k.lastUsedAt ? ` · last used ${longDate(k.lastUsedAt)}` : ' · never used'}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              className="hover:text-danger"
              onClick={() => api.del(`/keys/${k.id}`).then(() => qc.invalidateQueries({ queryKey: qk.keys }), toastError)}
            >
              Revoke
            </Button>
          </div>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
    </>
  );
}

// --- Backups -----------------------------------------------------------------------

function BackupSettings() {
  const qc = useQueryClient();
  const { isAdmin } = useMe().data!;
  const settings = useSettings();
  const save = useSaveSettings();
  const { data: backups, isLoading } = useBackups();
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      await api.post('/backups');
      qc.invalidateQueries({ queryKey: qk.backups });
      toast('Backup created');
    } catch (err) {
      toastError(err);
    }
    setCreating(false);
  };

  return (
    <>
      <Heading>Backups</Heading>
      <div className="space-y-2 rounded-lg border border-line bg-field/60 px-4 py-3 text-sm leading-relaxed">
        <p>
          Magpie keeps a daily backup of your collections, bookmarks, notes and tags on the server, whenever something has changed. Download any backup as
          HTML, CSV or JSON — the JSON file can be re-imported to restore them. Uploaded files and saved page text aren’t included.
        </p>
        {isAdmin && (
          <p className="text-ink-2">
            The server also keeps a daily copy of its whole database, for every account, in <code>backups/database</code> inside its data folder. To be safe
            from a failed disk, copy the data folder (including <code>assets</code>, where uploads are kept) somewhere else regularly.
          </p>
        )}
      </div>
      <div className="mt-4 divide-y divide-line rounded-lg border border-line">
        <button onClick={create} disabled={creating} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-hover">
          {creating ? <Spinner size={16} /> : <Plus size={16} className="text-ink-2" />}
          Create new
        </button>
        {isLoading && (
          <div className="px-4 py-3">
            <Spinner />
          </div>
        )}
        {backups?.map((b) => (
          <div key={b.id} className="group flex items-center gap-3 px-4 py-2 text-sm">
            <Check size={15} className="shrink-0 text-ink-2" />
            <div className="min-w-0 flex-1">
              <span>{longDate(b.createdAt)}</span>
              <span className="ml-2 text-xs text-ink-3">
                {plural(b.bookmarkCount, 'bookmark')} · {formatBytes(b.size)}
                {b.automatic && ' · auto'}
              </span>
            </div>
            {(['html', 'csv', 'json'] as const).map((f) => (
              <a key={f} href={`/api/backups/${b.id}/download?format=${f}`} download className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.8rem] text-ink-2 hover:bg-hover hover:text-ink">
                <Download size={13} /> {f.toUpperCase()}
              </a>
            ))}
            <button
              aria-label="Delete backup"
              onClick={() => api.del(`/backups/${b.id}`).then(() => qc.invalidateQueries({ queryKey: qk.backups }), toastError)}
              className="invisible rounded p-1 text-ink-3 group-hover:visible hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {backups?.length === 0 && <p className="px-4 py-3 text-sm text-ink-3">No backups yet.</p>}
      </div>
      <div className="mt-4">
        <Checkbox checked={settings.autoBackup} onChange={(autoBackup) => save.mutate({ autoBackup }, { onError: toastError })}>
          Create a backup automatically every day (when something changed)
        </Checkbox>
      </div>
      <h2 className="mt-8 mb-2 text-sm font-semibold">Export now</h2>
      <div className="flex flex-wrap gap-2">
        {(['html', 'csv', 'json'] as const).map((f) => (
          <a key={f} href={`/api/export?format=${f}`} download className={buttonClass()}>
            <Download size={15} strokeWidth={1.9} />
            {f === 'html' ? 'HTML (browser bookmarks)' : f.toUpperCase()}
          </a>
        ))}
      </div>
    </>
  );
}
