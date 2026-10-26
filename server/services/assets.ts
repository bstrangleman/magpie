import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { all, get, now, run } from '../db/index.ts';

export interface AssetRow {
  id: number;
  user_id: number;
  kind: 'file' | 'cover' | 'favicon';
  mime: string;
  size: number;
  filename: string;
}

const dir = () => path.join(config.dataDir, 'assets');
export const assetPath = (id: number) => path.join(dir(), String(id));

export function saveAsset(userId: number, kind: AssetRow['kind'], data: Uint8Array, mime: string, filename: string): number {
  fs.mkdirSync(dir(), { recursive: true });
  const { lastId } = run(
    'INSERT INTO assets (user_id, kind, mime, size, filename, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId,
    kind,
    mime,
    data.byteLength,
    filename.slice(0, 255),
    now(),
  );
  try {
    fs.writeFileSync(assetPath(lastId), data);
  } catch (err) {
    run('DELETE FROM assets WHERE id = ?', lastId);
    throw err;
  }
  return lastId;
}

export function getAsset(userId: number, id: number): AssetRow | undefined {
  return get<AssetRow>('SELECT * FROM assets WHERE id = ? AND user_id = ?', id, userId);
}

export function deleteAssets(ids: (number | null | undefined)[]) {
  for (const id of ids) {
    if (!id) continue;
    run('DELETE FROM assets WHERE id = ?', id);
    fs.rmSync(assetPath(id), { force: true });
  }
}

/** Delete cached site icons that no remaining bookmark of this user points at. */
export function pruneFavicons(userId: number) {
  const inUse = new Set(
    all<{ u: string }>('SELECT DISTINCT favicon_url AS u FROM bookmarks WHERE user_id = ? AND favicon_url IS NOT NULL', userId).map((r) => r.u),
  );
  const unused = all<{ url: string; asset_id: number }>('SELECT url, asset_id FROM favicons WHERE user_id = ?', userId).filter((f) => !inUse.has(f.url));
  deleteAssets(unused.map((f) => f.asset_id));
}

/** Types that are safe to render inline from our origin. Everything else is served as a download. */
export function isInlineSafe(mime: string) {
  return (
    /^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/.test(mime) ||
    /^(audio|video)\//.test(mime) ||
    mime === 'application/pdf' ||
    mime === 'text/plain'
  );
}
