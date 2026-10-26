import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Backup } from '../../shared/types.ts';
import { config } from '../config.ts';
import { all, get, now, pruneFiles, run, snapshotDb, snapshotDir } from '../db/index.ts';
import { notFound } from '../lib/http.ts';
import { buildExport, type ExportData } from './io.ts';
import { getSettings } from './users.ts';

type Row = { id: number; user_id: number; filename: string; bookmark_count: number; size: number; automatic: number; created_at: number; hash: string | null };

const DAY_MS = 86_400_000;
const dir = (userId: number) => path.join(config.dataDir, 'backups', String(userId));
const toBackup = (r: Row): Backup => ({
  id: r.id,
  createdAt: r.created_at,
  bookmarkCount: r.bookmark_count,
  size: r.size,
  automatic: !!r.automatic,
});

/** A fingerprint of a backup's contents, ignoring when it was made. */
const contentHash = (data: ExportData) => createHash('sha256').update(JSON.stringify({ ...data, exportedAt: null })).digest('hex');

export function listBackups(userId: number): Backup[] {
  return all<Row>('SELECT * FROM backups WHERE user_id = ? ORDER BY created_at DESC', userId).map(toBackup);
}

export function createBackup(userId: number, automatic = false, data = buildExport(userId)): Backup {
  const json = JSON.stringify(data);
  const t = now();
  const filename = `magpie-${new Date(t).toISOString().replace(/[:.]/g, '-')}.json`;
  fs.mkdirSync(dir(userId), { recursive: true });
  fs.writeFileSync(path.join(dir(userId), filename), json);
  const { lastId } = run(
    'INSERT INTO backups (user_id, filename, bookmark_count, size, automatic, created_at, hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId,
    filename,
    data.bookmarks.length,
    Buffer.byteLength(json),
    automatic,
    t,
    contentHash(data),
  );
  if (automatic) pruneAutomatic(userId);
  return toBackup(get<Row>('SELECT * FROM backups WHERE id = ?', lastId)!);
}

export function readBackup(userId: number, id: number): { data: ExportData; createdAt: number } {
  const row = get<Row>('SELECT * FROM backups WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Backup not found');
  const file = path.join(dir(userId), row.filename);
  if (!fs.existsSync(file)) throw notFound('Backup file is missing');
  return { data: JSON.parse(fs.readFileSync(file, 'utf8')) as ExportData, createdAt: row.created_at };
}

export function deleteBackup(userId: number, id: number) {
  const row = get<Row>('SELECT * FROM backups WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Backup not found');
  fs.rmSync(path.join(dir(userId), row.filename), { force: true });
  run('DELETE FROM backups WHERE id = ?', id);
}

function pruneAutomatic(userId: number) {
  const old = all<Row>(
    'SELECT * FROM backups WHERE user_id = ? AND automatic = 1 ORDER BY created_at DESC LIMIT -1 OFFSET ?',
    userId,
    config.backupRetention,
  );
  for (const r of old) deleteBackup(userId, r.id);
}

// When each user's library was last found unchanged, so an unchanged library is compared once a day, not hourly.
const checkedAt = new Map<number, number>();

/**
 * Create a daily backup for every user who has them enabled and whose library changed since
 * their last backup. Changes are found by comparing contents, so trashing, deleting, renaming
 * tags and reorganising collections all count.
 */
export function runScheduledBackups() {
  const dayAgo = now() - DAY_MS;
  const users = all<{ id: number; last: number | null }>(
    'SELECT u.id, (SELECT MAX(created_at) FROM backups WHERE user_id = u.id) AS last FROM users u',
  );
  for (const u of users) {
    if ((u.last && u.last > dayAgo) || (checkedAt.get(u.id) ?? 0) > dayAgo) continue;
    try {
      if (!getSettings(u.id).autoBackup) continue;
      const data = buildExport(u.id);
      if (!data.bookmarks.length && !data.collections.length) continue;
      const latest = get<{ hash: string | null }>('SELECT hash FROM backups WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', u.id);
      if (latest?.hash === contentHash(data)) {
        checkedAt.set(u.id, now());
        continue;
      }
      createBackup(u.id, true, data);
    } catch (err) {
      console.error(`[backup] user ${u.id} failed`, err);
    }
  }
}

/**
 * Keep a daily copy of the whole database (every user, plus reader text, settings and keys) in
 * DATA_DIR/backups/database. Uploaded files live in DATA_DIR/assets and aren't included.
 * Returns the new snapshot's path, or null when none was due.
 */
export function snapshotDatabase(): string | null {
  const target = snapshotDir();
  if (!target) return null;
  const existing = fs.existsSync(target) ? fs.readdirSync(target).filter((f) => /^magpie-.*\.db$/.test(f)) : [];
  const newest = existing
    .map((f) => fs.statSync(path.join(target, f)).mtimeMs)
    .reduce((a, b) => Math.max(a, b), 0);
  // A little under a day, so an hourly check doesn't drift later every day.
  if (newest > now() - DAY_MS + 30 * 60_000) return null;
  const file = path.join(target, `magpie-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  if (!snapshotDb(file)) return null;
  pruneFiles(target, /^magpie-.*\.db$/, config.backupRetention);
  return file;
}
