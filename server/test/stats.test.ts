import './env.ts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { run } from '../db/index.ts';
import { getStats } from '../services/stats.ts';
import { Client, signedInClient } from './helpers.ts';

const at = (iso: string) => Date.parse(iso);

describe('statistics', () => {
  test('counts, breakdowns and sources', async () => {
    const c = await signedInClient();
    const col = (await c.post('/api/collections', { name: 'Reading', icon: '📖' })).data;
    await c.post('/api/bookmarks', { url: 'https://a.example/1', tags: ['x', 'y'], collectionId: col.id, favorite: true });
    await c.post('/api/bookmarks', { url: 'https://a.example/2', tags: ['x'], collectionId: col.id });
    await c.post('/api/bookmarks', { url: 'https://b.example/', source: 'bookmarklet' });
    await c.post('/api/bookmarks', { note: 'A thought' });

    const key = (await c.post('/api/keys', { name: 'test' })).data.key;
    const ext = new Client();
    ext.headers = { authorization: `Bearer ${key}`, 'x-magpie-client': 'extension' };
    await ext.post('/api/bookmarks', { url: 'https://c.example/' });
    const api = new Client();
    api.headers = { authorization: `Bearer ${key}` };
    // API clients can't claim to be the bookmarklet.
    await api.post('/api/bookmarks', { url: 'https://d.example/', source: 'bookmarklet' });
    const trashed = (await c.post('/api/bookmarks', { url: 'https://gone.example/' })).data;
    await c.del(`/api/bookmarks/${trashed.id}`);

    const s = (await c.get('/api/stats?tz=Australia/Sydney')).data;
    assert.equal(s.timeZone, 'Australia/Sydney');
    assert.equal(s.totals.bookmarks, 6);
    assert.equal(s.totals.favorites, 1);
    assert.equal(s.totals.collections, 1);
    assert.equal(s.totals.tags, 2);
    assert.equal(s.totals.notes, 1);
    assert.deepEqual(
      Object.fromEntries(s.sources.map((x: any) => [x.source, x.count])),
      { web: 3, bookmarklet: 1, extension: 1, api: 1 },
    );
    assert.deepEqual(s.topSites[0], { site: 'a.example', count: 2, favicon: null });
    assert.deepEqual(s.topTags.map((t: any) => [t.name, t.count]), [['x', 2], ['y', 1]]);
    assert.deepEqual(s.topCollections.map((x: any) => [x.name, x.count]), [['Reading', 2]]);
    assert.equal(s.types.find((t: any) => t.type === 'note').count, 1);
    assert.equal(s.types.find((t: any) => t.type === 'link').count, 5);
    assert.equal(s.health.trash, 1);
    assert.equal(s.activity.thisYear, 6);
    assert.ok(s.activity.days.length >= 365 && s.activity.days.length <= 371, '53 weeks up to today');
    assert.equal(new Date(`${s.activity.days[0].date}T00:00:00Z`).getUTCDay(), 1, 'starts on a Monday');
    assert.equal(s.activity.days.at(-1).count, 6, 'everything was saved today');
    assert.equal(s.activity.byWeekday.reduce((a: number, b: number) => a + b, 0), 6);

    assert.equal((await c.get('/api/stats?tz=Not/AZone')).data.timeZone, 'UTC');
  });

  test('activity buckets follow the time zone', async () => {
    const c = await signedInClient();
    const me = (await c.get('/api/me')).data;
    // Wednesday 2026-10-21 23:30 UTC is Thursday 10:30 in Sydney (UTC+11).
    const b = (await c.post('/api/bookmarks', { url: 'https://tz.example/' })).data;
    run('UPDATE bookmarks SET created_at = ? WHERE id = ?', at('2026-10-21T23:30:00Z'), b.id);
    const old = (await c.post('/api/bookmarks', { url: 'https://old.example/' })).data;
    run('UPDATE bookmarks SET created_at = ? WHERE id = ?', at('2025-03-01T12:00:00Z'), old.id);

    const now = at('2026-10-25T01:00:00Z'); // Sunday 25 Oct, 12:00 in Sydney
    const utc = getStats(me.id, 'UTC', now);
    assert.equal(utc.activity.byWeekday[2], 1, 'Wednesday in UTC');
    assert.equal(utc.activity.byHour[23], 1);

    const syd = getStats(me.id, 'Australia/Sydney', now);
    assert.equal(syd.activity.byWeekday[3], 1, 'Thursday in Sydney');
    assert.equal(syd.activity.byHour[10], 1);
    assert.equal(syd.activity.thisWeek, 1, 'Mon 19 – Sun 25 Oct');
    assert.equal(syd.activity.thisMonth, 1);
    assert.equal(syd.activity.thisYear, 1);
    assert.equal(syd.activity.lastYear, 1);
    assert.equal(syd.activity.days[0]!.date, '2025-10-20', '53 weeks back, starting on a Monday');
    assert.equal(syd.activity.days.at(-1)!.date, '2026-10-25');
    assert.equal(syd.activity.days.find((d) => d.date === '2026-10-22')!.count, 1);
    assert.deepEqual(syd.activity.months.map((m) => m.month).slice(0, 2), ['2025-11', '2025-12']);
    assert.equal(syd.activity.months.at(-1)!.month, '2026-10');
    assert.equal(syd.firstSavedAt, at('2025-03-01T12:00:00Z'));
  });

  test('stats require sign-in', async () => {
    assert.equal((await new Client().get('/api/stats')).status, 401);
  });
});
