import { DEFAULT_SETTINGS, type Me, type UserSettings } from '../../shared/types.ts';
import { config } from '../config.ts';
import { get, now, run, tx } from '../db/index.ts';
import { hashPassword } from '../lib/auth.ts';
import { badRequest, forbidden, notFound } from '../lib/http.ts';
import { createGroup } from './collections.ts';

type UserRow = { id: number; email: string; name: string; is_admin: number; settings: string; created_at: number; password_hash: string };

export const userCount = () => get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;

export function findUserByEmail(email: string) {
  return get<UserRow>('SELECT * FROM users WHERE email = ?', email.trim());
}

const EMAIL_TAKEN = 'An account with that email already exists';

export async function createUser(input: { email: string; name: string; password: string }): Promise<number> {
  const email = input.email.trim().toLowerCase();
  if (findUserByEmail(email)) throw badRequest(EMAIL_TAKEN);
  const hash = await hashPassword(input.password);
  // Check again inside the transaction: another sign-up may have finished while the password was
  // hashing (the same email, or the first account on a server with sign-ups disabled).
  return tx(() => {
    const isFirst = userCount() === 0;
    if (!isFirst && config.disableSignups) throw forbidden('Sign-ups are disabled on this server');
    if (findUserByEmail(email)) throw badRequest(EMAIL_TAKEN);
    const { lastId } = run(
      'INSERT INTO users (email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)',
      email,
      input.name.trim() || email.split('@')[0]!,
      hash,
      isFirst,
      now(),
    );
    createGroup(lastId, 'My Collections');
    return lastId;
  });
}

function parseSettings(json: string): UserSettings {
  try {
    const stored = JSON.parse(json) as Partial<UserSettings>;
    return { ...DEFAULT_SETTINGS, ...stored, views: { ...stored.views } };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function getMe(userId: number): Me {
  const row = get<UserRow>('SELECT * FROM users WHERE id = ?', userId);
  if (!row) throw notFound('User not found');
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isAdmin: !!row.is_admin,
    createdAt: row.created_at,
    settings: parseSettings(row.settings),
  };
}

export function getSettings(userId: number): UserSettings {
  return getMe(userId).settings;
}

/** Shallow-merge settings; `views` entries merge per key, and a null entry removes it. */
export function updateSettings(userId: number, patch: Partial<Omit<UserSettings, 'views'>> & { views?: Record<string, object | null> }) {
  const current = getSettings(userId);
  const views = { ...current.views };
  for (const [key, value] of Object.entries(patch.views ?? {})) {
    if (value === null) delete views[key];
    else views[key] = { ...views[key], ...value };
  }
  const next: UserSettings = { ...current, ...patch, views };
  run('UPDATE users SET settings = ? WHERE id = ?', JSON.stringify(next), userId);
  return next;
}

export function updateProfile(userId: number, patch: { name?: string; email?: string }) {
  if (patch.email !== undefined) {
    const email = patch.email.trim().toLowerCase();
    const other = findUserByEmail(email);
    if (other && other.id !== userId) throw badRequest('That email is already in use');
    try {
      run('UPDATE users SET email = ? WHERE id = ?', email, userId);
    } catch (err) {
      if (isUniqueViolation(err)) throw badRequest('That email is already in use');
      throw err;
    }
  }
  if (patch.name !== undefined && patch.name.trim()) run('UPDATE users SET name = ? WHERE id = ?', patch.name.trim(), userId);
  return getMe(userId);
}

const isUniqueViolation = (err: unknown) => /UNIQUE constraint failed/.test((err as Error)?.message ?? '');

export async function setPassword(userId: number, password: string) {
  run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password), userId);
}

export function passwordHash(userId: number): string {
  return get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', userId)!.password_hash;
}
