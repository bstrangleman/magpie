import './env.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { describe, test } from 'node:test';
import { config } from '../config.ts';
import { closeDb, exec, get, openDb, run, snapshotDir, tx } from '../db/index.ts';
import { migrations } from '../db/migrations.ts';
import { snapshotDatabase } from '../services/backups.ts';

const tempDb = (name: string) => {
  const dir = fs.mkdtempSync(path.join(config.dataDir, `${name}-`));
  return path.join(dir, 'magpie.db');
};

describe('transactions', () => {
  test('recover when COMMIT itself fails', () => {
    openDb(tempDb('commit'));
    // A deferred foreign-key violation only fails at COMMIT.
    assert.throws(() =>
      tx(() => {
        exec('PRAGMA defer_foreign_keys = ON');
        run("INSERT INTO collection_groups (user_id, name, position, created_at) VALUES (999, 'orphan', 0, 0)");
      }),
    );
    assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM collection_groups')!.n, 0, 'rolled back');
    // Later transactions, nested ones included, still work.
    assert.equal(
      tx(() => tx(() => 42)),
      42,
    );
    run("INSERT INTO users (email, name, password_hash, created_at) VALUES ('c@example.com', 'c', 'x', 0)");
    assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n, 1);
    closeDb();
  });

  test('a failed nested transaction only undoes its own work', () => {
    openDb(tempDb('nested'));
    run("INSERT INTO users (email, name, password_hash, created_at) VALUES ('n@example.com', 'n', 'x', 0)");
    tx(() => {
      run("INSERT INTO collection_groups (user_id, name, position, created_at) VALUES (1, 'kept', 0, 0)");
      assert.throws(() =>
        tx(() => {
          run("INSERT INTO collection_groups (user_id, name, position, created_at) VALUES (1, 'undone', 1, 0)");
          throw new Error('nope');
        }),
      );
    });
    assert.equal(get<{ names: string }>('SELECT group_concat(name) AS names FROM collection_groups')!.names, 'kept');
    closeDb();
  });

  test('refuse async callbacks', () => {
    openDb(tempDb('async'));
    assert.throws(() => tx((async () => {}) as () => unknown), /synchronous/);
    assert.equal(tx(() => 'still fine'), 'still fine');
    closeDb();
  });
});

describe('snapshots', () => {
  test('a copy is kept before migrating an existing database', () => {
    const file = tempDb('migrate');
    // A database from before the latest migration.
    const old = new DatabaseSync(file);
    old.exec(migrations[0]!);
    old.exec('PRAGMA user_version = 1');
    old.close();

    openDb(file);
    assert.equal(get<{ user_version: number }>('PRAGMA user_version')!.user_version, migrations.length);
    const dir = snapshotDir()!;
    const copies = fs.readdirSync(dir).filter((f) => f.startsWith('pre-migration-'));
    assert.equal(copies.length, 1);
    assert.match(copies[0]!, /-v1\.db$/);
    const copy = new DatabaseSync(path.join(dir, copies[0]!), { readOnly: true });
    assert.equal((copy.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1);
    copy.close();
    closeDb();

    // Opening an up-to-date database makes no new copy.
    openDb(file);
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('pre-migration-')).length, 1);
    closeDb();
  });

  test('new databases need no copy', () => {
    openDb(tempDb('fresh'));
    assert.equal(fs.existsSync(snapshotDir()!), false);
    closeDb();
  });

  test('daily database snapshots, pruned to the retention count', () => {
    openDb(tempDb('daily'));
    const dir = snapshotDir()!;
    const first = snapshotDatabase();
    assert.ok(first && fs.existsSync(first));
    assert.equal(snapshotDatabase(), null, 'one a day');

    // Pretend there are plenty of old ones: the next snapshot is due, and old ones are pruned.
    const old = new Date(Date.now() - 3 * 86_400_000);
    for (let i = 0; i < config.backupRetention + 5; i++) {
      const f = path.join(dir, `magpie-2020-01-${String(i + 1).padStart(2, '0')}T00-00-00-000Z.db`);
      fs.writeFileSync(f, '');
      fs.utimesSync(f, old, old);
    }
    fs.utimesSync(first, old, old);
    const second = snapshotDatabase();
    assert.ok(second);
    const kept = fs.readdirSync(dir).filter((f) => f.startsWith('magpie-'));
    assert.equal(kept.length, config.backupRetention);
    assert.ok(kept.includes(path.basename(second)), 'the newest is kept');
    closeDb();
  });

  test('in-memory databases have none', () => {
    openDb(':memory:');
    assert.equal(snapshotDir(), null);
    assert.equal(snapshotDatabase(), null);
    closeDb();
  });
});
