import fs from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from '../lib/auth.ts';
import { badRequest, intParam, notFound } from '../lib/http.ts';
import { assetPath, getAsset, isInlineSafe } from '../services/assets.ts';
import { createBackup, deleteBackup, listBackups, readBackup } from '../services/backups.ts';
import { getCollection } from '../services/collections.ts';
import { buildExport, importBookmarks, parseImport, toCsv, toNetscape, type ExportData } from '../services/io.ts';

const FORMATS = {
  html: { ext: 'html', type: 'text/html; charset=utf-8', render: toNetscape },
  csv: { ext: 'csv', type: 'text/csv; charset=utf-8', render: toCsv },
  json: { ext: 'json', type: 'application/json', render: (d: ExportData) => JSON.stringify(d, null, 2) },
} as const;

function formatOf(value: string | undefined) {
  const format = FORMATS[(value ?? 'html') as keyof typeof FORMATS];
  if (!format) throw badRequest('Format must be html, csv or json');
  return format;
}

const slug = (s: string) => s.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'bookmarks';
const stamp = (t: number) => new Date(t).toISOString().slice(0, 10);
const download = (name: string) => `attachment; filename="${name}"`;

export const ioRoutes = new Hono<AppEnv>()
  .post('/import', bodyLimit({ maxSize: 100 * 1024 * 1024, onError: () => { throw badRequest('File is too large'); } }), async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File) || !file.size) throw badRequest('Choose a file to import');
    let parsed;
    try {
      parsed = parseImport(file.name, await file.text());
    } catch (err) {
      throw badRequest(`Couldn't read that file: ${(err as Error).message}`);
    }
    if (!parsed.items.length) throw badRequest('No bookmarks found in that file');
    return c.json(
      importBookmarks(c.var.user.id, parsed, {
        skipDuplicates: form.skipDuplicates !== 'false',
        fetchMetadata: form.fetchMetadata !== 'false',
      }),
    );
  })
  .get('/export', (c) => {
    const format = formatOf(c.req.query('format'));
    const collectionId = c.req.query('collection') ? intParam(c.req.query('collection')) : undefined;
    const name = collectionId ? slug(getCollection(c.var.user.id, collectionId).name) : 'magpie';
    const body = format.render(buildExport(c.var.user.id, collectionId));
    return c.body(body, 200, {
      'content-type': format.type,
      'content-disposition': download(`${name}-${stamp(Date.now())}.${format.ext}`),
    });
  })
  .get('/backups', (c) => c.json(listBackups(c.var.user.id)))
  .post('/backups', (c) => c.json(createBackup(c.var.user.id), 201))
  .get('/backups/:id/download', (c) => {
    const format = formatOf(c.req.query('format'));
    const { data, createdAt } = readBackup(c.var.user.id, intParam(c.req.param('id')));
    return c.body(format.render(data), 200, {
      'content-type': format.type,
      'content-disposition': download(`magpie-backup-${stamp(createdAt)}.${format.ext}`),
    });
  })
  .delete('/backups/:id', (c) => {
    deleteBackup(c.var.user.id, intParam(c.req.param('id')));
    return c.json({ ok: true });
  })
  .get('/assets/:id', (c) => {
    const asset = getAsset(c.var.user.id, intParam(c.req.param('id')));
    const file = asset && assetPath(asset.id);
    if (!asset || !file || !fs.existsSync(file)) throw notFound('File not found');
    const size = fs.statSync(file).size;
    const inline = isInlineSafe(asset.mime);
    const headers: Record<string, string> = {
      'content-type': inline ? asset.mime : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=31536000, immutable',
      'accept-ranges': 'bytes',
    };
    if (asset.mime !== 'application/pdf') headers['content-security-policy'] = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'";

    // Byte ranges: Safari won't play video without them, and they make seeking work everywhere.
    const range = parseRange(c.req.header('range'), size);
    if (range === 'unsatisfiable') return c.body(null, 416, { ...headers, 'content-range': `bytes */${size}` });
    const { start, end } = range ?? { start: 0, end: size - 1 };
    headers['content-length'] = String(Math.max(end - start + 1, 0));
    if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
    if (!size) return c.body(null, 200, headers);
    return c.body(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, range ? 206 : 200, headers);
  });

/**
 * A single "bytes=" range from a Range header, clamped to the file. Null means send the whole
 * file (no header, or one we don't handle, such as several ranges).
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // bytes=-500: the last 500 bytes.
    const suffix = Number(m[2]);
    if (!suffix) return 'unsatisfiable';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}
