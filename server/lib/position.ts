import { all, run, type Param } from '../db/index.ts';

/** A sort position between two neighbours (either may be missing). */
export function between(prev: number | null | undefined, next: number | null | undefined): number {
  if (prev == null && next == null) return 0;
  if (prev == null) return next! - 1;
  if (next == null) return prev + 1;
  return (prev + next) / 2;
}

/** True when two neighbours are too close to fit another position between them. */
export function tooClose(prev: number | null | undefined, next: number | null | undefined) {
  return prev != null && next != null && Math.abs(next - prev) < 1e-9;
}

/** Re-number positions 0..n for rows matching `where`, preserving their order. */
export function renumber(table: 'bookmarks' | 'collections' | 'collection_groups', where: string, ...params: Param[]) {
  const rows = all<{ id: number }>(`SELECT id FROM ${table} WHERE ${where} ORDER BY position, id`, ...params);
  rows.forEach((r, i) => run(`UPDATE ${table} SET position = ? WHERE id = ?`, i, r.id));
}
