// Worker thread entry: reads metadata out of page HTML, so parsing a large page doesn't block the
// server. See extract-pool.ts.
import { parentPort } from 'node:worker_threads';
import { extractMetadata } from './extract.ts';

parentPort!.on('message', ({ html, url }: { html: string; url: string }) => {
  try {
    parentPort!.postMessage({ result: extractMetadata(html, url) });
  } catch (err) {
    parentPort!.postMessage({ error: (err as Error).message ?? String(err) });
  }
});
