import type { Bookmark, BookmarkContent, BookmarkPage, BookmarkSource, BookmarkType, BulkAction, Counts, Filter, Sort } from '../../shared/types.ts';
import { all, get, now, placeholders, run, tx, type Param } from '../db/index.ts';
import { badRequest, notFound } from '../lib/http.ts';
import { between, renumber, tooClose } from '../lib/position.ts';
import { parseQuery } from '../lib/search.ts';
import { normalizeUrl, parseBookmarkUrl, siteOf } from '../lib/url.ts';
import { deleteAssets, pruneFavicons } from './assets.ts';
import { instagramTitle } from './extract.ts';
import { assertCollection } from './collections.ts';
import { reindex, unindex } from './search-index.ts';
import { addTags, pruneTags, removeTags, setBookmarkTags, tagsFor } from './tags.ts';
import { enqueueFetch } from './worker.ts';

type Row = {
  id: number;
  type: BookmarkType;
  url: string | null;
  site: string | null;
  title: string;
  description: string;
  note: string;
  cover_url: string | null;
  cover_asset_id: number | null;
  favicon_url: string | null;
  file_asset_id: number | null;
  collection_id: number | null;
  favorite: number;
  fetch_status: Bookmark['fetchStatus'];
  broken: number;
  has_content: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  file_mime: string | null;
  file_size: number | null;
  file_name: string | null;
  favicon_asset_id: number | null;
};

const COLUMNS = `b.id, b.type, b.url, b.site, b.title, b.description, b.note, b.cover_url, b.cover_asset_id,
  b.favicon_url, b.file_asset_id, b.collection_id, b.favorite, b.fetch_status, b.broken,
  (b.content_html IS NOT NULL) AS has_content, b.created_at, b.updated_at, b.deleted_at,
  a.mime AS file_mime, a.size AS file_size, a.filename AS file_name, fv.asset_id AS favicon_asset_id`;
// The uploaded file's details, and the locally cached copy of the site icon when there is one.
const JOINS = `LEFT JOIN assets a ON a.id = b.file_asset_id
  LEFT JOIN favicons fv ON fv.user_id = b.user_id AND fv.url = b.favicon_url`;
const FROM = `FROM bookmarks b ${JOINS}`;

const assetUrl = (id: number) => `/api/assets/${id}`;

function toBookmark(r: Row, tags: string[]): Bookmark {
  const file = r.file_asset_id
    ? { url: assetUrl(r.file_asset_id), mime: r.file_mime ?? '', size: r.file_size ?? 0, name: r.file_name ?? '' }
    : null;
  const cover = r.cover_asset_id
    ? assetUrl(r.cover_asset_id)
    : r.cover_url ?? (file && r.type === 'image' ? file.url : null);
  return {
    id: r.id,
    type: r.type,
    url: r.url,
    title: r.title,
    description: r.description,
    note: r.note,
    site: r.site,
    cover,
    favicon: r.favicon_asset_id ? assetUrl(r.favicon_asset_id) : r.favicon_url,
    file,
    collectionId: r.collection_id,
    tags,
    favorite: !!r.favorite,
    fetchStatus: r.fetch_status,
    broken: !!r.broken,
    hasContent: !!r.has_content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

function hydrate(rows: Row[]): Bookmark[] {
  const tags = tagsFor(rows.map((r) => r.id));
  return rows.map((r) => toBookmark(r, tags.get(r.id) ?? []));
}

export function getBookmark(userId: number, id: number): Bookmark {
  const row = get<Row>(`SELECT ${COLUMNS} ${FROM} WHERE b.id = ? AND b.user_id = ?`, id, userId);
  if (!row) throw notFound('Bookmark not found');
  return hydrate([row])[0]!;
}

export function getContent(userId: number, id: number): BookmarkContent {
  const row = get<{ content_html: string | null; content_text: string | null }>(
    'SELECT content_html, content_text FROM bookmarks WHERE id = ? AND user_id = ?',
    id,
    userId,
  );
  if (!row) throw notFound('Bookmark not found');
  return { html: row.content_html, text: row.content_text };
}

// --- Listing -----------------------------------------------------------------

export interface ListOptions {
  view: 'all' | 'unsorted' | 'trash' | 'collection' | 'filter' | 'tag';
  collectionId?: number;
  filter?: Filter;
  tag?: string;
  q?: string;
  sort?: Sort;
  offset?: number;
  limit?: number;
  /** For before:/after: dates in the search. */
  timeZone?: string;
}

const FILTER_SQL: Record<Filter, string> = {
  favorites: 'b.favorite = 1',
  notes: "(b.note != '' OR b.type = 'note')",
  links: "b.type = 'link'",
  articles: "b.type = 'article'",
  videos: "b.type = 'video'",
  images: "b.type = 'image'",
  audios: "b.type = 'audio'",
  documents: "b.type = 'document'",
  broken: 'b.broken = 1',
  duplicates: `b.normalized_url IN (
    SELECT normalized_url FROM bookmarks WHERE user_id = b.user_id AND deleted_at IS NULL AND normalized_url IS NOT NULL
    GROUP BY normalized_url HAVING COUNT(*) > 1)`,
  untagged: 'NOT EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id)',
};

const SORT_SQL: Record<Exclude<Sort, 'relevance'>, string> = {
  manual: 'b.position ASC, b.created_at DESC',
  '-created': 'b.created_at DESC, b.id DESC',
  created: 'b.created_at ASC, b.id ASC',
  title: "b.title = '' ASC, b.title COLLATE NOCASE ASC, b.id DESC",
  '-title': "b.title = '' ASC, b.title COLLATE NOCASE DESC, b.id DESC",
  site: 'b.site IS NULL ASC, b.site COLLATE NOCASE ASC, b.created_at DESC',
  '-site': 'b.site IS NULL ASC, b.site COLLATE NOCASE DESC, b.created_at DESC',
};

const TAG_MATCH = `EXISTS (SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
  WHERE bt.bookmark_id = b.id AND t.name = ? COLLATE NOCASE)`;

/** Text for a LIKE pattern, with its wildcards escaped (the query says ESCAPE '\'). */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/** The WHERE clause, joins and ORDER BY for a list view or search. */
function buildList(userId: number, opts: ListOptions) {
  const where: string[] = ['b.user_id = ?'];
  const params: Param[] = [userId];
  const add = (sql: string, ...p: Param[]) => {
    where.push(sql);
    params.push(...p);
  };

  add(opts.view === 'trash' ? 'b.deleted_at IS NOT NULL' : 'b.deleted_at IS NULL');
  if (opts.view === 'unsorted') add('b.collection_id IS NULL');
  if (opts.view === 'collection') add('b.collection_id = ?', opts.collectionId ?? -1);
  if (opts.view === 'filter' && opts.filter) add(FILTER_SQL[opts.filter]);
  if (opts.view === 'tag' && opts.tag) add(TAG_MATCH, opts.tag);

  let join = '';
  const query = opts.q?.trim() ? parseQuery(opts.q, opts.timeZone) : null;
  if (query) {
    if (query.match) {
      join = 'JOIN bookmarks_fts f ON f.rowid = b.id';
      add('bookmarks_fts MATCH ?', query.match);
    }
    if (query.exclude) add('b.id NOT IN (SELECT rowid FROM bookmarks_fts WHERE bookmarks_fts MATCH ?)', query.exclude);
    for (const tag of query.tags) add(TAG_MATCH, tag);
    for (const tag of query.excludeTags) add(`NOT ${TAG_MATCH}`, tag);
    if (query.types.length) add(`b.type IN (${placeholders(query.types.length)})`, ...query.types);
    for (const site of query.sites) add("(b.site = ? OR b.site LIKE ? ESCAPE '\\')", site, `%.${likeEscape(site)}`);
    if (query.favorite !== null) add('b.favorite = ?', query.favorite);
    if (query.hasNote !== null) add(query.hasNote ? "b.note != ''" : "b.note = ''");
    if (query.before !== null) add('b.created_at < ?', query.before);
    if (query.after !== null) add('b.created_at >= ?', query.after);
  }

  let order: string;
  if (opts.view === 'filter' && opts.filter === 'duplicates') order = 'b.normalized_url, b.created_at DESC';
  else if (opts.view === 'trash' && (!opts.sort || opts.sort === 'manual')) order = 'b.deleted_at DESC, b.id DESC';
  else if (opts.sort === 'relevance' || (!opts.sort && query?.match)) {
    order = query?.match ? 'bm25(bookmarks_fts, 10.0, 4.0, 4.0, 1.0, 2.0, 6.0), b.created_at DESC' : SORT_SQL['-created'];
  } else order = SORT_SQL[opts.sort ?? '-created'];

  return { join, whereSql: where.join(' AND '), params, order };
}

export function listBookmarks(userId: number, opts: ListOptions): BookmarkPage {
  const { join, whereSql, params, order } = buildList(userId, opts);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM bookmarks b ${join} WHERE ${whereSql}`, ...params)?.n ?? 0;
  const rows = all<Row>(
    `SELECT ${COLUMNS} FROM bookmarks b ${join} ${JOINS}
     WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  return { items: hydrate(rows), total, nextOffset: offset + rows.length < total ? offset + rows.length : null };
}

/** Every id a list view or search would show, in order ("select all"). */
export function listBookmarkIds(userId: number, opts: ListOptions): number[] {
  const { join, whereSql, params, order } = buildList(userId, opts);
  return all<{ id: number }>(`SELECT b.id FROM bookmarks b ${join} WHERE ${whereSql} ORDER BY ${order} LIMIT 100000`, ...params).map((r) => r.id);
}

export function getCounts(userId: number): Counts {
  const r = get<Record<string, number | null>>(
    `SELECT
       SUM(deleted_at IS NULL) AS all_,
       SUM(deleted_at IS NULL AND collection_id IS NULL) AS unsorted,
       SUM(deleted_at IS NOT NULL) AS trash,
       SUM(deleted_at IS NULL AND favorite = 1) AS favorites,
       SUM(deleted_at IS NULL AND (note != '' OR type = 'note')) AS notes,
       SUM(deleted_at IS NULL AND type = 'link') AS links,
       SUM(deleted_at IS NULL AND type = 'article') AS articles,
       SUM(deleted_at IS NULL AND type = 'video') AS videos,
       SUM(deleted_at IS NULL AND type = 'image') AS images,
       SUM(deleted_at IS NULL AND type = 'audio') AS audios,
       SUM(deleted_at IS NULL AND type = 'document') AS documents,
       SUM(deleted_at IS NULL AND broken = 1) AS broken,
       SUM(deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id)) AS untagged
     FROM bookmarks b WHERE user_id = ?`,
    userId,
  )!;
  const duplicates =
    get<{ n: number | null }>(
      `SELECT SUM(c) AS n FROM (
         SELECT COUNT(*) AS c FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL AND normalized_url IS NOT NULL
         GROUP BY normalized_url HAVING c > 1)`,
      userId,
    )?.n ?? 0;
  const n = (k: string) => r[k] ?? 0;
  return {
    all: n('all_'),
    unsorted: n('unsorted'),
    trash: n('trash'),
    filters: {
      favorites: n('favorites'),
      notes: n('notes'),
      links: n('links'),
      articles: n('articles'),
      videos: n('videos'),
      images: n('images'),
      audios: n('audios'),
      documents: n('documents'),
      broken: n('broken'),
      duplicates,
      untagged: n('untagged'),
    },
  };
}

// --- Mutations ---------------------------------------------------------------

export interface CreateInput {
  url?: string | null;
  title?: string;
  description?: string;
  note?: string;
  collectionId?: number | null;
  tags?: string[];
  favorite?: boolean;
  createdAt?: number;
  coverUrl?: string | null;
  type?: BookmarkType;
  fileAssetId?: number | null;
  source?: BookmarkSource;
  /** Queue a metadata fetch (default true for links). */
  fetch?: boolean;
  /** Don't index yet; the caller will call reindex() itself (bulk imports). */
  deferIndex?: boolean;
}

function topPosition(userId: number, collectionId: number | null): number {
  const min = get<{ p: number | null }>(
    'SELECT MIN(position) AS p FROM bookmarks WHERE user_id = ? AND collection_id IS ? AND deleted_at IS NULL',
    userId,
    collectionId,
  )?.p;
  return between(null, min ?? null);
}

export function createBookmark(userId: number, input: CreateInput): Bookmark {
  let url: string | null = null;
  if (input.url) {
    const parsed = parseBookmarkUrl(input.url);
    if (!parsed) throw badRequest('Enter a valid http(s) URL');
    url = parsed.href;
  }
  const note = input.note?.trim() ?? '';
  if (!url && !note && !input.fileAssetId) throw badRequest('A URL, note or file is required');
  const collectionId = input.collectionId ?? null;
  assertCollection(userId, collectionId);

  const type: BookmarkType = input.type ?? (url ? 'link' : input.fileAssetId ? 'document' : 'note');
  const shouldFetch = (input.fetch ?? true) && !!url && !input.fileAssetId;
  const t = now();
  const createdAt = input.createdAt && input.createdAt > 0 ? input.createdAt : t;
  let title = (input.title ?? '').trim().slice(0, 1000);
  // A tab or import that only knows Instagram's placeholder title: name the page from its URL.
  if (title === 'Instagram' && url) title = instagramTitle(url) ?? title;

  const id = tx(() => {
    const { lastId } = run(
      `INSERT INTO bookmarks (user_id, collection_id, type, url, normalized_url, site, title, description, note,
         cover_url, file_asset_id, favorite, position, fetch_status, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      collectionId,
      type,
      url,
      url ? normalizeUrl(url) : null,
      siteOf(url),
      title,
      (input.description ?? '').trim().slice(0, 5000),
      note,
      input.coverUrl ?? null,
      input.fileAssetId ?? null,
      input.favorite ?? false,
      topPosition(userId, collectionId),
      shouldFetch ? 'pending' : 'skipped',
      input.source ?? null,
      createdAt,
      t,
    );
    if (input.tags?.length) setBookmarkTags(userId, lastId, input.tags);
    if (!input.deferIndex) reindex([lastId]);
    return lastId;
  });
  if (shouldFetch) enqueueFetch(id);
  return getBookmark(userId, id);
}

export interface UpdateInput {
  url?: string;
  title?: string;
  description?: string;
  note?: string;
  collectionId?: number | null;
  tags?: string[];
  favorite?: boolean;
  coverUrl?: string | null;
}

export function updateBookmark(userId: number, id: number, patch: UpdateInput): Bookmark {
  const current = getBookmark(userId, id);
  const sets: string[] = [];
  const params: Param[] = [];
  const set = (sql: string, ...p: Param[]) => {
    sets.push(sql);
    params.push(...p);
  };
  let refetch = false;

  if (patch.url !== undefined && patch.url !== current.url) {
    const parsed = parseBookmarkUrl(patch.url);
    if (!parsed) throw badRequest('Enter a valid http(s) URL');
    set('url = ?, normalized_url = ?, site = ?, fetch_status = ?, broken = 0', parsed.href, normalizeUrl(parsed.href), siteOf(parsed.href), 'pending');
    if (current.type === 'note') set("type = 'link'");
    refetch = true;
  }
  if (patch.title !== undefined) set('title = ?', patch.title.trim().slice(0, 1000));
  if (patch.description !== undefined) set('description = ?', patch.description.trim().slice(0, 5000));
  if (patch.note !== undefined) set('note = ?', patch.note);
  if (patch.favorite !== undefined) set('favorite = ?', patch.favorite);
  if (patch.coverUrl !== undefined) set('cover_url = ?, cover_asset_id = NULL', patch.coverUrl || null);
  if (patch.collectionId !== undefined && patch.collectionId !== current.collectionId) {
    assertCollection(userId, patch.collectionId);
    set('collection_id = ?, position = ?, deleted_at = NULL', patch.collectionId, topPosition(userId, patch.collectionId));
  }

  tx(() => {
    if (sets.length) run(`UPDATE bookmarks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params, now(), id);
    if (patch.tags !== undefined) {
      setBookmarkTags(userId, id, patch.tags);
      pruneTags(userId);
    }
    reindex([id]);
  });
  if (refetch) enqueueFetch(id);
  return getBookmark(userId, id);
}

/**
 * Place a bookmark between two neighbours in its collection (manual sort). The client only knows
 * the bookmarks it has loaded, so a missing neighbour ("drop after the last one I can see") is
 * looked up here: otherwise the bookmark could land on the same position as one not yet loaded.
 */
export function reorderBookmark(userId: number, id: number, prevId: number | null, nextId: number | null): Bookmark {
  const b = getBookmark(userId, id);
  const siblings = 'user_id = ? AND collection_id IS ? AND deleted_at IS NULL AND id != ?';
  const pos = (nid: number | null) =>
    nid == null
      ? null
      : (get<{ position: number }>(
          'SELECT position FROM bookmarks WHERE id = ? AND user_id = ? AND collection_id IS ?',
          nid,
          userId,
          b.collectionId,
        )?.position ?? null);
  const neighbours = () => {
    let prev = pos(prevId);
    let next = pos(nextId);
    if (prev != null && next == null) {
      next = get<{ p: number | null }>(`SELECT MIN(position) AS p FROM bookmarks WHERE ${siblings} AND position > ?`, userId, b.collectionId, id, prev)?.p ?? null;
    } else if (next != null && prev == null) {
      prev = get<{ p: number | null }>(`SELECT MAX(position) AS p FROM bookmarks WHERE ${siblings} AND position < ?`, userId, b.collectionId, id, next)?.p ?? null;
    }
    return [prev, next] as const;
  };
  tx(() => {
    let [prev, next] = neighbours();
    if (tooClose(prev, next)) {
      renumber('bookmarks', 'user_id = ? AND collection_id IS ? AND deleted_at IS NULL', userId, b.collectionId);
      [prev, next] = neighbours();
    }
    run('UPDATE bookmarks SET position = ? WHERE id = ?', between(prev, next), id);
  });
  return getBookmark(userId, id);
}

function ownedIds(userId: number, ids: number[]): number[] {
  if (!ids.length) return [];
  return all<{ id: number }>(
    `SELECT id FROM bookmarks WHERE user_id = ? AND id IN (${placeholders(ids.length)})`,
    userId,
    ...ids,
  ).map((r) => r.id);
}

function deletePermanently(userId: number, ids: number[]) {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const assets = all<{ cover_asset_id: number | null; file_asset_id: number | null }>(
      `SELECT cover_asset_id, file_asset_id FROM bookmarks WHERE id IN (${placeholders(chunk.length)})`,
      ...chunk,
    );
    run(`DELETE FROM bookmarks WHERE user_id = ? AND id IN (${placeholders(chunk.length)})`, userId, ...chunk);
    unindex(chunk);
    deleteAssets(assets.flatMap((a) => [a.cover_asset_id, a.file_asset_id]));
  }
  pruneTags(userId);
  pruneFavicons(userId);
}

export function bulkUpdate(userId: number, rawIds: number[], action: BulkAction): number {
  // Keep the caller's order (it matters for "move", which preserves relative order).
  const owned = new Set(ownedIds(userId, rawIds));
  const ids = rawIds.filter((id) => owned.has(id));
  if (!ids.length) return 0;
  const inList = `id IN (${placeholders(ids.length)})`;
  const t = now();

  tx(() => {
    switch (action.action) {
      case 'move': {
        assertCollection(userId, action.collectionId);
        const top = topPosition(userId, action.collectionId);
        ids.forEach((id, i) =>
          run(
            'UPDATE bookmarks SET collection_id = ?, position = ?, deleted_at = NULL, updated_at = ? WHERE id = ?',
            action.collectionId,
            top - ids.length + i,
            t,
            id,
          ),
        );
        break;
      }
      case 'addTags':
        addTags(userId, ids, action.tags);
        reindex(ids);
        break;
      case 'removeTags':
        removeTags(userId, ids, action.tags);
        reindex(ids);
        break;
      case 'favorite':
        run(`UPDATE bookmarks SET favorite = ?, updated_at = ? WHERE ${inList}`, action.value, t, ...ids);
        break;
      case 'trash':
        run(`UPDATE bookmarks SET deleted_at = ? WHERE ${inList} AND deleted_at IS NULL`, t, ...ids);
        break;
      case 'restore':
        run(`UPDATE bookmarks SET deleted_at = NULL WHERE ${inList}`, ...ids);
        break;
      case 'delete':
        deletePermanently(userId, ids);
        break;
      case 'refetch':
        run(`UPDATE bookmarks SET fetch_status = 'pending' WHERE ${inList} AND url IS NOT NULL AND file_asset_id IS NULL`, ...ids);
        break;
    }
  });
  if (action.action === 'refetch') for (const id of ids) enqueueFetch(id);
  return ids.length;
}

export function emptyTrash(userId: number): number {
  const ids = all<{ id: number }>('SELECT id FROM bookmarks WHERE user_id = ? AND deleted_at IS NOT NULL', userId).map((r) => r.id);
  tx(() => deletePermanently(userId, ids));
  return ids.length;
}

/** Existing normalized URLs for a user (used to skip duplicates on import). */
export function existingUrls(userId: number): Set<string> {
  return new Set(
    all<{ u: string }>('SELECT normalized_url AS u FROM bookmarks WHERE user_id = ? AND normalized_url IS NOT NULL', userId).map((r) => r.u),
  );
}
