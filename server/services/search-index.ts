import { all, get, placeholders, run } from '../db/index.ts';

type Row = { id: number; title: string; description: string; note: string; content_text: string | null; url: string | null };

/** Rebuild the full-text index entries for the given bookmarks. */
export function reindex(ids: number[]) {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = all<Row>(
      `SELECT id, title, description, note, content_text, url FROM bookmarks WHERE id IN (${placeholders(chunk.length)})`,
      ...chunk,
    );
    const tags = new Map<number, string[]>();
    for (const t of all<{ bookmark_id: number; name: string }>(
      `SELECT bt.bookmark_id, t.name FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
       WHERE bt.bookmark_id IN (${placeholders(chunk.length)})`,
      ...chunk,
    )) {
      tags.set(t.bookmark_id, [...(tags.get(t.bookmark_id) ?? []), t.name]);
    }
    for (const id of chunk) run('DELETE FROM bookmarks_fts WHERE rowid = ?', id);
    for (const r of rows) {
      run(
        'INSERT INTO bookmarks_fts (rowid, title, description, note, content, url, tags) VALUES (?, ?, ?, ?, ?, ?, ?)',
        r.id,
        r.title,
        r.description,
        r.note,
        r.content_text ?? '',
        r.url ?? '',
        (tags.get(r.id) ?? []).join(' '),
      );
    }
  }
}

export function unindex(ids: number[]) {
  for (const id of ids) run('DELETE FROM bookmarks_fts WHERE rowid = ?', id);
}

export function indexSize(): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM bookmarks_fts')?.n ?? 0;
}
