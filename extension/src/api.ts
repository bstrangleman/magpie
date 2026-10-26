import { ext } from './browser.ts';

/** Where the extension saves to. Stored in extension storage; the password is never kept. */
export interface Connection {
  server: string;
  apiKey: string;
  /** Set when the key was created by signing in here, so disconnecting can revoke it. */
  keyId: number | null;
  user: { name: string; email: string };
}

export async function getConnection(): Promise<Connection | null> {
  const { connection } = await ext.storage.local.get('connection');
  return (connection as Connection | undefined) ?? null;
}

export const saveConnection = (connection: Connection) => ext.storage.local.set({ connection });
export const clearConnection = () => ext.storage.local.remove('connection');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|\d+\.\d+\.\d+\.\d+|[\w-]+\.(local|lan|home|internal))(:\d+)?$/i;

/** Turn what the user typed ("magpie.example.com", "localhost:3000") into an origin. */
export function serverOrigin(input: string): string | null {
  const raw = input.trim().replace(/\/+$/, '');
  if (!raw) return null;
  const host = raw.replace(/^[a-z]+:\/\//i, '').split('/')[0]!;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `${LOCAL_HOST.test(host) ? 'http' : 'https'}://${raw}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Host permission pattern for a server. Ports are left out: Firefox match patterns can't
 * contain them, and in Chrome a pattern without a port matches every port.
 */
export function originPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export async function request<T>(
  conn: { server: string; apiKey?: string },
  method: string,
  path: string,
  body?: unknown,
  opts: { keepalive?: boolean } = {},
): Promise<T> {
  // The client header lets Magpie's statistics tell extension saves from other API use.
  const headers: Record<string, string> = { 'x-magpie-client': 'extension' };
  if (conn.apiKey) headers.authorization = `Bearer ${conn.apiKey}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${conn.server}/api${path}`, {
      method,
      headers,
      credentials: 'omit',
      keepalive: opts.keepalive,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, `Can't reach ${conn.server}`);
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function client(conn: Connection) {
  return {
    get: <T>(path: string) => request<T>(conn, 'GET', path),
    post: <T>(path: string, body: unknown = {}) => request<T>(conn, 'POST', path, body),
    patch: <T>(path: string, body: unknown, opts?: { keepalive?: boolean }) => request<T>(conn, 'PATCH', path, body, opts),
    del: <T>(path: string) => request<T>(conn, 'DELETE', path),
  };
}

export function browserName(): string {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  return 'Browser';
}
