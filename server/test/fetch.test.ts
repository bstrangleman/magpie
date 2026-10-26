import './env-lan.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { get } from '../db/index.ts';
import { processBookmark } from '../services/fetcher.ts';
import { signedInClient, type Client } from './helpers.ts';

// A 1×1 PNG, padded past the "too small to be a real image" check.
const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'),
  Buffer.alloc(200),
]);
const ARTICLE = `<html><head><title>Fallback</title>
  <meta property="og:title" content="Local article">
  <meta property="og:image" content="/cover.png">
  <link rel="icon" href="/icon.png">
</head><body><article>${'<p>Plenty of readable words here. '.repeat(40)}</p></article></body></html>`;

let base = '';
// /slow answers only when the test says so, to edit or delete a bookmark mid-fetch.
let slowRequested: Promise<void> = Promise.resolve();
let onSlowRequest = () => {};
let releaseSlow = () => {};
const armSlow = () => {
  slowRequested = new Promise((resolve) => (onSlowRequest = resolve));
};
const server = http.createServer((req, res) => {
  const path = req.url ?? '/';
  if (path === '/article' || path === '/other') return res.writeHead(200, { 'content-type': 'text/html' }).end(ARTICLE);
  if (path === '/cover.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
  // Served with the wrong type: the icon is recognised by its bytes.
  if (path === '/icon.png') return res.writeHead(200, { 'content-type': 'text/plain' }).end(PNG);
  if (path === '/slow') {
    releaseSlow = () => res.writeHead(200, { 'content-type': 'text/html' }).end(ARTICLE.replace('Local article', 'Slow article'));
    return onSlowRequest();
  }
  res.writeHead(404).end('not found');
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const assetCount = () => get<{ n: number }>('SELECT COUNT(*) AS n FROM assets')!.n;

async function save(c: Client, url: string) {
  const b = (await c.post('/api/bookmarks', { url })).data;
  assert.equal(b.fetchStatus, 'pending');
  return b.id as number;
}

describe('fetching metadata', () => {
  test('reads the page, and caches its cover and site icon', async () => {
    const c = await signedInClient();
    const id = await save(c, `${base}/article`);
    await processBookmark(id);
    const b = (await c.get(`/api/bookmarks/${id}`)).data;
    assert.equal(b.fetchStatus, 'done');
    assert.equal(b.title, 'Local article');
    assert.match(b.cover, /^\/api\/assets\/\d+$/);
    assert.match(b.favicon, /^\/api\/assets\/\d+$/, 'icon served from Magpie, not the site');
    const icon = await c.get(b.favicon);
    assert.equal(icon.res.headers.get('content-type'), 'image/png');
    assert.ok((await c.get(`/api/bookmarks/${id}/content`)).data.text.includes('readable words'));

    // A second bookmark with the same icon reuses the cached copy.
    const before = assetCount();
    const again = await save(c, `${base}/other`);
    await processBookmark(again);
    assert.equal(assetCount(), before + 1, 'only a new cover');
    assert.equal((await c.get(`/api/bookmarks/${again}`)).data.favicon, b.favicon);

    // The icon is removed with the last bookmark that uses it.
    await c.post('/api/bookmarks/bulk', { ids: [id, again], action: 'delete' });
    assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM favicons')!.n, 0);
    assert.equal((await c.get(b.favicon)).status, 404);
  });

  test('a broken link with a stray % in its URL gets a title and stops being pending', async () => {
    const c = await signedInClient();
    const id = await save(c, `${base}/deals/sale-50%-off`);
    await processBookmark(id);
    const b = (await c.get(`/api/bookmarks/${id}`)).data;
    assert.equal(b.fetchStatus, 'failed');
    assert.equal(b.broken, true);
    assert.equal(b.title, 'Sale 50% off');
  });

  test('results for a URL that was changed mid-fetch are thrown away', async () => {
    const c = await signedInClient();
    const id = await save(c, `${base}/slow`);
    const before = assetCount();
    armSlow();
    const fetching = processBookmark(id);
    await slowRequested;
    await c.patch(`/api/bookmarks/${id}`, { url: `${base}/article` });
    releaseSlow();
    await fetching;
    const b = (await c.get(`/api/bookmarks/${id}`)).data;
    assert.notEqual(b.title, 'Slow article');
    assert.equal(b.fetchStatus, 'pending', 'still waiting for the fetch of the new URL');
    assert.equal(assetCount(), before, 'the stale cover was not kept');
  });

  test('a bookmark deleted mid-fetch leaves no files behind', async () => {
    const c = await signedInClient();
    const id = await save(c, `${base}/slow`);
    const before = assetCount();
    armSlow();
    const fetching = processBookmark(id);
    await slowRequested;
    await c.post('/api/bookmarks/bulk', { ids: [id], action: 'delete' });
    releaseSlow();
    await fetching;
    assert.equal(assetCount(), before);
  });
});
