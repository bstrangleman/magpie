import type { Tag } from '../../shared/types.ts';
import { all, get, now, placeholders, run, tx } from '../db/index.ts';
import { badRequest, notFound } from '../lib/http.ts';
import { reindex } from './search-index.ts';

export function normalizeTag(name: string): string {
  return name.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 64);
}

export function normalizeTags(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const n of names.map(normalizeTag)) if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  return [...seen.values()];
}

/** Get tag ids for names, creating tags that don't exist yet. */
function ensureTags(userId: number, names: string[]): number[] {
  const ids: number[] = [];
  for (const name of normalizeTags(names)) {
    run('INSERT OR IGNORE INTO tags (user_id, name, created_at) VALUES (?, ?, ?)', userId, name, now());
    ids.push(get<{ id: number }>('SELECT id FROM tags WHERE user_id = ? AND name = ?', userId, name)!.id);
  }
  return ids;
}

/** Delete tags no longer attached to any bookmark. */
export function pruneTags(userId: number) {
  run(
    'DELETE FROM tags WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.tag_id = tags.id)',
    userId,
  );
}

export function setBookmarkTags(userId: number, bookmarkId: number, names: string[]) {
  const ids = ensureTags(userId, names);
  run('DELETE FROM bookmark_tags WHERE bookmark_id = ?', bookmarkId);
  for (const id of ids) run('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)', bookmarkId, id);
}

export function addTags(userId: number, bookmarkIds: number[], names: string[]) {
  const ids = ensureTags(userId, names);
  for (const b of bookmarkIds)
    for (const t of ids) run('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)', b, t);
}

export function removeTags(userId: number, bookmarkIds: number[], names: string[]) {
  const tagIds = normalizeTags(names)
    .map((n) => get<{ id: number }>('SELECT id FROM tags WHERE user_id = ? AND name = ?', userId, n)?.id)
    .filter((id): id is number => id !== undefined);
  if (!tagIds.length || !bookmarkIds.length) return;
  run(
    `DELETE FROM bookmark_tags WHERE bookmark_id IN (${placeholders(bookmarkIds.length)}) AND tag_id IN (${placeholders(tagIds.length)})`,
    ...bookmarkIds,
    ...tagIds,
  );
  pruneTags(userId);
}

export function tagsFor(bookmarkIds: number[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (let i = 0; i < bookmarkIds.length; i += 500) {
    const chunk = bookmarkIds.slice(i, i + 500);
    for (const r of all<{ bookmark_id: number; name: string }>(
      `SELECT bt.bookmark_id, t.name FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
       WHERE bt.bookmark_id IN (${placeholders(chunk.length)}) ORDER BY t.name COLLATE NOCASE`,
      ...chunk,
    )) {
      const list = map.get(r.bookmark_id);
      if (list) list.push(r.name);
      else map.set(r.bookmark_id, [r.name]);
    }
  }
  return map;
}

/** Tags with the number of (non-trashed) bookmarks using them. */
export function listTags(userId: number): Tag[] {
  return all<Tag>(
    `SELECT t.id, t.name, COUNT(b.id) AS count
     FROM tags t
     LEFT JOIN bookmark_tags bt ON bt.tag_id = t.id
     LEFT JOIN bookmarks b ON b.id = bt.bookmark_id AND b.deleted_at IS NULL
     WHERE t.user_id = ?
     GROUP BY t.id
     ORDER BY t.name COLLATE NOCASE`,
    userId,
  );
}

const affected = (tagId: number) =>
  all<{ bookmark_id: number }>('SELECT bookmark_id FROM bookmark_tags WHERE tag_id = ?', tagId).map((r) => r.bookmark_id);

/** Rename a tag. Renaming onto an existing tag merges the two. */
export function renameTag(userId: number, id: number, newName: string) {
  const name = normalizeTag(newName);
  if (!name) throw badRequest('Tag name is required');
  const tag = get<{ id: number; name: string }>('SELECT id, name FROM tags WHERE id = ? AND user_id = ?', id, userId);
  if (!tag) throw notFound('Tag not found');
  tx(() => {
    const bookmarks = affected(id);
    const target = get<{ id: number }>('SELECT id FROM tags WHERE user_id = ? AND name = ? AND id != ?', userId, name, id);
    if (target) {
      run('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) SELECT bookmark_id, ? FROM bookmark_tags WHERE tag_id = ?', target.id, id);
      run('DELETE FROM tags WHERE id = ?', id);
    } else {
      run('UPDATE tags SET name = ? WHERE id = ?', name, id);
    }
    reindex(bookmarks);
  });
}

export function deleteTag(userId: number, id: number) {
  const tag = get<{ id: number }>('SELECT id FROM tags WHERE id = ? AND user_id = ?', id, userId);
  if (!tag) throw notFound('Tag not found');
  tx(() => {
    const bookmarks = affected(id);
    run('DELETE FROM tags WHERE id = ?', id);
    reindex(bookmarks);
  });
}
