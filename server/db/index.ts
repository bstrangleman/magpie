import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { migrations } from './migrations.ts';

export type Param = SQLInputValue | boolean | undefined;

let db: DatabaseSync | null = null;
let dbFile: string | null = null;
const statements = new Map<string, StatementSync>();
let txDepth = 0;

/** Pre-migration snapshots to keep, newest first. */
const KEEP_MIGRATION_SNAPSHOTS = 3;

/** Open (or create) the database and apply pending migrations. */
export function openDb(file: string): DatabaseSync {
  closeDb();
  db = new DatabaseSync(file);
  dbFile = file === ':memory:' ? null : path.resolve(file);
  // busy_timeout first, so switching to WAL waits for another process instead of failing.
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
  migrate(db);
  return db;
}

export function closeDb() {
  statements.clear();
  db?.close();
  db = null;
  dbFile = null;
  txDepth = 0;
}

const userVersion = (conn: DatabaseSync) => (conn.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

/** Where database snapshots (daily and pre-migration) are written. */
export const snapshotDir = () => (dbFile ? path.join(path.dirname(dbFile), 'backups', 'database') : null);

function migrate(conn: DatabaseSync) {
  // An existing database is about to change shape: keep a copy first, so a bad migration
  // (which ships straight to every server running :latest) can be rolled back by hand.
  const before = userVersion(conn);
  if (before > 0 && before < migrations.length && dbFile) {
    const dir = snapshotDir()!;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeSnapshot(conn, path.join(dir, `pre-migration-${stamp}-v${before}.db`));
    pruneFiles(dir, /^pre-migration-/, KEEP_MIGRATION_SNAPSHOTS);
  }

  // Take the write lock before reading the version, so two servers starting on the same file
  // can't both apply the same migration ("table users already exists").
  conn.exec('BEGIN IMMEDIATE');
  try {
    for (let v = userVersion(conn); v < migrations.length; v++) {
      conn.exec(migrations[v]!);
      conn.exec(`PRAGMA user_version = ${v + 1}`);
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

/** Write a consistent copy of the database to `file` (VACUUM INTO works while the server runs). */
function writeSnapshot(conn: DatabaseSync, file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.partial`;
  fs.rmSync(tmp, { force: true });
  conn.prepare('VACUUM INTO ?').run(tmp);
  fs.renameSync(tmp, file);
}

/** Keep the newest `keep` files in `dir` whose names match `pattern` (names sort by their timestamp). */
export function pruneFiles(dir: string, pattern: RegExp, keep: number) {
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => pattern.test(f) && !f.endsWith('.partial'))
    .sort()
    .reverse();
  for (const f of files.slice(Math.max(keep, 0))) fs.rmSync(path.join(dir, f), { force: true });
}

/** Snapshot the open database to `file`. Returns false for an in-memory database. */
export function snapshotDb(file: string): boolean {
  if (!dbFile) return false;
  writeSnapshot(conn(), file);
  return true;
}

function conn(): DatabaseSync {
  if (!db) throw new Error('Database is not open');
  return db;
}

function stmt(sql: string): StatementSync {
  let s = statements.get(sql);
  if (!s) {
    s = conn().prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

// node:sqlite rejects booleans and undefined, so normalise parameters first.
function norm(params: Param[]): SQLInputValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return stmt(sql).all(...norm(params)) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return stmt(sql).get(...norm(params)) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  const r = stmt(sql).run(...norm(params));
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

export function exec(sql: string) {
  conn().exec(sql);
}

/** Run `fn` in a transaction. Nested calls use savepoints. `fn` must be synchronous. */
export function tx<T>(fn: () => T): T {
  const c = conn();
  const outer = txDepth === 0;
  const name = `sp${txDepth}`;
  c.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  txDepth++;
  let committed = false;
  try {
    const result = fn();
    if (result instanceof Promise) throw new Error('tx() callbacks must be synchronous');
    c.exec(outer ? 'COMMIT' : `RELEASE ${name}`);
    committed = true;
    return result;
  } catch (err) {
    // Also reached when COMMIT itself fails (e.g. a deferred constraint, or the disk is full):
    // the transaction is still open then, so roll it back. Never let the rollback mask `err`.
    if (!committed) {
      try {
        if (outer) {
          if (c.isTransaction) c.exec('ROLLBACK');
        } else {
          c.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        }
      } catch {}
    }
    throw err;
  } finally {
    txDepth--;
  }
}

/** "?, ?, ?" for an IN (...) clause. */
export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export const now = () => Date.now();
