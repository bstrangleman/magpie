// A small pool of worker threads for extractMetadata(). Parsing a page and running Readability can
// take a second or more on big pages; on the main thread that would stall every other request.
import { Worker } from 'node:worker_threads';
import { config } from '../config.ts';
import { extractMetadata, type Metadata } from './extract.ts';

const WORKER_URL = new URL('./extract-worker.ts', import.meta.url);
const SIZE = Math.max(1, Math.min(config.fetchConcurrency, 2));
const JOB_TIMEOUT_MS = 30_000;
/** Worker failures, before any job has succeeded, after which pages are parsed on the main thread. */
const MAX_STARTUP_FAILURES = 3;

interface Job {
  html: string;
  url: string;
  resolve: (m: Metadata) => void;
  reject: (err: Error) => void;
}

interface Slot {
  worker: Worker;
  job: Job | null;
  timer?: NodeJS.Timeout;
}

const slots: Slot[] = [];
const queue: Job[] = [];
let succeeded = false;
let failures = 0;
let inline = false;

function settle(slot: Slot): Job | null {
  clearTimeout(slot.timer);
  const job = slot.job;
  slot.job = null;
  slot.worker.unref();
  return job;
}

/** Stop a worker (crashed, or stuck on a page) and fail its job. A new one starts when needed. */
function retire(slot: Slot, err: Error, workerFault: boolean) {
  const i = slots.indexOf(slot);
  if (i !== -1) slots.splice(i, 1);
  const job = settle(slot);
  slot.worker.removeAllListeners();
  slot.worker.on('error', () => {});
  void slot.worker.terminate();
  if (workerFault && !succeeded && ++failures >= MAX_STARTUP_FAILURES && !inline) {
    // Workers can't run here at all; don't fail every page because of it.
    console.warn('[fetch] worker threads keep failing; parsing pages on the main thread', err);
    inline = true;
    if (job) runInline(job);
    for (const queued of queue.splice(0)) runInline(queued);
    return;
  }
  job?.reject(err);
  dispatch();
}

function spawn(): Slot {
  // A runaway page should take down its worker, not the server.
  const worker = new Worker(WORKER_URL, { resourceLimits: { maxOldGenerationSizeMb: 512 } });
  const slot: Slot = { worker, job: null };
  worker.on('message', (msg: { result?: Metadata; error?: string }) => {
    const job = settle(slot);
    succeeded = true;
    if (msg.error !== undefined) job?.reject(new Error(msg.error));
    else job?.resolve(msg.result!);
    dispatch();
  });
  worker.on('error', (err: Error) => retire(slot, err, true));
  worker.on('exit', (code) => retire(slot, new Error(`The page reader stopped (exit code ${code})`), true));
  // Only a busy worker keeps the process alive (see dispatch); an idle one shouldn't hold up exit
  // or a test run. Unref after adding listeners: a 'message' listener refs the worker's port again.
  worker.unref();
  return slot;
}

function dispatch() {
  while (queue.length) {
    let slot = slots.find((s) => !s.job);
    if (!slot && slots.length < SIZE) {
      slot = spawn();
      slots.push(slot);
    }
    if (!slot) return;
    const current = slot;
    const job = queue.shift()!;
    current.job = job;
    current.worker.ref();
    current.timer = setTimeout(() => retire(current, new Error('Reading the page took too long'), false), JOB_TIMEOUT_MS);
    current.worker.postMessage({ html: job.html, url: job.url });
  }
}

function runInline(job: Job) {
  try {
    job.resolve(extractMetadata(job.html, job.url));
  } catch (err) {
    job.reject(err as Error);
  }
}

/** extractMetadata() on a worker thread. Rejects if the page can't be read, or takes too long. */
export function extractInWorker(html: string, url: string): Promise<Metadata> {
  return new Promise<Metadata>((resolve, reject) => {
    const job = { html, url, resolve, reject };
    if (inline) return runInline(job);
    queue.push(job);
    try {
      dispatch();
    } catch (err) {
      // new Worker() itself threw: run everything waiting here instead.
      console.warn('[fetch] worker threads unavailable; parsing pages on the main thread', err);
      inline = true;
      for (const queued of queue.splice(0)) runInline(queued);
    }
  });
}
