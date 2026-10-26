import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { FILTERS, SORTS, type BookmarkSource, type BulkAction } from '../../shared/types.ts';
import { config } from '../config.ts';
import type { AppEnv } from '../lib/auth.ts';
import { badRequest, intParam, parse } from '../lib/http.ts';
import { validTimeZone } from '../lib/time.ts';
import { normalizeUrl } from '../lib/url.ts';
import { get } from '../db/index.ts';
import { saveAsset } from '../services/assets.ts';
import {
  bulkUpdate,
  createBookmark,
  emptyTrash,
  getBookmark,
  getContent,
  listBookmarkIds,
  listBookmarks,
  reorderBookmark,
  updateBookmark,
} from '../services/bookmarks.ts';
import { typeFromMime } from '../services/fetcher.ts';

const id = z.number().int().positive();
const tags = z.array(z.string().max(64)).max(100);

const listQuery = z.object({
  view: z.enum(['all', 'unsorted', 'trash', 'collection', 'filter', 'tag']).default('all'),
  collection: z.coerce.number().int().optional(),
  filter: z.enum(FILTERS).optional(),
  tag: z.string().optional(),
  q: z.string().max(500).optional(),
  sort: z.enum(SORTS).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /** IANA time zone for before:/after: dates in `q`. */
  tz: z.string().max(100).optional(),
});

const listOptions = (q: z.infer<typeof listQuery>) => ({ ...q, collectionId: q.collection, timeZone: validTimeZone(q.tz) });

const createBody = z.object({
  url: z.string().max(4000).nullish(),
  title: z.string().max(1000).optional(),
  description: z.string().max(5000).optional(),
  note: z.string().max(100_000).optional(),
  collectionId: id.nullish(),
  tags: tags.optional(),
  favorite: z.boolean().optional(),
  /** Only honoured for signed-in web requests (the bookmarklet page sends it). */
  source: z.literal('bookmarklet').optional(),
});

/**
 * Where a new bookmark came from: API-key requests are the extension (which says so in a
 * header) or another API client; session requests are the web app or its bookmarklet page.
 */
function sourceOf(c: Context<AppEnv>, requested?: 'bookmarklet'): BookmarkSource {
  if (c.var.user.via === 'key') return c.req.header('x-magpie-client') === 'extension' ? 'extension' : 'api';
  return requested ?? 'web';
}

const updateBody = z.object({
  url: z.string().max(4000).optional(),
  title: z.string().max(1000).optional(),
  description: z.string().max(5000).optional(),
  note: z.string().max(100_000).optional(),
  collectionId: id.nullable().optional(),
  tags: tags.optional(),
  favorite: z.boolean().optional(),
  coverUrl: z.string().max(4000).nullable().optional(),
});

const bulkBody = z.object({ ids: z.array(id).min(1).max(5000) }).and(
  z.discriminatedUnion('action', [
    z.object({ action: z.literal('move'), collectionId: id.nullable() }),
    z.object({ action: z.literal('addTags'), tags }),
    z.object({ action: z.literal('removeTags'), tags }),
    z.object({ action: z.literal('favorite'), value: z.boolean() }),
    z.object({ action: z.literal('trash') }),
    z.object({ action: z.literal('restore') }),
    z.object({ action: z.literal('delete') }),
    z.object({ action: z.literal('refetch') }),
  ]),
);

export const bookmarkRoutes = new Hono<AppEnv>()
  .get('/bookmarks', (c) => {
    const q = parse(listQuery, c.req.query());
    return c.json(listBookmarks(c.var.user.id, listOptions(q)));
  })
  // Every matching id, in list order, for "select all".
  .get('/bookmarks/ids', (c) => {
    const q = parse(listQuery, c.req.query());
    return c.json({ ids: listBookmarkIds(c.var.user.id, listOptions(q)) });
  })
  .post('/bookmarks', async (c) => {
    const { source, ...body } = parse(createBody, await c.req.json());
    return c.json(createBookmark(c.var.user.id, { ...body, source: sourceOf(c, source) }), 201);
  })
  .get('/bookmarks/lookup', (c) => {
    const key = normalizeUrl(c.req.query('url') ?? '');
    const row = key
      ? get<{ id: number }>(
          'SELECT id FROM bookmarks WHERE user_id = ? AND normalized_url = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1',
          c.var.user.id,
          key,
        )
      : undefined;
    return c.json({ bookmark: row ? getBookmark(c.var.user.id, row.id) : null });
  })
  .post('/bookmarks/upload', bodyLimit({ maxSize: config.maxUploadBytes, onError: () => { throw badRequest('File is too large'); } }), async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File) || !file.size) throw badRequest('Choose a file to upload');
    const collectionId = form.collectionId ? Number(form.collectionId) : null;
    const mime = file.type || 'application/octet-stream';
    const assetId = saveAsset(c.var.user.id, 'file', new Uint8Array(await file.arrayBuffer()), mime, file.name);
    const bookmark = createBookmark(c.var.user.id, {
      title: file.name.replace(/\.[^.]+$/, ''),
      type: typeFromMime(mime) ?? 'document',
      fileAssetId: assetId,
      collectionId: Number.isInteger(collectionId) && collectionId! > 0 ? collectionId : null,
      source: sourceOf(c),
    });
    return c.json(bookmark, 201);
  })
  .post('/bookmarks/bulk', async (c) => {
    const body = parse(bulkBody, await c.req.json());
    const { ids, ...action } = body;
    const count = bulkUpdate(c.var.user.id, ids, action as BulkAction);
    return c.json({ count });
  })
  .delete('/trash', (c) => c.json({ count: emptyTrash(c.var.user.id) }))
  .get('/bookmarks/:id', (c) => c.json(getBookmark(c.var.user.id, intParam(c.req.param('id')))))
  .patch('/bookmarks/:id', async (c) => {
    const body = parse(updateBody, await c.req.json());
    return c.json(updateBookmark(c.var.user.id, intParam(c.req.param('id')), body));
  })
  .delete('/bookmarks/:id', (c) => {
    const bid = intParam(c.req.param('id'));
    getBookmark(c.var.user.id, bid);
    bulkUpdate(c.var.user.id, [bid], { action: c.req.query('permanent') === 'true' ? 'delete' : 'trash' });
    return c.json({ ok: true });
  })
  .get('/bookmarks/:id/content', (c) => c.json(getContent(c.var.user.id, intParam(c.req.param('id')))))
  .post('/bookmarks/:id/reorder', async (c) => {
    const body = parse(z.object({ prevId: id.nullable(), nextId: id.nullable() }), await c.req.json());
    return c.json(reorderBookmark(c.var.user.id, intParam(c.req.param('id')), body.prevId, body.nextId));
  })
  .post('/bookmarks/:id/refetch', (c) => {
    const bid = intParam(c.req.param('id'));
    bulkUpdate(c.var.user.id, [bid], { action: 'refetch' });
    return c.json(getBookmark(c.var.user.id, bid));
  });
