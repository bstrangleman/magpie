import { config } from '../config.ts';
import { all, now, run } from '../db/index.ts';
import { processBookmark } from './fetcher.ts';

// A small in-process queue for metadata fetches. Pending work lives in the database
// (fetch_status = 'pending'), so anything unfinished is picked up again on restart.

const queue = new Set<number>();
let running = 0;
let started = false;
const idleWaiters: (() => void)[] = [];

export function enqueueFetch(id: number) {
  if (!config.fetchEnabled) return;
  queue.add(id);
  if (started) pump();
}

function pump() {
  while (running < config.fetchConcurrency && queue.size) {
    const id = queue.values().next().value!;
    queue.delete(id);
    running++;
    processBookmark(id)
      .catch((err) => {
        console.error(`[fetch] bookmark ${id} failed`, err);
        // Never leave it pending: the app polls while anything on screen is still being fetched.
        try {
          run("UPDATE bookmarks SET fetch_status = 'failed', fetched_at = ? WHERE id = ? AND fetch_status = 'pending'", now(), id);
        } catch {}
      })
      .finally(() => {
        running--;
        pump();
      });
  }
  if (!running && !queue.size) idleWaiters.splice(0).forEach((resolve) => resolve());
}

export function startWorker() {
  if (!config.fetchEnabled) return;
  started = true;
  for (const { id } of all<{ id: number }>("SELECT id FROM bookmarks WHERE fetch_status = 'pending' ORDER BY id DESC")) queue.add(id);
  pump();
}

/** Resolves once the queue is empty (used by tests). */
export function whenIdle(): Promise<void> {
  if (!running && !queue.size) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}
