import dns from 'node:dns';
import net, { type LookupFunction } from 'node:net';
import { Agent, fetch } from 'undici';
import { config } from '../config.ts';
import { get, now, run } from '../db/index.ts';
import { deleteAssets, pruneFavicons, saveAsset } from './assets.ts';
import { clean, type Metadata, typeFromMime } from './extract.ts';
import { extractInWorker } from './extract-pool.ts';
import { reindex } from './search-index.ts';

export { extractMetadata, typeFromMime, type Metadata } from './extract.ts';

export class BlockedError extends Error {}

/** True for a BlockedError, including one fetch() wrapped as the cause of "fetch failed". */
export const isBlocked = (err: unknown) =>
  err instanceof BlockedError || (err as { cause?: unknown } | null)?.cause instanceof BlockedError;

// --- Safe fetching -----------------------------------------------------------

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

function isPrivateAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mapped) return blocked.check(mapped, 'ipv4');
  return blocked.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

/** Refuse hosts that are private by name, or IP literals in private ranges (these never reach a DNS lookup). */
function assertPublicHost(hostname: string) {
  if (config.fetchAllowPrivate) return;
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new BlockedError(`Blocked private host ${host}`);
  }
  if (net.isIP(host) && isPrivateAddress(host)) throw new BlockedError(`Blocked private address ${host}`);
}

/**
 * DNS lookup for outgoing connections that refuses private addresses. Checking here, at connect
 * time, means the address that's checked is the one that's used: resolving once to check and
 * letting fetch() resolve again would let a rebinding DNS server answer differently the second time.
 */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (!err && !config.fetchAllowPrivate && addresses.some((a) => isPrivateAddress(a.address))) {
      err = new BlockedError(`Blocked private address for ${hostname}`);
    }
    if (err) return options.all ? callback(err, []) : callback(err, '', 0);
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

const agent = new Agent({ connect: { lookup: safeLookup } });

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  /** The response was longer than maxBytes, so `body` is cut short. */
  truncated: boolean;
}

/** fetch() with redirect-by-redirect host checks, a timeout, and a response size cap. */
export async function safeFetch(input: string, opts: { maxBytes: number; accept: string }): Promise<FetchResult> {
  const signal = AbortSignal.timeout(config.fetchTimeoutMs);
  let current = input;
  for (let hop = 0; hop < 6; hop++) {
    const url = new URL(current);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedError(`Unsupported protocol ${url.protocol}`);
    assertPublicHost(url.hostname);
    const res = await fetch(url, {
      dispatcher: agent,
      redirect: 'manual',
      signal,
      headers: { 'user-agent': config.fetchUserAgent, accept: opts.accept, 'accept-language': 'en-US,en;q=0.9' },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, url).href;
      continue;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    if (res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
        if (size >= opts.maxBytes) {
          truncated = true;
          await reader.cancel();
          break;
        }
      }
    }
    return {
      url: url.href,
      status: res.status,
      contentType: (res.headers.get('content-type') ?? '').toLowerCase(),
      body: Buffer.concat(chunks),
      truncated,
    };
  }
  throw new Error('Too many redirects');
}

// --- Metadata ------------------------------------------------------------------

function decode(body: Buffer, contentType: string): string {
  const head = body.subarray(0, 4096).toString('latin1');
  const charset =
    contentType.match(/charset=["']?([\w-]+)/i)?.[1] ??
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/** decodeURIComponent that leaves malformed escapes ("50%-off") as they are instead of throwing. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function oembed(pageUrl: string): Promise<{ title?: string; thumbnail_url?: string } | null> {
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const endpoint =
    host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com'
      ? 'https://www.youtube.com/oembed'
      : host === 'vimeo.com'
        ? 'https://vimeo.com/api/oembed.json'
        : null;
  if (!endpoint) return null;
  try {
    const res = await safeFetch(`${endpoint}?format=json&url=${encodeURIComponent(pageUrl)}`, { maxBytes: 100_000, accept: 'application/json' });
    return res.status === 200 ? JSON.parse(res.body.toString('utf8')) : null;
  } catch {
    return null;
  }
}

/** Download a preview image and store it locally so covers keep working if the source changes. */
async function cacheCover(userId: number, imageUrl: string): Promise<number | null> {
  try {
    const res = await safeFetch(imageUrl, { maxBytes: 8 * 1024 * 1024, accept: 'image/avif,image/webp,image/png,image/jpeg,image/*' });
    const mime = res.contentType.split(';')[0]!.trim();
    if (res.status !== 200 || res.truncated || !/^image\/(png|jpe?g|gif|webp|avif)$/.test(mime) || res.body.byteLength < 100) return null;
    return saveAsset(userId, 'cover', res.body, mime, new URL(res.url).pathname.split('/').pop() || 'cover');
  } catch {
    return null;
  }
}

/** The image type of a small file, from its first bytes. Only raster formats: SVG can carry script. */
export function sniffImage(body: Uint8Array): string | null {
  const b = body;
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (Buffer.from(b.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Store a site's icon locally (once per user and icon URL), so the app doesn't load icons from
 * other sites on every page view. Falls back to /favicon.ico when the declared icon is unusable.
 */
async function cacheFavicon(userId: number, iconUrl: string | null, pageUrl: string) {
  if (!iconUrl || get('SELECT 1 FROM favicons WHERE user_id = ? AND url = ?', userId, iconUrl)) return;
  for (const candidate of new Set([iconUrl, new URL('/favicon.ico', pageUrl).href])) {
    try {
      const res = await safeFetch(candidate, { maxBytes: 256 * 1024, accept: 'image/png,image/x-icon,image/*;q=0.8' });
      const mime = sniffImage(res.body);
      if (res.status !== 200 || res.truncated || !mime) continue;
      const assetId = saveAsset(userId, 'favicon', res.body, mime, 'favicon');
      const { changes } = run('INSERT OR IGNORE INTO favicons (user_id, url, asset_id, created_at) VALUES (?, ?, ?, ?)', userId, iconUrl, assetId, now());
      if (!changes) deleteAssets([assetId]); // another fetch cached it first
      return;
    } catch {
      // Try the next candidate.
    }
  }
}

// --- Processing a bookmark -----------------------------------------------------

type PendingRow = { id: number; user_id: number; url: string | null; type: Metadata['type']; file_asset_id: number | null; cover_asset_id: number | null };

/** A readable fallback title from the URL ("/the-food-lab-guide" → "The food lab guide"). */
export function titleFromUrl(input: string): string {
  const url = new URL(input);
  const slug = safeDecode(url.pathname.split('/').filter(Boolean).pop() ?? '')
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim();
  const text = slug && !/^\d+$/.test(slug) ? slug : url.hostname.replace(/^www\./, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const errorCode = (err: unknown): string | undefined => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
};

/**
 * Fetch metadata + readable content for a bookmark and store it. Every write is conditional on the
 * URL being unchanged: if it was edited (or the bookmark deleted) mid-fetch, these results are stale.
 */
export async function processBookmark(id: number) {
  const b = get<PendingRow>('SELECT id, user_id, url, type, file_asset_id, cover_asset_id FROM bookmarks WHERE id = ?', id);
  if (!b) return;
  if (!b.url || b.file_asset_id || b.type === 'note') {
    run("UPDATE bookmarks SET fetch_status = 'skipped' WHERE id = ?", id);
    return;
  }
  const url = b.url;

  try {
    const res = await safeFetch(url, { maxBytes: 5 * 1024 * 1024, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' });
    if (res.status >= 400) {
      run(
        `UPDATE bookmarks SET fetch_status = 'failed', http_status = ?, broken = ?, fetched_at = ?,
           title = CASE WHEN title = '' THEN ? ELSE title END WHERE id = ? AND url = ?`,
        res.status,
        res.status === 404 || res.status === 410,
        now(),
        titleFromUrl(url),
        id,
        url,
      );
      reindex([id]);
      return;
    }

    const mime = res.contentType.split(';')[0]!.trim();
    let meta: Metadata;
    if (!mime || mime.includes('html') || mime.includes('xml')) {
      meta = await extractInWorker(decode(res.body, res.contentType), res.url);
    } else {
      const fileName = safeDecode(new URL(res.url).pathname.split('/').pop() ?? '');
      meta = {
        title: fileName || null,
        description: null,
        image: mime.startsWith('image/') ? res.url : null,
        favicon: new URL('/favicon.ico', res.url).href,
        type: typeFromMime(mime) ?? 'link',
        contentHtml: null,
        contentText: null,
      };
    }

    const embed = await oembed(res.url);
    if (embed?.title) meta.title = clean(embed.title);
    if (embed?.thumbnail_url) meta.image = embed.thumbnail_url;

    const coverAssetId = meta.image ? await cacheCover(b.user_id, meta.image) : null;
    await cacheFavicon(b.user_id, meta.favicon, res.url);

    const { changes } = run(
      `UPDATE bookmarks SET
         title = CASE WHEN title = '' THEN ? ELSE title END,
         description = CASE WHEN description = '' THEN ? ELSE description END,
         cover_url = ?, cover_asset_id = COALESCE(?, cover_asset_id), favicon_url = ?, type = ?,
         content_html = ?, content_text = ?,
         fetch_status = 'done', http_status = ?, broken = 0, fetched_at = ?
       WHERE id = ? AND url = ?`,
      meta.title ?? '',
      meta.description ?? '',
      meta.image,
      coverAssetId,
      meta.favicon,
      meta.type,
      meta.contentHtml,
      meta.contentText,
      res.status,
      now(),
      id,
      url,
    );
    if (!changes) {
      // Deleted or re-pointed while we were fetching: don't leave the new cover or icon behind.
      if (coverAssetId) deleteAssets([coverAssetId]);
      pruneFavicons(b.user_id);
      return;
    }
    if (coverAssetId && b.cover_asset_id) deleteAssets([b.cover_asset_id]);
    reindex([id]);
  } catch (err) {
    if (isBlocked(err)) {
      run("UPDATE bookmarks SET fetch_status = 'skipped', fetched_at = ? WHERE id = ? AND url = ?", now(), id, url);
      return;
    }
    const code = errorCode(err);
    run(
      `UPDATE bookmarks SET fetch_status = 'failed', broken = ?, fetched_at = ?,
         title = CASE WHEN title = '' THEN ? ELSE title END WHERE id = ? AND url = ?`,
      code === 'ENOTFOUND' || code === 'ECONNREFUSED',
      now(),
      titleFromUrl(url),
      id,
      url,
    );
    reindex([id]);
  }
}
