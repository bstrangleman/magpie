import './env.ts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseQuery } from '../lib/search.ts';
import { normalizeUrl, parseBookmarkUrl } from '../lib/url.ts';
import { extractInWorker } from '../services/extract-pool.ts';
import { discogsMetadata, discogsResource } from '../services/extract.ts';
import { BlockedError, extractMetadata, isBlocked, safeFetch, safeLookup, sniffImage, titleFromUrl } from '../services/fetcher.ts';
import { parseCsv, parseImport, parseNetscape, toCsv, type ExportData } from '../services/io.ts';

describe('search query parser', () => {
  test('operators and free text', () => {
    const q = parseQuery('react #frontend -#old is:fav type:video site:www.youtube.com "exact phrase" after:2024-01-01');
    assert.deepEqual(q.tags, ['frontend']);
    assert.deepEqual(q.excludeTags, ['old']);
    assert.equal(q.favorite, true);
    assert.deepEqual(q.types, ['video']);
    assert.deepEqual(q.sites, ['youtube.com']);
    assert.equal(q.after, Date.parse('2024-01-01'));
    assert.equal(q.match, '"react"* "exact phrase"');
  });

  test('quoted tags and negation', () => {
    const q = parseQuery('tag:"read later" -spam hello');
    assert.deepEqual(q.tags, ['read later']);
    assert.equal(q.match, '"hello"*');
    assert.equal(q.exclude, '"spam"*', 'a leading exclusion is kept, not dropped');
    assert.deepEqual(parseQuery('hello -spam'), { ...parseQuery('hello'), exclude: '"spam"*' });
  });

  test('excluded phrases are excluded, not matched', () => {
    const q = parseQuery('rust -"async runtime"');
    assert.equal(q.match, '"rust"*');
    assert.equal(q.exclude, '"async runtime"');
    assert.equal(parseQuery('rust -tokio-console').exclude, '"tokio console"', 'a hyphenated word is a phrase');
    assert.equal(parseQuery('-a -"b c"').exclude, '"a"* OR "b c"');
    assert.equal(parseQuery('-a -"b c"').match, null);
  });

  test('dates are days in the given time zone', () => {
    assert.equal(parseQuery('after:2024-01-01').after, Date.parse('2024-01-01T00:00:00Z'), 'UTC by default');
    assert.equal(parseQuery('before:2024-01-01', 'Australia/Sydney').before, Date.parse('2023-12-31T13:00:00Z'));
    // Either side of New York's DST changes: midnight is UTC-5 in March, UTC-4 in early November.
    assert.equal(parseQuery('after:2024-03-10', 'America/New_York').after, Date.parse('2024-03-10T05:00:00Z'));
    assert.equal(parseQuery('after:2024-11-03', 'America/New_York').after, Date.parse('2024-11-03T04:00:00Z'));
    assert.equal(parseQuery('after:2024-06-01T12:00:00Z', 'Asia/Tokyo').after, Date.parse('2024-06-01T12:00:00Z'), 'full timestamps are used as given');
  });

  test('punctuation never produces invalid FTS syntax', () => {
    assert.equal(parseQuery('c++ (AND) "').match, '"c"* "AND"*');
    assert.equal(parseQuery('   ').match, null);
  });
});

describe('urls', () => {
  test('parse and normalise', () => {
    assert.equal(parseBookmarkUrl('example.com/a')?.href, 'https://example.com/a');
    assert.equal(parseBookmarkUrl('ftp://example.com'), null);
    assert.equal(parseBookmarkUrl('javascript:alert(1)'), null);
    assert.equal(normalizeUrl('https://WWW.Example.com/Path/?b=2&utm_source=x&a=1#frag'), 'example.com/path?a=1&b=2');
  });
});

describe('safe fetching', () => {
  test('refuses private hosts by name and by address', async () => {
    for (const url of ['http://localhost./', 'http://app.localhost/', 'http://[::ffff:127.0.0.1]/', 'http://10.1.2.3/', 'http://0x7f.1/']) {
      await assert.rejects(safeFetch(url, { maxBytes: 100, accept: '*/*' }), BlockedError, url);
    }
  });

  test('checks addresses when connecting, after the DNS lookup', async () => {
    // "localhost" resolves through the hosts file; safeLookup is what the connection uses.
    const err = await new Promise<Error | null>((resolve) => safeLookup('localhost', { all: true }, (e) => resolve(e)));
    assert.ok(err instanceof BlockedError);
    assert.ok(isBlocked(new TypeError('fetch failed', { cause: err })), 'recognised when fetch() wraps it');
  });

  test('recognises raster images by their bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    assert.equal(sniffImage(png), 'image/png');
    assert.equal(sniffImage(new Uint8Array([0, 0, 1, 0, 1, 0])), 'image/x-icon');
    assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(sniffImage(new TextEncoder().encode('<!doctype html>')), null);
  });
});

describe('importers', () => {
  test('netscape with nested folders, tags, notes', () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 ADD_DATE="1">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://a.example" ADD_DATE="1700000000" TAGS="x,y">A &amp; B</A>
    <DD>Some notes
    <DT><H3>Nested</H3>
    <DL><p>
      <DT><A HREF="https://b.example" DATA-IMPORTANT="true">B</A>
    </DL><p>
    <DT><A HREF="javascript:void(0)">Bookmarklet</A>
  </DL><p>
  <DT><A HREF="https://c.example">C</A>
</DL><p>`;
    const r = parseNetscape(html);
    assert.equal(r.items.length, 3);
    assert.deepEqual(r.items[0], {
      url: 'https://a.example',
      title: 'A & B',
      tags: ['x', 'y'],
      createdAt: 1700000000000,
      favorite: false,
      cover: undefined,
      folder: ['Bookmarks bar'],
      description: 'Some notes',
    });
    assert.deepEqual(r.items[1]!.folder, ['Bookmarks bar', 'Nested']);
    assert.equal(r.items[1]!.favorite, true);
    assert.deepEqual(r.items[2]!.folder, []);
    assert.deepEqual(r.folders.map((f) => f.path.join('/')), ['Bookmarks bar', 'Bookmarks bar/Nested']);
  });

  test('csv cells that look like formulas are escaped on export and restored on import', () => {
    const data: ExportData = {
      magpie: 1,
      exportedAt: '',
      groups: [],
      collections: [],
      bookmarks: [
        { url: 'https://f.example', title: '=HYPERLINK("https://evil.example","x")', description: '-5 things', note: '', type: 'link', collectionId: null, tags: ['@home'], favorite: false, cover: null, createdAt: 0 },
      ],
    };
    const csv = toCsv(data);
    assert.match(csv, /"'=HYPERLINK\(""https/);
    assert.match(csv, /,'-5 things,/);
    const item = parseCsv(csv).items[0]!;
    assert.equal(item.title, data.bookmarks[0]!.title);
    assert.equal(item.description, '-5 things');
    assert.deepEqual(item.tags, ['@home']);
  });

  test('pocket-style csv', () => {
    const r = parseCsv('title,url,time_added,tags,status\n"Hello, world",https://p.example,1600000000,a|b,unread\n');
    assert.equal(r.items[0]!.title, 'Hello, world');
    assert.deepEqual(r.items[0]!.tags, ['a', 'b']);
    assert.equal(r.items[0]!.createdAt, 1600000000000);
  });

  test('bookmarks json with lists', () => {
    const r = parseImport(
      'bookmarks.json',
      JSON.stringify({
        bookmarks: [
          { createdAt: 1700000000, title: 'Link', tags: ['t'], lists: ['l2'], content: { type: 'link', url: 'https://k.example' }, note: 'n' },
          { createdAt: 1700000001, title: null, tags: [], content: { type: 'text', text: 'A text note' }, note: null },
        ],
        lists: [
          { id: 'l1', name: 'Parent', icon: '🚀', type: 'manual', parentId: null },
          { id: 'l2', name: 'Child', icon: '📁', type: 'manual', parentId: 'l1' },
          { id: 'l3', name: 'Smart', icon: '🔎', type: 'smart', parentId: null },
        ],
      }),
    );
    assert.equal(r.format, 'Bookmarks JSON');
    assert.deepEqual(r.items[0]!.folder, ['Parent', 'Child']);
    assert.equal(r.items[1]!.note, 'A text note');
    assert.equal(r.folders.length, 2);
  });
});

describe('metadata extraction', () => {
  test('reads open graph tags and readable content', () => {
    const paragraph = '<p>Photography is the art of capturing light. '.repeat(40) + '</p>';
    const html = `<html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="Prime Lenses Explained">
      <meta name="description" content="Why primes are sharp.">
      <meta property="og:image" content="/img/cover.jpg">
      <meta property="og:type" content="article">
      <link rel="shortcut icon" href="/fav.png">
    </head><body><nav>Menu</nav><article><h1>Prime Lenses Explained</h1>${paragraph}
      <p><a href="/next">Next</a> <img src="/img/inline.jpg"> <script>alert(1)</script></p></article></body></html>`;
    const m = extractMetadata(html, 'https://photo.example/posts/primes');
    assert.equal(m.title, 'Prime Lenses Explained');
    assert.equal(m.description, 'Why primes are sharp.');
    assert.equal(m.image, 'https://photo.example/img/cover.jpg');
    assert.equal(m.favicon, 'https://photo.example/fav.png');
    assert.equal(m.type, 'article');
    assert.ok(m.contentText?.includes('capturing light'));
    assert.ok(!m.contentHtml?.includes('<script'));
    assert.ok(m.contentHtml?.includes('href="https://photo.example/next"'));
  });

  test('derives a fallback title from the URL', () => {
    assert.equal(titleFromUrl('https://www.seriouseats.com/the-food-lab-complete-guide-to-sous-vide-steak'), 'The food lab complete guide to sous vide steak');
    assert.equal(titleFromUrl('https://example.com/docs/getting_started.html'), 'Getting started');
    assert.equal(titleFromUrl('https://www.unsplash.com/'), 'Unsplash.com');
    assert.equal(titleFromUrl('https://news.example.com/item/12345'), 'News.example.com');
    // A stray % isn't a valid escape; this used to throw, leaving the bookmark "pending" forever.
    assert.equal(titleFromUrl('https://example.com/sale-50%-off'), 'Sale 50% off');
  });

  test('parses pages in a worker thread with the same results', async () => {
    const html = `<html><head><title>T</title><meta property="og:image" content="/c.jpg"></head><body><article>${'<p>Words and more words. '.repeat(60)}</p></article></body></html>`;
    assert.deepEqual(await extractInWorker(html, 'https://w.example/a'), extractMetadata(html, 'https://w.example/a'));
  });

  test('detects video hosts and falls back to /favicon.ico', () => {
    const m = extractMetadata('<html><head><title>Clip</title></head><body></body></html>', 'https://www.youtube.com/watch?v=1');
    assert.equal(m.type, 'video');
    assert.equal(m.favicon, 'https://www.youtube.com/favicon.ico');
  });

  test('finds the API resource behind a Discogs page', () => {
    assert.deepEqual(discogsResource('https://www.discogs.com/release/945406-Various-Nothing-Compares-To-The-Hits-Of-1990'), {
      kind: 'release',
      path: 'releases/945406',
    });
    assert.equal(discogsResource('https://discogs.com/de/master/23432-Middle-Men-Tales-From-The-Blobe')?.path, 'masters/23432');
    assert.equal(discogsResource('https://www.discogs.com/artist/1-The-Persuader')?.path, 'artists/1');
    assert.equal(discogsResource('https://www.discogs.com/label/1')?.path, 'labels/1');
    assert.equal(discogsResource('https://www.discogs.com/Various-Nothing-Compares/release/945406')?.path, 'releases/945406', 'old-style URL');
    assert.equal(discogsResource('https://www.discogs.com/search/?q=release'), null);
    assert.equal(discogsResource('https://example.com/release/945406'), null);
  });

  test('reads Discogs API data', () => {
    const release = discogsMetadata('release', {
      title: 'Split',
      year: 1990,
      country: 'Australia',
      artists: [{ name: 'Middle Men (2)', join: '&' }, { name: 'The Persuader', join: ',' }, { name: 'Various' }],
      labels: [{ name: 'EMI (3)' }],
      formats: [{ name: 'CD', descriptions: ['Compilation'] }],
      images: [
        { type: 'secondary', uri: 'https://i.discogs.example/back.jpg' },
        { type: 'primary', uri: 'https://i.discogs.example/front.jpg' },
      ],
    });
    assert.equal(release.title, 'Middle Men & The Persuader, Various – Split');
    assert.equal(release.description, '1990 · Australia · CD, Compilation · EMI');
    assert.equal(release.image, 'https://i.discogs.example/front.jpg');
    assert.equal(release.favicon, null);

    const master = discogsMetadata('master', { title: 'Tales', year: 2005, genres: ['Electronic', 'Jazz'], artists: [{ name: 'X' }] });
    assert.equal(master.description, '2005 · Electronic, Jazz');
    assert.equal(master.image, null);

    const artist = discogsMetadata('artist', {
      name: 'The Persuader (2)',
      profile: 'Alias of [a=Jesper Dahlbäck][a123]. See [url=https://x.example]his site[/url], [b]Stockholm[/b].',
    });
    assert.equal(artist.title, 'The Persuader');
    assert.equal(artist.description, 'Alias of Jesper Dahlbäck. See his site, Stockholm.');
  });
});
