import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { config } from './config.ts';
import { closeDb, openDb } from './db/index.ts';
import { pruneRateLimits, pruneSessions } from './lib/auth.ts';
import { runScheduledBackups, snapshotDatabase } from './services/backups.ts';
import { startWorker } from './services/worker.ts';

fs.mkdirSync(config.dataDir, { recursive: true });
openDb(path.join(config.dataDir, 'magpie.db'));
startWorker();

/** Run a periodic job without letting one failure take the server down. */
function safely(name: string, job: () => unknown) {
  try {
    job();
  } catch (err) {
    console.error(`[${name}] failed`, err);
  }
}

function maintenance() {
  safely('sessions', pruneSessions);
  safely('rate-limits', pruneRateLimits);
  safely('backup', runScheduledBackups);
  safely('snapshot', snapshotDatabase);
}

const hourly = setInterval(maintenance, 60 * 60_000);
// Give the server a moment to settle before the first backup check.
setTimeout(maintenance, 60_000).unref();

const server = serve({ fetch: createApp().fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Magpie ${config.version} listening on http://${info.address === '0.0.0.0' ? 'localhost' : info.address}:${info.port}`);
  console.log(`Data directory: ${config.dataDir}`);
});

function shutdown() {
  clearInterval(hourly);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
