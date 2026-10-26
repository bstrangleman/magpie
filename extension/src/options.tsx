import './dev-shim.ts';
import './styles.css';
import { Check, Keyboard, LoaderCircle } from 'lucide-react';
import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Me } from '../../shared/types.ts';
import { Button, ErrorText, Field, Input } from '../../web/src/components/ui.tsx';
import {
  ApiError,
  browserName,
  clearConnection,
  client,
  getConnection,
  originPattern,
  request,
  saveConnection,
  serverOrigin,
  type Connection,
} from './api.ts';
import { ext } from './browser.ts';
import { applyTheme } from './theme.ts';

applyTheme();

function Options() {
  const [conn, setConn] = useState<Connection | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    (async () => {
      const saved = await getConnection();
      // A key revoked in Magpie (or a reset server) means signing in again.
      if (saved) {
        const status = await client(saved)
          .get('/me')
          .then(() => 200, (err: ApiError) => err.status);
        if (status === 401) {
          await clearConnection();
          setNotice('Your saved sign-in no longer works. Please connect again.');
          return setConn(null);
        }
      }
      setConn(saved);
    })();
  }, []);

  return (
    <div className="mx-auto max-w-md px-5 py-12 text-ink">
      <div className="mb-6 flex items-center gap-3">
        <img src="icons/48.png" alt="" width={36} height={36} />
        <div>
          <h1 className="text-lg font-semibold">Magpie for {browserName()}</h1>
          <p className="text-sm text-ink-2">Save pages, links, images and notes to your Magpie.</p>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
        {conn === undefined ? (
          <LoaderCircle size={18} className="animate-spin text-ink-3" />
        ) : conn ? (
          <Connected conn={conn} onDisconnected={() => setConn(null)} />
        ) : (
          <>
            {notice && <p className="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm">{notice}</p>}
            <ConnectForm
              onConnected={(c) => {
                setNotice('');
                setConn(c);
              }}
            />
          </>
        )}
      </div>
      <HowTo />
    </div>
  );
}

function Connected({ conn, onDisconnected }: { conn: Connection; onDisconnected: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#30a46c] text-white">
          <Check size={14} strokeWidth={3} />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Connected</p>
          <p className="truncate text-sm text-ink-2">
            {conn.user.name} · {conn.user.email}
          </p>
          <a href={conn.server} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
            {conn.server}
          </a>
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            // Revoke the key this extension created; ignore failures (e.g. server unreachable).
            if (conn.keyId) await client(conn).del(`/keys/${conn.keyId}`).catch(() => {});
            await clearConnection();
            onDisconnected();
          }}
        >
          Disconnect
        </Button>
      </div>
    </>
  );
}

function ConnectForm({ onConnected }: { onConnected: (c: Connection) => void }) {
  const [server, setServer] = useState('');
  const [useKey, setUseKey] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const origin = serverOrigin(server);
    if (!origin) return setError('Enter your Magpie address, like https://magpie.example.com');
    // This must be the first await: the browser only shows the permission prompt during the click.
    const granted = await ext.permissions.request({ origins: [originPattern(origin)] });
    if (!granted) return setError('The extension needs permission to talk to your Magpie server.');
    setBusy(true);
    try {
      let next: Connection;
      if (useKey) {
        const me = await request<Me>({ server: origin, apiKey: apiKey.trim() }, 'GET', '/me');
        next = { server: origin, apiKey: apiKey.trim(), keyId: null, user: { name: me.name, email: me.email } };
      } else {
        const r = await request<{ id: number; key: string; user: Me }>({ server: origin }, 'POST', '/auth/token', {
          email,
          password,
          name: `Browser extension · ${browserName()}`,
        });
        next = { server: origin, apiKey: r.key, keyId: r.id, user: { name: r.user.name, email: r.user.email } };
      }
      await saveConnection(next);
      onConnected(next);
    } catch (err) {
      const status = (err as ApiError).status;
      setError(status === 401 && useKey ? 'That API key is not valid.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Magpie address">
        <Input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://magpie.example.com" autoFocus required />
      </Field>
      {useKey ? (
        <Field label="API key" hint="Create one in Magpie under Settings → Integrations.">
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="mp_…" required />
        </Field>
      ) : (
        <>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </Field>
          <Field label="Password" hint="Used once to create an API key for this browser. The password isn't stored.">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex items-center justify-between pt-2">
        <button type="button" className="text-sm text-accent hover:underline" onClick={() => setUseKey(!useKey)}>
          {useKey ? 'Sign in with email instead' : 'Use an API key instead'}
        </button>
        <Button variant="primary" type="submit" loading={busy}>
          Connect
        </Button>
      </div>
    </form>
  );
}

function HowTo() {
  const [shortcut, setShortcut] = useState<string | null>(null);
  useEffect(() => {
    ext.commands
      ?.getAll()
      .then((cmds) => setShortcut(cmds.find((c) => c.name === '_execute_action')?.shortcut || null))
      .catch(() => {});
  }, []);
  return (
    <div className="mt-6 space-y-2 px-1 text-sm text-ink-2">
      <p>
        <b className="text-ink">Save a page:</b> click the Magpie button in the toolbar. The page is saved straight away; change its collection,
        tags or note in the popup.
      </p>
      <p>
        <b className="text-ink">Right-click</b> a page, link, image or selected text to save it without opening the popup.
      </p>
      <p className="flex items-center gap-1.5">
        <Keyboard size={15} />
        {shortcut ? (
          <>
            Shortcut: <kbd className="rounded border border-line bg-surface px-1.5 font-mono text-xs">{shortcut}</kbd>
          </>
        ) : (
          'Set a keyboard shortcut in your browser’s extension shortcut settings.'
        )}
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
