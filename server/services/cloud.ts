import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CloudBackup, CloudBackupInput, CloudStatus } from '../../shared/types.ts';
import { config } from '../config.ts';
import { all, get, now, run, snapshotDir } from '../db/index.ts';
import { badRequest } from '../lib/http.ts';

// Copies backup files to storage off the machine: an S3-compatible bucket or a WebDAV folder.
// Files keep their path inside DATA_DIR/backups ("<user id>/magpie-….json", "database/magpie-….db").
// A remote copy is only ever deleted after its local file was deleted here (by hand or by
// retention), never because a file is missing locally: a restored or reinstalled server must not
// wipe the copies it was restored from.

type Stored = Omit<CloudBackupInput, 'secret'> & { secret: string };

const OFF: Stored = { kind: 'none', url: '', bucket: '', region: '', prefix: '', user: '', secret: '', includeDatabase: true };
const NO_STATUS: CloudStatus = { lastSuccessAt: null, error: null, files: 0 };
const DB_SNAPSHOT = /^magpie-.*\.db$/;
const TEST_FILE = 'magpie-connection-test.txt';
const UPLOAD_TIMEOUT_MS = 10 * 60_000;

const backupsDir = () => path.join(config.dataDir, 'backups');

function readSetting<T extends object>(key: string, fallback: T): T {
  const row = get<{ value: string }>('SELECT value FROM server_settings WHERE key = ?', key);
  try {
    return row ? { ...fallback, ...(JSON.parse(row.value) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function writeSetting(key: string, value: unknown) {
  run('INSERT INTO server_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

const stored = () => readSetting<Stored>('cloudBackup', OFF);
const uploadedCount = () => get<{ n: number }>('SELECT COUNT(*) AS n FROM cloud_uploads WHERE remove = 0')!.n;
const status = (): CloudStatus => ({ ...readSetting<CloudStatus>('cloudBackupStatus', NO_STATUS), files: uploadedCount() });

function saveStatus(error: string | null): CloudStatus {
  const previous = readSetting<CloudStatus>('cloudBackupStatus', NO_STATUS);
  writeSetting('cloudBackupStatus', { lastSuccessAt: error ? previous.lastSuccessAt : now(), error });
  return status();
}

export function getCloudBackup(): CloudBackup {
  const { secret, ...rest } = stored();
  return { ...rest, hasSecret: !!secret, status: status() };
}

/** What makes two configurations the same place: files uploaded to one aren't at the other. */
const destination = (c: Stored) => (c.kind === 'none' ? '' : [c.kind, c.url, c.bucket, c.prefix].join('\n'));

/**
 * Save the destination and try it out by writing and removing a small file. The settings are kept
 * even when that fails, so they can be corrected; the returned status says what went wrong.
 */
export async function saveCloudBackup(input: CloudBackupInput): Promise<CloudBackup> {
  const before = stored();
  const next: Stored =
    input.kind === 'none'
      ? { ...before, kind: 'none' }
      : {
          kind: input.kind,
          url: input.url.trim().replace(/\/+$/, ''),
          bucket: input.kind === 's3' ? input.bucket.trim() : '',
          region: input.kind === 's3' ? input.region.trim() || 'us-east-1' : '',
          prefix: input.kind === 's3' ? input.prefix.trim().replace(/^\/+|\/+$/g, '') : '',
          user: input.user.trim(),
          secret: input.secret || before.secret,
          includeDatabase: input.includeDatabase,
        };
  if (next.kind !== 'none') {
    let url: URL | null = null;
    try {
      url = new URL(next.url);
    } catch {}
    if (!url || !/^https?:$/.test(url.protocol)) throw badRequest('Enter the address as a full URL, starting with https://');
    if (url.username || url.password) throw badRequest('Leave the username and password out of the address');
    if (next.kind === 's3' && !next.bucket) throw badRequest('Enter the bucket name');
    if (next.kind === 's3' && !/^[\w.\/-]*$/.test(next.prefix)) throw badRequest('The folder can only contain letters, numbers, ".", "-", "_" and "/"');
    if (!next.user) throw badRequest(next.kind === 's3' ? 'Enter the access key ID' : 'Enter the username');
    if (!next.secret) throw badRequest(next.kind === 's3' ? 'Enter the secret access key' : 'Enter the password');
  }

  // Wait for an upload to the old destination to finish, so it can't record files against the new one.
  await running;
  writeSetting('cloudBackup', next);
  if (next.kind === 'none') return getCloudBackup();
  if (destination(next) !== destination(before)) {
    // A different place: nothing is there yet, and the old status doesn't describe it.
    run('DELETE FROM cloud_uploads');
    writeSetting('cloudBackupStatus', NO_STATUS);
  }
  try {
    const remote = connect(next);
    await remote.put(TEST_FILE, Buffer.from('Magpie can write here.\n'));
    await remote.remove(TEST_FILE);
  } catch (err) {
    saveStatus(describe(err));
    return getCloudBackup();
  }
  await syncCloud();
  return getCloudBackup();
}

/** The local file for a backup was deleted: remove its cloud copy on the next sync. */
export function forgetUpload(relPath: string) {
  run('UPDATE cloud_uploads SET remove = 1 WHERE path = ?', relPath);
}

let running: Promise<CloudStatus> | null = null;

/** Bring the destination up to date. Never rejects; failures are recorded in the status. One run at a time. */
export function syncCloud(): Promise<CloudStatus> {
  return (running ??= sync().finally(() => {
    running = null;
  }));
}

async function sync(): Promise<CloudStatus> {
  try {
    const cfg = stored();
    if (cfg.kind === 'none') return status();
    const remote = connect(cfg);
    for (const { path: rel } of all<{ path: string }>('SELECT path FROM cloud_uploads WHERE remove = 1')) {
      await remote.remove(rel);
      run('DELETE FROM cloud_uploads WHERE path = ?', rel);
    }
    for (const rel of pendingUploads(cfg)) {
      const file = path.join(backupsDir(), rel);
      if (!fs.existsSync(file)) continue;
      await remote.put(rel, fs.readFileSync(file));
      run('INSERT INTO cloud_uploads (path, uploaded_at) VALUES (?, ?) ON CONFLICT (path) DO UPDATE SET uploaded_at = excluded.uploaded_at, remove = 0', rel, now());
    }
    return saveStatus(null);
  } catch (err) {
    console.error('[cloud] backup upload failed:', describe(err));
    try {
      return saveStatus(describe(err));
    } catch {
      return { ...NO_STATUS, error: describe(err) };
    }
  }
}

/** Local backup files that aren't at the destination yet, oldest first. */
function pendingUploads(cfg: Stored): string[] {
  const done = new Set(all<{ path: string }>('SELECT path FROM cloud_uploads').map((r) => r.path));
  const files = all<{ user_id: number; filename: string }>('SELECT user_id, filename FROM backups ORDER BY created_at').map((b) => `${b.user_id}/${b.filename}`);
  // Only the newest database copy: older ones are superseded, and the destination builds up its own history day by day.
  const dir = cfg.includeDatabase ? snapshotDir() : null;
  const newest = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => DB_SNAPSHOT.test(f)).sort().at(-1) : undefined;
  if (newest) files.push(`database/${newest}`);
  return files.filter((f) => !done.has(f));
}

function describe(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  if (e?.name === 'TimeoutError') return 'The storage server took too long to respond';
  if (e?.cause?.code === 'ENOTFOUND') return "Couldn't find that server. Check the address.";
  if (e?.cause?.code === 'ECONNREFUSED') return 'The server refused the connection. Check the address and port.';
  return e?.cause?.message ? `${e.message}: ${e.cause.message}` : (e?.message ?? 'Something went wrong');
}

// --- Destinations --------------------------------------------------------------

interface Remote {
  put(relPath: string, body: Buffer): Promise<void>;
  /** Delete a file. One that is already gone counts as deleted. */
  remove(relPath: string): Promise<void>;
}

const connect = (cfg: Stored): Remote => (cfg.kind === 's3' ? s3Remote(cfg) : webdavRemote(cfg));

/** Percent-encode a path the way S3 signatures expect: everything but unreserved characters, keeping "/". */
const encodePath = (p: string) =>
  p
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');

async function send(what: string, url: string, init: RequestInit, okStatuses: number[] = []): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  if (res.ok || okStatuses.includes(res.status)) {
    await res.arrayBuffer().catch(() => {});
    return res;
  }
  const text = await res.text().catch(() => '');
  // S3 explains errors in XML: <Code>SignatureDoesNotMatch</Code><Message>…</Message>
  const detail = text.match(/<Message>([^<]{1,200})<\/Message>/)?.[1] ?? text.match(/<Code>([^<]{1,100})<\/Code>/)?.[1];
  const hint = res.status === 401 || res.status === 403 ? ' Check the credentials and that they may write here.' : res.status === 404 ? ' Check the address.' : '';
  throw new Error(`${what} failed: ${res.status} ${res.statusText}${detail ? ` (${detail.replace(/\.$/, '')})` : ''}.${hint}`);
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/**
 * Headers that sign a request with AWS Signature Version 4, which every S3-compatible service accepts.
 * `path` must already be encoded (encodePath) and the request must have no query string.
 */
export function signS3(
  req: { method: string; host: string; path: string; body: Buffer; headers?: Record<string, string> },
  cred: { accessKeyId: string; secretAccessKey: string; region: string },
  date = new Date(),
): Record<string, string> {
  const amzDate = date.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(req.body);
  const headers: Record<string, string> = { ...req.headers, host: req.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const signedHeaders = names.join(';');
  const canonical = [req.method, req.path, '', ...names.map((n) => `${n}:${lower[n]}`), '', signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${cred.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${cred.secretAccessKey}`, day), cred.region), 's3'), 'aws4_request');
  const signature = hmac(key, toSign).toString('hex');
  const { host: _host, ...sent } = headers;
  return { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${cred.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

function s3Remote(cfg: Stored): Remote {
  const base = new URL(cfg.url);
  const cred = { accessKeyId: cfg.user, secretAccessKey: cfg.secret, region: cfg.region };
  // Path-style addressing (endpoint/bucket/key): it works everywhere, including servers on a LAN address.
  const request = (what: string, method: string, rel: string, body: Buffer, ok?: number[]) => {
    const key = [cfg.prefix, rel].filter(Boolean).join('/');
    const p = encodePath(`${base.pathname.replace(/\/+$/, '')}/${cfg.bucket}/${key}`);
    const headers = signS3({ method, host: base.host, path: p, body }, cred);
    return send(what, `${base.origin}${p}`, { method, headers, body: method === 'PUT' ? new Uint8Array(body) : undefined }, ok);
  };
  return {
    put: async (rel, body) => void (await request('Upload', 'PUT', rel, body)),
    remove: async (rel) => void (await request('Delete', 'DELETE', rel, Buffer.alloc(0), [404])),
  };
}

function webdavRemote(cfg: Stored): Remote {
  const headers = { authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.secret}`).toString('base64')}` };
  const urlOf = (rel: string) => `${cfg.url}/${encodePath(rel)}`;
  const upload = (rel: string, body: Buffer, ok?: number[]) => send('Upload', urlOf(rel), { method: 'PUT', headers, body: new Uint8Array(body) }, ok);
  return {
    async put(rel, body) {
      // A missing folder answers 404 or 409: create the folders above the file, then try again.
      const first = await upload(rel, body, [404, 409]);
      if (first.ok) return;
      // The destination folder itself (or folders above it) may not exist yet either. Where one
      // can't be created, the upload below says why.
      const base = new URL(cfg.url);
      const above = base.pathname.split('/').filter(Boolean);
      for (let i = 1; i <= above.length; i++) {
        await send('Creating a folder', `${base.origin}/${above.slice(0, i).join('/')}/`, { method: 'MKCOL', headers }).catch(() => {});
      }
      const parts = rel.split('/').slice(0, -1);
      for (let i = 1; i <= parts.length; i++) {
        // 405: the folder already exists.
        await send('Creating a folder', `${urlOf(parts.slice(0, i).join('/'))}/`, { method: 'MKCOL', headers }, [405]);
      }
      await upload(rel, body);
    },
    remove: async (rel) => void (await send('Delete', urlOf(rel), { method: 'DELETE', headers }, [404])),
  };
}
