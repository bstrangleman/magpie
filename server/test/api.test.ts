import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { APP_CSP, createApp } from '../app.ts';
import { config } from '../config.ts';
import { run } from '../db/index.ts';
import { extensionBrowser, LOGIN_LIMITS, SIGNUP_LIMIT } from '../routes/auth.ts';
import { runScheduledBackups } from '../services/backups.ts';
import { Client, signedInClient } from './helpers.ts';

describe('auth', () => {
  test('first sign-up, login, logout', async () => {
    const c = new Client();
    assert.equal((await c.get('/api/me')).status, 401);
    const status = await c.get('/api/auth/status');
    assert.equal(status.data.signupsEnabled, true);

    const email = `owner-${Date.now()}@example.com`;
    const signup = await c.post('/api/auth/signup', { name: 'Owner', email, password: 'secret123' });
    assert.equal(signup.status, 201);
    assert.equal(signup.data.email, email);
    assert.equal((await c.get('/api/me')).status, 200);

    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/me')).status, 401);

    const bad = await c.post('/api/auth/login', { email, password: 'wrong-password' });
    assert.equal(bad.status, 401);
    const good = await c.post('/api/auth/login', { email: email.toUpperCase(), password: 'secret123' });
    assert.equal(good.status, 200);
    assert.equal((await c.get('/api/me')).status, 200);
  });

  test('rejects short passwords and duplicate emails', async () => {
    const c = new Client();
    assert.equal((await c.post('/api/auth/signup', { email: 'a@b.co', password: 'short' })).status, 400);
    await c.post('/api/auth/signup', { email: 'dupe@example.com', password: 'longenough' });
    assert.equal((await new Client().post('/api/auth/signup', { email: 'dupe@example.com', password: 'longenough' })).status, 400);
  });

  test('blocks cross-origin writes', async () => {
    const c = await signedInClient();
    c.headers.origin = 'https://evil.example';
    assert.equal((await c.post('/api/bookmarks', { url: 'https://example.com' })).status, 403);
  });

  test('token exchange for the browser extension', async () => {
    const c = new Client();
    const email = `ext-${Date.now()}@example.com`;
    await c.post('/api/auth/signup', { email, password: 'extension-pass' });
    // The extension's settings page signs in from its own origin, with no API key yet.
    const anon = new Client();
    anon.headers = { origin: 'chrome-extension://abcdefghijklmnop' };
    assert.equal((await anon.post('/api/auth/token', { email, password: 'wrong-password' })).status, 401);
    const tok = await anon.post('/api/auth/token', { email, password: 'extension-pass', name: 'Browser extension · Chrome' });
    assert.equal(tok.status, 201);
    assert.match(tok.data.key, /^mp_/);
    assert.equal(tok.data.user.email, email);
    assert.equal(anon.cookie, '', 'no session cookie is issued');

    // Extension requests send their own Origin; with an API key that's allowed…
    const ext = new Client();
    ext.headers = { authorization: `Bearer ${tok.data.key}`, origin: 'chrome-extension://abcdefghijklmnop' };
    assert.equal((await ext.post('/api/bookmarks', { url: 'https://from-extension.example' })).status, 201);
    // …but a cookie session from a foreign origin is still blocked.
    c.headers.origin = 'chrome-extension://abcdefghijklmnop';
    assert.equal((await c.post('/api/bookmarks', { url: 'https://csrf.example' })).status, 403);

    const keys = (await ext.get('/api/keys')).data;
    assert.deepEqual(keys.map((k: any) => k.name), ['Browser extension · Chrome']);
  });

  test('extension download matches the browser', () => {
    const firefox = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0';
    const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';
    assert.equal(extensionBrowser(undefined, firefox), 'firefox');
    assert.equal(extensionBrowser(undefined, edge), 'chrome');
    assert.equal(extensionBrowser(undefined, undefined), 'chrome');
    // ?browser= wins, so you can download the other package; unknown values fall back to the guess.
    assert.equal(extensionBrowser('chrome', firefox), 'chrome');
    assert.equal(extensionBrowser('firefox', edge), 'firefox');
    assert.equal(extensionBrowser('safari', firefox), 'firefox');
  });

  test('limits failed sign-ins per account, whatever address they claim', async () => {
    const email = `limited-${Date.now()}@example.com`;
    await new Client().post('/api/auth/signup', { email, password: 'right-password' });
    const login = (password: string, forwardedFor?: string) => {
      const c = new Client();
      if (forwardedFor) c.headers['x-forwarded-for'] = forwardedFor;
      return c.post('/api/auth/login', { email, password });
    };

    // Signing in successfully clears earlier failures.
    for (let i = 1; i < LOGIN_LIMITS.account; i++) assert.equal((await login('wrong')).status, 401);
    assert.equal((await login('right-password')).status, 200);

    // A made-up X-Forwarded-For doesn't get round the limit.
    for (let i = 0; i < LOGIN_LIMITS.account; i++) assert.equal((await login('wrong', `198.51.100.${i}`)).status, 401);
    assert.equal((await login('right-password', '203.0.113.1')).status, 429);
    assert.equal((await new Client().post('/api/auth/token', { email, password: 'right-password' })).status, 429);

    // Other accounts are unaffected.
    const otherEmail = `unlimited-${Date.now()}@example.com`;
    await new Client().post('/api/auth/signup', { email: otherEmail, password: 'right-password' });
    assert.equal((await new Client().post('/api/auth/login', { email: otherEmail, password: 'right-password' })).status, 200);
  });

  test('limits failed sign-ins and sign-ups per client address', async () => {
    const from = (ip: string) => Object.assign(new Client(), { ip });
    for (let i = 0; i < LOGIN_LIMITS.ip; i++) {
      assert.equal((await from('192.0.2.10').post('/api/auth/login', { email: `nobody${i}@example.com`, password: 'x' })).status, 401);
    }
    assert.equal((await from('192.0.2.10').post('/api/auth/login', { email: 'someone@example.com', password: 'x' })).status, 429);
    assert.equal((await from('192.0.2.11').post('/api/auth/login', { email: 'someone@example.com', password: 'x' })).status, 401);

    for (let i = 0; i < SIGNUP_LIMIT.max; i++) {
      assert.equal((await from('192.0.2.20').post('/api/auth/signup', { email: `burst${i}-${Date.now()}@example.com`, password: 'longenough' })).status, 201);
    }
    assert.equal((await from('192.0.2.20').post('/api/auth/signup', { email: `burst-x-${Date.now()}@example.com`, password: 'longenough' })).status, 429);
    assert.equal((await from('192.0.2.21').post('/api/auth/signup', { email: `burst-y-${Date.now()}@example.com`, password: 'longenough' })).status, 201);
  });

  test('two sign-ups with the same email at once: one succeeds, one is told why', async () => {
    const email = `race-${Date.now()}@example.com`;
    const results = await Promise.all([1, 2].map(() => new Client().post('/api/auth/signup', { email, password: 'longenough' })));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
  });

  test('API keys authenticate requests', async () => {
    const c = await signedInClient();
    const key = await c.post('/api/keys', { name: 'cli' });
    assert.equal(key.status, 201);
    assert.match(key.data.key, /^mp_/);

    const api = new Client();
    api.headers.authorization = `Bearer ${key.data.key}`;
    const created = await api.post('/api/bookmarks', { url: 'example.org/from-api' });
    assert.equal(created.status, 201);
    assert.equal(created.data.url, 'https://example.org/from-api');

    await c.del(`/api/keys/${key.data.id}`);
    assert.equal((await api.get('/api/bookmarks')).status, 401);
  });
});

describe('bookmarks', () => {
  test('create, update, tag, search, list', async () => {
    const c = await signedInClient();
    const col = (await c.post('/api/collections', { name: 'Photography', icon: '📷' })).data;
    const b = await c.post('/api/bookmarks', {
      url: 'https://example.com/lenses?utm_source=x',
      title: 'A guide to prime lenses',
      collectionId: col.id,
      tags: ['gear', '#Cameras', 'gear'],
    });
    assert.equal(b.status, 201);
    assert.deepEqual(b.data.tags, ['Cameras', 'gear']);
    assert.equal(b.data.site, 'example.com');

    const note = await c.post('/api/bookmarks', { note: 'Remember to buy a **tripod**', title: 'Shopping' });
    assert.equal(note.data.type, 'note');

    assert.equal((await c.post('/api/bookmarks', { url: 'javascript:alert(1)' })).status, 400);
    assert.equal((await c.post('/api/bookmarks', {})).status, 400);

    const upd = await c.patch(`/api/bookmarks/${b.data.id}`, { note: 'Great for portraits', favorite: true, tags: ['gear'] });
    assert.equal(upd.data.favorite, true);
    assert.deepEqual(upd.data.tags, ['gear']);

    const inCol = await c.get(`/api/bookmarks?view=collection&collection=${col.id}`);
    assert.equal(inCol.data.total, 1);

    for (const [q, expected] of [
      ['prime', 1],
      ['lens', 1], // porter stemming + prefix
      ['portraits', 1], // note text
      ['tripod', 1],
      ['#gear', 1],
      ['#cameras', 0],
      ['is:fav', 1],
      ['type:note', 1],
      ['site:example.com prime', 1],
      ['"prime lenses"', 1],
      ['nothing-matches-this', 0],
      ['(unbalanced AND "quote', 0],
    ] as const) {
      const r = await c.get(`/api/bookmarks?q=${encodeURIComponent(q)}`);
      assert.equal(r.status, 200, q);
      assert.equal(r.data.total, expected, `query ${q}`);
    }

    const sidebar = (await c.get('/api/sidebar')).data;
    assert.equal(sidebar.counts.all, 2);
    assert.equal(sidebar.counts.unsorted, 1);
    assert.equal(sidebar.counts.filters.favorites, 1);
    assert.equal(sidebar.counts.filters.notes, 2);
    assert.equal(sidebar.collections.find((x: any) => x.id === col.id).count, 1);
    assert.deepEqual(
      sidebar.tags.map((t: any) => [t.name, t.count]),
      [['gear', 1]],
      'unused tags are pruned',
    );
  });

  test('users cannot see each other’s data', async () => {
    const a = await signedInClient('A');
    const b = await signedInClient('B');
    const mine = (await a.post('/api/bookmarks', { url: 'https://private.example' })).data;
    const col = (await a.post('/api/collections', { name: 'Secret' })).data;
    assert.equal((await b.get(`/api/bookmarks/${mine.id}`)).status, 404);
    assert.equal((await b.patch(`/api/bookmarks/${mine.id}`, { title: 'x' })).status, 404);
    assert.equal((await b.post('/api/bookmarks', { url: 'https://x.example', collectionId: col.id })).status, 400);
    assert.equal((await b.post('/api/bookmarks/bulk', { ids: [mine.id], action: 'delete' })).data.count, 0);
    assert.equal((await b.get('/api/bookmarks')).data.total, 0);
    assert.equal((await a.get(`/api/bookmarks/${mine.id}`)).status, 200);
  });

  test('manual ordering, bulk move, trash and restore', async () => {
    const c = await signedInClient();
    const col = (await c.post('/api/collections', { name: 'Reading' })).data;
    const ids: number[] = [];
    for (const n of [1, 2, 3]) ids.push((await c.post('/api/bookmarks', { url: `https://site${n}.example`, collectionId: col.id })).data.id);
    const order = async () =>
      (await c.get(`/api/bookmarks?view=collection&collection=${col.id}&sort=manual`)).data.items.map((b: any) => b.id);
    assert.deepEqual(await order(), [ids[2], ids[1], ids[0]], 'newest first');

    await c.post(`/api/bookmarks/${ids[2]}/reorder`, { prevId: ids[0], nextId: null });
    assert.deepEqual(await order(), [ids[1], ids[0], ids[2]]);
    await c.post(`/api/bookmarks/${ids[2]}/reorder`, { prevId: ids[1], nextId: ids[0] });
    assert.deepEqual(await order(), [ids[1], ids[2], ids[0]]);
    // Repeated bisection eventually renumbers rather than losing precision.
    for (let i = 0; i < 60; i++) {
      await c.post(`/api/bookmarks/${ids[i % 2 ? 2 : 0]}/reorder`, { prevId: ids[1], nextId: ids[i % 2 ? 0 : 2] });
    }
    assert.equal((await order()).length, 3);

    const other = (await c.post('/api/collections', { name: 'Other' })).data;
    await c.post('/api/bookmarks/bulk', { ids: [ids[0], ids[1]], action: 'move', collectionId: other.id });
    assert.equal((await c.get(`/api/bookmarks?view=collection&collection=${other.id}`)).data.total, 2);

    await c.post('/api/bookmarks/bulk', { ids: [ids[0]], action: 'trash' });
    assert.equal((await c.get('/api/bookmarks?view=trash')).data.total, 1);
    await c.post('/api/bookmarks/bulk', { ids: [ids[0]], action: 'restore' });
    assert.equal((await c.get('/api/bookmarks?view=trash')).data.total, 0);

    // Deleting a collection trashes its bookmarks and removes nested collections.
    const child = (await c.post('/api/collections', { name: 'Child', parentId: other.id })).data;
    await c.post('/api/bookmarks', { url: 'https://nested.example', collectionId: child.id });
    await c.del(`/api/collections/${other.id}`);
    const sidebar = (await c.get('/api/sidebar')).data;
    assert.equal(sidebar.collections.some((x: any) => x.id === child.id), false);
    assert.equal(sidebar.counts.trash, 3);

    const emptied = await c.del('/api/trash');
    assert.equal(emptied.data.count, 3);
    assert.equal((await c.get('/api/sidebar')).data.counts.all, 1);
  });

  test('duplicates and untagged filters', async () => {
    const c = await signedInClient();
    await c.post('/api/bookmarks', { url: 'https://www.dupe.example/page/' });
    await c.post('/api/bookmarks', { url: 'https://dupe.example/page?utm_campaign=z#top' });
    await c.post('/api/bookmarks', { url: 'https://unique.example', tags: ['x'] });
    assert.equal((await c.get('/api/bookmarks?view=filter&filter=duplicates')).data.total, 2);
    assert.equal((await c.get('/api/bookmarks?view=filter&filter=untagged')).data.total, 2);
    assert.equal((await c.get('/api/bookmarks?view=tag&tag=X')).data.total, 1);
    const lookup = await c.get(`/api/bookmarks/lookup?url=${encodeURIComponent('dupe.example/page')}`);
    assert.ok(lookup.data.bookmark);
  });
});

describe('search and lists', () => {
  test('excluded words and phrases, and literal site names', async () => {
    const c = await signedInClient();
    await c.post('/api/bookmarks', { url: 'https://a.example', title: 'Async runtime internals in Rust', tags: ['rust'] });
    await c.post('/api/bookmarks', { url: 'https://b.example', title: 'Rust ownership explained', tags: ['rust'] });
    await c.post('/api/bookmarks', { url: 'https://sub.myxsite.example', title: 'Something else' });
    const total = async (q: string) => (await c.get(`/api/bookmarks?q=${encodeURIComponent(q)}`)).data.total;
    assert.equal(await total('rust -"async runtime"'), 1);
    assert.equal(await total('-"async runtime"'), 2, 'an exclusion on its own still applies');
    assert.equal(await total('#rust -ownership'), 1);
    assert.equal(await total('rust -async-runtime'), 1);
    assert.equal(await total('site:myxsite.example'), 1);
    assert.equal(await total('site:my_site.example'), 0, '_ is a character, not a wildcard');
  });

  test('before:/after: use the time zone the app sends', async () => {
    const c = await signedInClient();
    const b = (await c.post('/api/bookmarks', { url: 'https://tz.example' })).data;
    // Saved at 23:30 UTC on 1 March: already 2 March in Tokyo.
    run('UPDATE bookmarks SET created_at = ? WHERE id = ?', Date.parse('2024-03-01T23:30:00Z'), b.id);
    const total = async (q: string, tz: string) => (await c.get(`/api/bookmarks?q=${encodeURIComponent(q)}&tz=${tz}`)).data.total;
    assert.equal(await total('after:2024-03-02', 'UTC'), 0);
    assert.equal(await total('after:2024-03-02', 'Asia/Tokyo'), 1);
  });

  test('select all returns every matching id in list order', async () => {
    const c = await signedInClient();
    const col = (await c.post('/api/collections', { name: 'Many' })).data;
    for (let i = 0; i < 5; i++) await c.post('/api/bookmarks', { url: `https://many${i}.example`, collectionId: col.id });
    await c.post('/api/bookmarks', { url: 'https://elsewhere.example' });
    const query = `view=collection&collection=${col.id}&sort=manual`;
    const listed = (await c.get(`/api/bookmarks?${query}&limit=2`)).data;
    const ids = (await c.get(`/api/bookmarks/ids?${query}`)).data.ids;
    assert.equal(ids.length, 5);
    assert.deepEqual(ids.slice(0, 2), listed.items.map((b: any) => b.id));
  });

  test('dropping after the last loaded bookmark lands before the next one', async () => {
    const c = await signedInClient();
    const col = (await c.post('/api/collections', { name: 'Order' })).data;
    const ids: number[] = [];
    for (const n of [1, 2, 3]) ids.push((await c.post('/api/bookmarks', { url: `https://order${n}.example`, collectionId: col.id })).data.id);
    const order = async () => (await c.get(`/api/bookmarks?view=collection&collection=${col.id}&sort=manual`)).data.items.map((b: any) => b.id);
    assert.deepEqual(await order(), [ids[2], ids[1], ids[0]]);
    // The client has only loaded the first bookmark, so it doesn't know what comes next.
    await c.post(`/api/bookmarks/${ids[0]}/reorder`, { prevId: ids[2], nextId: null });
    assert.deepEqual(await order(), [ids[2], ids[0], ids[1]]);
  });
});

describe('collections', () => {
  test('nesting, moving, cycles and groups', async () => {
    const c = await signedInClient();
    const groups = (await c.get('/api/sidebar')).data.groups;
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, 'My Collections');

    const a = (await c.post('/api/collections', { name: 'A' })).data;
    const b = (await c.post('/api/collections', { name: 'B', parentId: a.id })).data;
    const cc = (await c.post('/api/collections', { name: 'C', parentId: b.id })).data;
    assert.equal(b.groupId, null);

    assert.equal((await c.post(`/api/collections/${a.id}/move`, { parentId: cc.id })).status, 400, 'no cycles');
    const moved = await c.post(`/api/collections/${cc.id}/move`, { parentId: null });
    assert.equal(moved.data.parentId, null);
    assert.equal(moved.data.groupId, groups[0].id);

    const g2 = (await c.post('/api/groups', { name: 'Work' })).data;
    await c.post(`/api/collections/${a.id}/move`, { parentId: null, groupId: g2.id });
    assert.equal((await c.del(`/api/groups/${g2.id}`)).status, 200);
    const after = (await c.get('/api/sidebar')).data;
    assert.equal(after.collections.find((x: any) => x.id === a.id).groupId, groups[0].id);
    assert.equal((await c.del(`/api/groups/${groups[0].id}`)).status, 400, "can't delete the last group");
  });

  test('tags rename and merge', async () => {
    const c = await signedInClient();
    await c.post('/api/bookmarks', { url: 'https://one.example', tags: ['recipes'] });
    await c.post('/api/bookmarks', { url: 'https://two.example', tags: ['recipe'] });
    let tags = (await c.get('/api/tags')).data;
    const plural = tags.find((t: any) => t.name === 'recipes');
    await c.patch(`/api/tags/${plural.id}`, { name: 'Recipe' });
    tags = (await c.get('/api/tags')).data;
    assert.deepEqual(tags.map((t: any) => [t.name, t.count]), [['recipe', 2]]);
    assert.equal((await c.get('/api/bookmarks?q=%23recipe')).data.total, 2);
  });
});

describe('import / export / backups', () => {
  test('round-trips through every format', async () => {
    const c = await signedInClient();
    const col = (await c.post('/api/collections', { name: 'Study', icon: '📚' })).data;
    const sub = (await c.post('/api/collections', { name: 'Photo & Video', parentId: col.id })).data;
    await c.post('/api/bookmarks', { url: 'https://a.example', title: 'Alpha <b>', tags: ['t1', 't2'], collectionId: sub.id, favorite: true });
    await c.post('/api/bookmarks', { url: 'https://b.example', title: 'Beta, "quoted"', note: 'line1\nline2' });

    const html = await c.get('/api/export?format=html');
    assert.match(html.res.headers.get('content-disposition')!, /attachment/);
    assert.match(html.data, /<H3>Photo &amp; Video<\/H3>/);
    assert.match(html.data, /TAGS="t1,t2"/);
    const csv = await c.get('/api/export?format=csv');
    assert.match(csv.data, /"Beta, ""quoted"""/);
    const json = await c.get('/api/export?format=json');
    assert.equal(json.data.bookmarks.length, 2);

    for (const [name, body, type] of [
      ['export.html', html.data, 'text/html'],
      ['export.csv', csv.data, 'text/csv'],
      ['export.json', JSON.stringify(json.data), 'application/json'],
    ] as const) {
      const fresh = await signedInClient();
      const form = new FormData();
      form.set('file', new File([body], name, { type }));
      const r = await fresh.post('/api/import', form);
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.created, 2, name);
      const sidebar = (await fresh.get('/api/sidebar')).data;
      const names = sidebar.collections.map((x: any) => x.name).sort();
      assert.deepEqual(names, ['Photo & Video', 'Study'], name);
      const study = sidebar.collections.find((x: any) => x.name === 'Study');
      assert.equal(sidebar.collections.find((x: any) => x.name === 'Photo & Video').parentId, study.id);
      if (name.endsWith('json')) assert.equal(study.icon, '📚');
      const alpha = (await fresh.get('/api/bookmarks?q=alpha')).data.items[0];
      assert.deepEqual(alpha.tags, ['t1', 't2'], name);
      if (!name.endsWith('csv')) assert.equal(alpha.favorite, true, name);

      // Importing again skips duplicates.
      const again = await fresh.post('/api/import', form);
      assert.equal(again.data.created, 0);
      assert.equal(again.data.skipped, 2);
    }

    const backup = await c.post('/api/backups');
    assert.equal(backup.data.bookmarkCount, 2);
    assert.equal((await c.get('/api/backups')).data.length, 1);
    const dl = await c.get(`/api/backups/${backup.data.id}/download?format=csv`);
    assert.match(dl.data, /a\.example/);
    assert.equal((await c.del(`/api/backups/${backup.data.id}`)).status, 200);
  });

  test('uploads are stored and served safely', async () => {
    const c = await signedInClient();
    const form = new FormData();
    form.set('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'diagram.png', { type: 'image/png' }));
    const up = await c.post('/api/bookmarks/upload', form);
    assert.equal(up.status, 201);
    assert.equal(up.data.type, 'image');
    assert.equal(up.data.cover, up.data.file.url);
    const file = await c.get(up.data.file.url);
    assert.equal(file.res.headers.get('content-type'), 'image/png');

    const svg = new FormData();
    svg.set('file', new File(['<svg onload="alert(1)"/>'], 'x.svg', { type: 'image/svg+xml' }));
    const s = await c.post('/api/bookmarks/upload', svg);
    const served = await c.get(s.data.file.url);
    assert.equal(served.res.headers.get('content-type'), 'application/octet-stream');
    assert.match(served.res.headers.get('content-disposition')!, /^attachment/);

    const other = await signedInClient();
    assert.equal((await other.get(up.data.file.url)).status, 404);
  });
});

describe('files and pages', () => {
  test('uploads support byte ranges', async () => {
    const c = await signedInClient();
    const form = new FormData();
    form.set('file', new File([new TextEncoder().encode('0123456789')], 'clip.mp4', { type: 'video/mp4' }));
    const url = (await c.post('/api/bookmarks/upload', form)).data.file.url;
    const fetchRange = (range?: string) => {
      c.headers = range ? { range } : {};
      return c.get(url);
    };
    const whole = await fetchRange();
    assert.equal(whole.status, 200);
    assert.equal(whole.res.headers.get('accept-ranges'), 'bytes');
    assert.equal(String(whole.data), '0123456789');

    const part = await fetchRange('bytes=2-5');
    assert.equal(part.status, 206);
    assert.equal(part.res.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(part.res.headers.get('content-length'), '4');
    assert.equal(String(part.data), '2345', 'the test client parses this as JSON, hence String()');

    assert.equal(String((await fetchRange('bytes=7-')).data), '789');
    assert.equal(String((await fetchRange('bytes=-3')).data), '789');
    assert.equal((await fetchRange('bytes=5-99')).res.headers.get('content-range'), 'bytes 5-9/10');
    const bad = await fetchRange('bytes=20-');
    assert.equal(bad.status, 416);
    assert.equal(bad.res.headers.get('content-range'), 'bytes */10');
    assert.equal((await fetchRange('bytes=0-1,4-5')).status, 200, 'several ranges: the whole file');
  });

  test('the web app: CSP on pages, 404 for missing build files', async () => {
    const dist = fs.mkdtempSync(path.join(config.dataDir, 'web-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Magpie</title>');
    fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
    const web = createApp({ webDist: dist });

    const page = await web.request('http://localhost/collection/3');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('content-security-policy'), APP_CSP);
    const root = await web.request('http://localhost/');
    assert.equal(root.headers.get('content-security-policy'), APP_CSP);

    const script = await web.request('http://localhost/assets/app-abc123.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('cache-control')!, /immutable/);
    const missing = await web.request('http://localhost/assets/app-old999.js');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('cache-control'), null, 'a miss must not be cached');

    const api = await web.request('http://localhost/api/auth/status');
    assert.equal(api.headers.get('content-security-policy'), null);
  });
});

describe('scheduled backups', () => {
  test('notice any change, including ones that leave timestamps alone', async () => {
    const c = await signedInClient();
    const me = (await c.get('/api/me')).data;
    const a = (await c.post('/api/bookmarks', { url: 'https://keep.example' })).data;
    await c.post('/api/bookmarks', { url: 'https://other.example' });
    const autos = async () => (await c.get('/api/backups')).data.filter((b: any) => b.automatic).length;
    const aDayLater = () => run('UPDATE backups SET created_at = created_at - ? WHERE user_id = ?', 2 * 86_400_000, me.id);

    runScheduledBackups();
    assert.equal(await autos(), 1);
    runScheduledBackups();
    assert.equal(await autos(), 1, 'at most one a day');

    // Moving a bookmark to the Trash doesn't touch updated_at, but it is a change.
    aDayLater();
    await c.del(`/api/bookmarks/${a.id}`);
    runScheduledBackups();
    assert.equal(await autos(), 2);

    // Nothing changed since: no new backup.
    aDayLater();
    runScheduledBackups();
    assert.equal(await autos(), 2);
  });
});

describe('settings', () => {
  test('merges per-view preferences', async () => {
    const c = await signedInClient();
    await c.patch('/api/settings', { theme: 'dark', views: { all: { view: 'cards' } } });
    await c.patch('/api/settings', { views: { all: { sort: 'title' }, 'c:1': { view: 'headlines' } } });
    let s = (await c.get('/api/me')).data.settings;
    assert.equal(s.theme, 'dark');
    assert.deepEqual(s.views.all, { view: 'cards', sort: 'title' });
    await c.patch('/api/settings', { views: { 'c:1': null } });
    s = (await c.get('/api/me')).data.settings;
    assert.equal(s.views['c:1'], undefined);
    assert.equal((await c.patch('/api/settings', { theme: 'neon' })).status, 400);
  });
});
