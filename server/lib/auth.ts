import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { config } from '../config.ts';
import { get, now, run } from '../db/index.ts';
import { forbidden, unauthorized } from './http.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_COOKIE = 'magpie_session';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
  /** How the request authenticated. */
  via: 'session' | 'key';
}

export type AppEnv = { Variables: { user: AuthUser } };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  try {
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/**
 * Check a password against a user that may not exist. Unknown emails still pay for one scrypt
 * run, so response times don't reveal which emails have accounts.
 */
export async function verifyUserPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (stored) return verifyPassword(password, stored);
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
  return false;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');

function isSecure(c: Context) {
  return c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';
}

export function startSession(c: Context, userId: number) {
  const value = token();
  const expires = now() + config.sessionDays * 86_400_000;
  run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha256(value), userId, now(), expires);
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecure(c),
    path: '/',
    expires: new Date(expires),
  });
}

export function endSession(c: Context) {
  const value = getCookie(c, SESSION_COOKIE);
  if (value) run('DELETE FROM sessions WHERE id = ?', sha256(value));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function endAllSessions(userId: number) {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function createApiKey(userId: number, name: string) {
  const key = `mp_${token()}`;
  const { lastId } = run(
    'INSERT INTO api_keys (user_id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)',
    userId,
    name,
    sha256(key),
    key.slice(0, 10),
    now(),
  );
  return { id: lastId, key };
}

type UserRow = { id: number; email: string; name: string; is_admin: number };
const toAuthUser = (row: UserRow, via: AuthUser['via']): AuthUser => ({ id: row.id, email: row.email, name: row.name, isAdmin: !!row.is_admin, via });

function userFromRequest(c: Context): AuthUser | null {
  const bearer = c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer) {
    const row = get<UserRow & { key_id: number }>(
      `SELECT u.id, u.email, u.name, u.is_admin, k.id AS key_id
       FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?`,
      sha256(bearer),
    );
    if (!row) return null;
    run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', now(), row.key_id);
    return toAuthUser(row, 'key');
  }
  const value = getCookie(c, SESSION_COOKIE);
  if (!value) return null;
  const row = get<UserRow>(
    `SELECT u.id, u.email, u.name, u.is_admin
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`,
    sha256(value),
    now(),
  );
  return row ? toAuthUser(row, 'session') : null;
}

/** Require a signed-in user (session cookie or API key). */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = userFromRequest(c);
  if (!user) throw unauthorized();
  c.set('user', user);
  await next();
};

/**
 * Cookies are SameSite=Lax, which already blocks cross-site POSTs; as a second layer,
 * reject state-changing requests whose Origin doesn't match the Host. Requests that carry
 * an API key are exempt: browsers never attach those automatically, so CSRF doesn't apply
 * (and the browser extension sends a chrome-extension:// Origin). So is the extension's sign-in,
 * POST /api/auth/token: it authenticates with the email and password in the body, not a cookie,
 * and issues no session.
 */
export const checkOrigin: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  const bearer = /^Bearer\s/i.test(c.req.header('authorization') ?? '');
  const tokenExchange = c.req.path === '/api/auth/token';
  if (!bearer && !tokenExchange && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('origin');
    if (origin) {
      const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {}
      if (!host || originHost !== host) throw forbidden('Cross-origin request blocked');
    }
  }
  await next();
};

/**
 * The client's address, for rate limiting. The socket's peer, unless TRUST_PROXY is set: then the
 * last X-Forwarded-For entry, the one the reverse proxy added (earlier entries are client-supplied).
 * Null when unknown (requests made in-process, as tests do).
 */
export function clientIp(c: Context): string | null {
  if (config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',').pop()?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    return null;
  }
}

// A small in-memory limiter: counts events per key within a fixed window.
const hits = new Map<string, { count: number; resetAt: number }>();

/** True once `key` has been hit `max` times in its current window. */
export function isLimited(key: string, max: number): boolean {
  const entry = hits.get(key);
  return !!entry && entry.resetAt > now() && entry.count >= max;
}

export function hit(key: string, windowMs: number) {
  const t = now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= t) hits.set(key, { count: 1, resetAt: t + windowMs });
  else entry.count++;
  if (hits.size > 10_000) pruneRateLimits();
}

export const clearHits = (key: string) => hits.delete(key);

/** Forget windows that have ended. */
export function pruneRateLimits() {
  const t = now();
  for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
}

export function pruneSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', now());
}
