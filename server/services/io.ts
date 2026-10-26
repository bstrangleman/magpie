import type { BookmarkType, ImportResult } from '../../shared/types.ts';
import { all, get, placeholders, tx } from '../db/index.ts';
import { normalizeUrl, parseBookmarkUrl } from '../lib/url.ts';
import { createBookmark, existingUrls } from './bookmarks.ts';
import { ensureCollectionPath, listCollections, listGroups, subtreeIds, updateCollection } from './collections.ts';
import { reindex } from './search-index.ts';
import { tagsFor } from './tags.ts';

// --- Export ------------------------------------------------------------------

export interface ExportBookmark {
  url: string | null;
  title: string;
  description: string;
  note: string;
  type: BookmarkType;
  collectionId: number | null;
  tags: string[];
  favorite: boolean;
  cover: string | null;
  createdAt: number;
}

export interface ExportData {
  magpie: 1;
  exportedAt: string;
  groups: { id: number; name: string }[];
  collections: { id: number; name: string; icon: string | null; color: string | null; parentId: number | null; groupId: number | null }[];
  bookmarks: ExportBookmark[];
}

/** Everything (or one collection subtree) in Magpie's JSON format. Trash is excluded. */
export function buildExport(userId: number, collectionId?: number): ExportData {
  let collections = listCollections(userId);
  let scope = '';
  const params: number[] = [userId];
  if (collectionId) {
    const ids = subtreeIds(userId, collectionId);
    collections = collections.filter((c) => ids.includes(c.id));
    scope = `AND collection_id IN (${placeholders(ids.length)})`;
    params.push(...ids);
  }
  const rows = all<{
    id: number;
    url: string | null;
    title: string;
    description: string;
    note: string;
    type: BookmarkType;
    collection_id: number | null;
    favorite: number;
    cover_url: string | null;
    created_at: number;
  }>(
    `SELECT id, url, title, description, note, type, collection_id, favorite, cover_url, created_at
     FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL ${scope} ORDER BY collection_id, position, created_at DESC`,
    ...params,
  );
  const tags = tagsFor(rows.map((r) => r.id));
  return {
    magpie: 1,
    exportedAt: new Date().toISOString(),
    groups: listGroups(userId).map((g) => ({ id: g.id, name: g.name })),
    collections: collections.map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, parentId: c.parentId, groupId: c.groupId })),
    bookmarks: rows.map((r) => ({
      url: r.url,
      title: r.title,
      description: r.description,
      note: r.note,
      type: r.type,
      collectionId: r.collection_id,
      tags: tags.get(r.id) ?? [],
      favorite: !!r.favorite,
      cover: r.cover_url,
      createdAt: r.created_at,
    })),
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function collectionPaths(data: ExportData): Map<number, string[]> {
  const byId = new Map(data.collections.map((c) => [c.id, c]));
  const paths = new Map<number, string[]>();
  const pathOf = (id: number): string[] => {
    const cached = paths.get(id);
    if (cached) return cached;
    const c = byId.get(id);
    if (!c) return [];
    const p = [...(c.parentId && byId.has(c.parentId) ? pathOf(c.parentId) : []), c.name];
    paths.set(id, p);
    return p;
  };
  for (const c of data.collections) pathOf(c.id);
  return paths;
}

/** Netscape bookmark file, readable by every browser and most bookmark managers. */
export function toNetscape(data: ExportData): string {
  const secs = (ms: number) => Math.floor(ms / 1000);
  const ids = new Set(data.collections.map((c) => c.id));
  const group = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  const children = new Map<number | null, ExportData['collections']>();
  for (const c of data.collections) group(children, c.parentId && ids.has(c.parentId) ? c.parentId : null, c);
  const byCollection = new Map<number | null, ExportBookmark[]>();
  for (const b of data.bookmarks) group(byCollection, b.collectionId && ids.has(b.collectionId) ? b.collectionId : null, b);

  const lines: string[] = [];
  const bookmarkLines = (list: ExportBookmark[], pad: string) => {
    for (const b of list) {
      if (!b.url) continue;
      const attrs = [`HREF="${esc(b.url)}"`, `ADD_DATE="${secs(b.createdAt)}"`];
      if (b.tags.length) attrs.push(`TAGS="${esc(b.tags.join(','))}"`);
      if (b.cover) attrs.push(`DATA-COVER="${esc(b.cover)}"`);
      if (b.favorite) attrs.push('DATA-IMPORTANT="true"');
      lines.push(`${pad}<DT><A ${attrs.join(' ')}>${esc(b.title || b.url)}</A>`);
      const dd = b.note || b.description;
      if (dd) lines.push(`${pad}<DD>${esc(dd)}`);
    }
  };
  const folder = (id: number | null, pad: string) => {
    for (const c of children.get(id) ?? []) {
      lines.push(`${pad}<DT><H3>${esc(c.name)}</H3>`);
      lines.push(`${pad}<DL><p>`);
      folder(c.id, `${pad}    `);
      bookmarkLines(byCollection.get(c.id) ?? [], `${pad}    `);
      lines.push(`${pad}</DL><p>`);
    }
  };
  folder(null, '    ');
  bookmarkLines(byCollection.get(null) ?? [], '    ');

  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    ...lines,
    '</DL><p>',
    '',
  ].join('\n');
}

// Spreadsheet apps run cells starting with these as formulas. Titles come from arbitrary web pages,
// so such cells get a leading apostrophe (which spreadsheets hide, and parseCsv removes again).
const FORMULA_START = /^[=+\-@\t\r]/;

const csvCell = (v: string | number | boolean) => {
  let s = String(v);
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(data: ExportData): string {
  const paths = collectionPaths(data);
  const header = ['title', 'note', 'excerpt', 'url', 'folder', 'tags', 'created', 'cover', 'favorite', 'type'];
  const rows = data.bookmarks.map((b) =>
    [
      b.title,
      b.note,
      b.description,
      b.url ?? '',
      b.collectionId ? (paths.get(b.collectionId) ?? []).join('/') : '',
      b.tags.join(', '),
      new Date(b.createdAt).toISOString(),
      b.cover ?? '',
      b.favorite,
      b.type,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n') + '\n';
}

// --- Import ------------------------------------------------------------------

export interface ImportItem {
  url?: string;
  title?: string;
  description?: string;
  note?: string;
  tags?: string[];
  folder?: string[];
  createdAt?: number;
  favorite?: boolean;
  cover?: string;
}

export interface ParsedImport {
  format: string;
  items: ImportItem[];
  folders: { path: string[]; icon?: string | null; color?: string | null }[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, '');

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Timestamps in exports come in seconds, milliseconds or microseconds. */
function toMillis(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(n) && n > 0) {
    if (n > 1e14) return Math.floor(n / 1000);
    if (n > 1e11) return n;
    return n * 1000;
  }
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? undefined : t;
}

const splitTags = (s: string | undefined) =>
  (s ?? '')
    .split(s?.includes('|') ? '|' : s?.includes(',') ? ',' : /\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

/** Netscape bookmark HTML (Chrome, Firefox, Safari, Pocket and other bookmark managers…). */
export function parseNetscape(html: string): ParsedImport {
  const items: ImportItem[] = [];
  const folders: ParsedImport['folders'] = [];
  const stack: string[] = [];
  const pushedFolder: boolean[] = [];
  let pendingFolder: string | null = null;
  let last: ImportItem | null = null;

  const re = /<(\/?)(dl|h3|a|dd)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const closing = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    if (tag === 'h3' && !closing) {
      const end = html.slice(re.lastIndex).search(/<\/h3>/i);
      if (end === -1) break;
      pendingFolder = decodeEntities(stripTags(html.slice(re.lastIndex, re.lastIndex + end))).trim() || 'Untitled';
      re.lastIndex += end + 5;
      last = null;
    } else if (tag === 'dl') {
      if (!closing) {
        pushedFolder.push(pendingFolder !== null);
        if (pendingFolder !== null) {
          stack.push(pendingFolder);
          folders.push({ path: [...stack] });
          pendingFolder = null;
        }
      } else if (pushedFolder.pop()) {
        stack.pop();
      }
      last = null;
    } else if (tag === 'a' && !closing) {
      const end = html.slice(re.lastIndex).search(/<\/a>/i);
      const inner = end === -1 ? '' : html.slice(re.lastIndex, re.lastIndex + end);
      if (end !== -1) re.lastIndex += end + 4;
      const a = parseAttrs(m[3]!);
      last = null;
      if (!a.href || !/^https?:/i.test(a.href)) continue;
      last = {
        url: a.href,
        title: decodeEntities(stripTags(inner)).trim(),
        tags: splitTags(a.tags),
        createdAt: toMillis(a.add_date ?? a.time_added),
        favorite: a['data-important'] === 'true',
        cover: a['data-cover'] || undefined,
        folder: [...stack],
      };
      items.push(last);
    } else if (tag === 'dd' && !closing && last) {
      const next = html.slice(re.lastIndex).search(/<(dt|\/?dl)\b/i);
      const text = decodeEntities(stripTags(html.slice(re.lastIndex, next === -1 ? undefined : re.lastIndex + next))).trim();
      if (text) last.description = text;
    }
  }
  return { format: 'Bookmarks HTML', items, folders };
}

/** RFC 4180 CSV → rows of cells. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** CSV with a header row (Pocket, Magpie, or anything with a url column). */
export function parseCsv(text: string): ParsedImport {
  const [header, ...rows] = parseCsvRows(text.replace(/^﻿/, ''));
  if (!header) return { format: 'CSV', items: [], folders: [] };
  const cols = header.map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => cols.findIndex((c) => names.includes(c));
  const idx = {
    url: col('url', 'link', 'href', 'address'),
    title: col('title', 'name'),
    note: col('note', 'notes'),
    excerpt: col('excerpt', 'description', 'summary'),
    folder: col('folder', 'collection', 'category', 'list'),
    tags: col('tags', 'labels'),
    created: col('created', 'created_at', 'createdat', 'date', 'time_added', 'added'),
    cover: col('cover', 'image'),
    favorite: col('favorite', 'favourite', 'starred', 'important'),
  };
  if (idx.url === -1) throw new Error('CSV file has no "url" column');
  // Undo the apostrophe toCsv adds in front of formula-like cells.
  const val = (row: string[], i: number) => (i === -1 ? undefined : row[i]?.trim().replace(/^'(?=[=+\-@\t\r])/, '') || undefined);
  const folderSet = new Map<string, string[]>();
  const items = rows.map((row): ImportItem => {
    const folder = val(row, idx.folder)?.split('/').map((s) => s.trim()).filter(Boolean) ?? [];
    for (let i = 1; i <= folder.length; i++) folderSet.set(folder.slice(0, i).join('/'), folder.slice(0, i));
    return {
      url: val(row, idx.url),
      title: val(row, idx.title),
      note: val(row, idx.note),
      description: val(row, idx.excerpt),
      folder,
      tags: splitTags(val(row, idx.tags)),
      createdAt: toMillis(val(row, idx.created)),
      cover: val(row, idx.cover),
      favorite: ['true', '1', 'yes'].includes(val(row, idx.favorite)?.toLowerCase() ?? ''),
    };
  });
  return { format: 'CSV', items, folders: [...folderSet.values()].map((path) => ({ path })) };
}

/** Magpie's own JSON export, or another manager's bookmarks-and-lists JSON export. */
export function parseJson(text: string): ParsedImport {
  const data = JSON.parse(text) as Record<string, unknown>;

  if (data.magpie) {
    const d = data as unknown as ExportData;
    const paths = collectionPaths(d);
    return {
      format: 'Magpie JSON',
      folders: d.collections.map((c) => ({ path: paths.get(c.id) ?? [c.name], icon: c.icon, color: c.color })),
      items: d.bookmarks.map((b) => ({
        url: b.url ?? undefined,
        title: b.title,
        description: b.description,
        note: b.note,
        tags: b.tags,
        folder: b.collectionId ? paths.get(b.collectionId) : [],
        createdAt: b.createdAt,
        favorite: b.favorite,
        cover: b.cover ?? undefined,
      })),
    };
  }

  if (Array.isArray(data.bookmarks)) {
    // Bookmarks and lists: { bookmarks: [{ createdAt, title, tags, lists, content: {type, url|text}, note }], lists: [...] }
    type KList = { id: string; name: string; icon?: string; parentId: string | null; type?: string };
    type KBookmark = {
      createdAt?: number;
      title?: string | null;
      tags?: string[];
      lists?: string[];
      note?: string | null;
      content?: { type: string; url?: string; text?: string } | null;
    };
    const lists = ((data.lists as KList[] | undefined) ?? []).filter((l) => l.type !== 'smart');
    const byId = new Map(lists.map((l) => [l.id, l]));
    const pathOf = (id: string, seen = new Set<string>()): string[] => {
      const l = byId.get(id);
      if (!l || seen.has(id)) return [];
      seen.add(id);
      return [...(l.parentId ? pathOf(l.parentId, seen) : []), l.name];
    };
    return {
      format: 'Bookmarks JSON',
      folders: lists.map((l) => ({ path: pathOf(l.id), icon: l.icon || null })),
      items: (data.bookmarks as KBookmark[]).map((b) => {
        const listId = b.lists?.find((id) => byId.has(id));
        const isText = b.content?.type === 'text';
        return {
          url: b.content?.type === 'link' ? b.content.url : undefined,
          title: b.title ?? undefined,
          note: isText ? [b.content?.text, b.note].filter(Boolean).join('\n\n') : (b.note ?? undefined),
          tags: b.tags ?? [],
          folder: listId ? pathOf(listId) : [],
          createdAt: toMillis(b.createdAt),
        };
      }),
    };
  }
  throw new Error('Unrecognised JSON format');
}

export function parseImport(filename: string, text: string): ParsedImport {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || filename.toLowerCase().endsWith('.json')) return parseJson(text);
  if (/<!DOCTYPE NETSCAPE|<DL|<a\s/i.test(trimmed.slice(0, 5000)) || /\.html?$/i.test(filename)) return parseNetscape(text);
  return parseCsv(text);
}

export function importBookmarks(
  userId: number,
  parsed: ParsedImport,
  opts: { skipDuplicates: boolean; fetchMetadata: boolean },
): ImportResult {
  const result: ImportResult = { format: parsed.format, created: 0, skipped: 0, collections: 0, errors: [] };
  const before = get<{ n: number }>('SELECT COUNT(*) AS n FROM collections WHERE user_id = ?', userId)!.n;
  const seen = opts.skipDuplicates ? existingUrls(userId) : new Set<string>();
  const cache = new Map<string, number>();
  const created: number[] = [];

  tx(() => {
    for (const f of parsed.folders) {
      const id = ensureCollectionPath(userId, f.path, cache);
      if (id && (f.icon || f.color)) updateCollection(userId, id, { icon: f.icon ?? undefined, color: f.color ?? undefined });
    }
    // Oldest first, so the newest bookmark ends up at the top of each collection.
    const items = [...parsed.items].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    for (const item of items) {
      const url = item.url ? parseBookmarkUrl(item.url)?.href : undefined;
      if (item.url && !url) {
        result.skipped++;
        continue;
      }
      if (!url && !item.note?.trim()) {
        result.skipped++;
        continue;
      }
      const key = url ? normalizeUrl(url) : null;
      if (key && seen.has(key)) {
        result.skipped++;
        continue;
      }
      if (key) seen.add(key);
      try {
        const b = createBookmark(userId, {
          url,
          title: item.title,
          description: item.description,
          note: item.note,
          tags: item.tags,
          favorite: item.favorite,
          createdAt: item.createdAt,
          coverUrl: item.cover && parseBookmarkUrl(item.cover) ? item.cover : null,
          collectionId: item.folder?.length ? ensureCollectionPath(userId, item.folder, cache) : null,
          fetch: opts.fetchMetadata,
          source: 'import',
          deferIndex: true,
        });
        created.push(b.id);
        result.created++;
      } catch (err) {
        result.skipped++;
        if (result.errors.length < 20) result.errors.push(`${item.url ?? item.title}: ${(err as Error).message}`);
      }
    }
    reindex(created);
  });

  result.collections = get<{ n: number }>('SELECT COUNT(*) AS n FROM collections WHERE user_id = ?', userId)!.n - before;
  return result;
}
