import type { Collection, CollectionGroup } from '../../shared/types.ts';
import { all, get, now, placeholders, run, tx } from '../db/index.ts';
import { badRequest, notFound } from '../lib/http.ts';
import { between, renumber, tooClose } from '../lib/position.ts';

type CollectionRow = {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  parent_id: number | null;
  group_id: number | null;
  position: number;
  collapsed: number;
  count: number;
};

const toCollection = (r: CollectionRow): Collection => ({
  id: r.id,
  name: r.name,
  icon: r.icon,
  color: r.color,
  parentId: r.parent_id,
  groupId: r.group_id,
  position: r.position,
  collapsed: !!r.collapsed,
  count: r.count,
});

// Bookmarks in a collection. Matching user_id and deleted_at too lets SQLite use the
// (user_id, deleted_at, collection_id) index instead of scanning every bookmark per collection.
const COUNT = `(SELECT COUNT(*) FROM bookmarks b
  WHERE b.user_id = c.user_id AND b.deleted_at IS NULL AND b.collection_id = c.id)`;

export function listCollections(userId: number): Collection[] {
  return all<CollectionRow>(
    `SELECT c.id, c.name, c.icon, c.color, c.parent_id, c.group_id, c.position, c.collapsed, ${COUNT} AS count
     FROM collections c WHERE c.user_id = ? ORDER BY c.position, c.id`,
    userId,
  ).map(toCollection);
}

export function getCollection(userId: number, id: number): Collection {
  const row = get<CollectionRow>(
    `SELECT c.*, ${COUNT} AS count FROM collections c WHERE c.id = ? AND c.user_id = ?`,
    id,
    userId,
  );
  if (!row) throw notFound('Collection not found');
  return toCollection(row);
}

export function assertCollection(userId: number, id: number | null | undefined) {
  if (id == null) return;
  if (!get('SELECT 1 FROM collections WHERE id = ? AND user_id = ?', id, userId)) throw badRequest('Unknown collection');
}

/** The collection id plus all nested collection ids. */
export function subtreeIds(userId: number, id: number): number[] {
  return all<{ id: number }>(
    `WITH RECURSIVE tree(id) AS (
       SELECT id FROM collections WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT c.id FROM collections c JOIN tree ON c.parent_id = tree.id
     ) SELECT id FROM tree`,
    id,
    userId,
  ).map((r) => r.id);
}

function defaultGroupId(userId: number): number {
  const g = get<{ id: number }>('SELECT id FROM collection_groups WHERE user_id = ? ORDER BY position, id LIMIT 1', userId);
  return g ? g.id : createGroup(userId, 'My Collections').id;
}

const siblingWhere = (parentId: number | null, groupId: number | null) =>
  parentId != null ? { sql: 'parent_id = ?', params: [parentId] } : { sql: 'parent_id IS NULL AND group_id IS ?', params: [groupId] };

export interface CollectionInput {
  name: string;
  icon?: string | null;
  color?: string | null;
  parentId?: number | null;
  groupId?: number | null;
}

export function createCollection(userId: number, input: CollectionInput): Collection {
  const name = input.name.trim();
  if (!name) throw badRequest('Collection name is required');
  const parentId = input.parentId ?? null;
  assertCollection(userId, parentId);
  let groupId: number | null = null;
  if (parentId == null) {
    groupId = input.groupId ?? defaultGroupId(userId);
    if (!get('SELECT 1 FROM collection_groups WHERE id = ? AND user_id = ?', groupId, userId)) throw badRequest('Unknown group');
  }
  const s = siblingWhere(parentId, groupId);
  const max = get<{ p: number | null }>(`SELECT MAX(position) AS p FROM collections WHERE user_id = ? AND ${s.sql}`, userId, ...s.params)?.p;
  const t = now();
  const { lastId } = run(
    `INSERT INTO collections (user_id, group_id, parent_id, name, icon, color, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    groupId,
    parentId,
    name.slice(0, 200),
    input.icon ?? null,
    input.color ?? null,
    between(max, null),
    t,
    t,
  );
  if (parentId != null) run('UPDATE collections SET collapsed = 0 WHERE id = ?', parentId);
  return getCollection(userId, lastId);
}

export function updateCollection(
  userId: number,
  id: number,
  patch: { name?: string; icon?: string | null; color?: string | null; collapsed?: boolean },
): Collection {
  getCollection(userId, id);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw badRequest('Collection name is required');
    run('UPDATE collections SET name = ? WHERE id = ?', name.slice(0, 200), id);
  }
  if (patch.icon !== undefined) run('UPDATE collections SET icon = ? WHERE id = ?', patch.icon || null, id);
  if (patch.color !== undefined) run('UPDATE collections SET color = ? WHERE id = ?', patch.color || null, id);
  if (patch.collapsed !== undefined) run('UPDATE collections SET collapsed = ? WHERE id = ?', patch.collapsed, id);
  run('UPDATE collections SET updated_at = ? WHERE id = ?', now(), id);
  return getCollection(userId, id);
}

export interface MoveInput {
  parentId: number | null;
  groupId?: number | null;
  /** Sibling that should end up directly before / after the moved collection. */
  prevId?: number | null;
  nextId?: number | null;
}

export function moveCollection(userId: number, id: number, input: MoveInput): Collection {
  getCollection(userId, id);
  const parentId = input.parentId ?? null;
  if (parentId != null) {
    assertCollection(userId, parentId);
    if (subtreeIds(userId, id).includes(parentId)) throw badRequest("Can't move a collection inside itself");
  }
  let groupId: number | null = null;
  if (parentId == null) {
    groupId = input.groupId ?? defaultGroupId(userId);
    if (!get('SELECT 1 FROM collection_groups WHERE id = ? AND user_id = ?', groupId, userId)) throw badRequest('Unknown group');
  }
  const s = siblingWhere(parentId, groupId);
  const siblingPos = (sid: number | null | undefined) =>
    sid == null
      ? null
      : (get<{ position: number }>(`SELECT position FROM collections WHERE id = ? AND user_id = ? AND ${s.sql}`, sid, userId, ...s.params)
          ?.position ?? null);

  return tx(() => {
    let prev = siblingPos(input.prevId);
    let next = siblingPos(input.nextId);
    if (prev == null && next == null) {
      prev = get<{ p: number | null }>(
        `SELECT MAX(position) AS p FROM collections WHERE user_id = ? AND id != ? AND ${s.sql}`,
        userId,
        id,
        ...s.params,
      )?.p ?? null;
    }
    if (tooClose(prev, next)) {
      renumber('collections', `user_id = ? AND ${s.sql}`, userId, ...s.params);
      prev = siblingPos(input.prevId);
      next = siblingPos(input.nextId);
    }
    run(
      'UPDATE collections SET parent_id = ?, group_id = ?, position = ?, updated_at = ? WHERE id = ?',
      parentId,
      groupId,
      between(prev, next),
      now(),
      id,
    );
    return getCollection(userId, id);
  });
}

/** Delete a collection and its nested collections. Their bookmarks go to the Trash. */
export function deleteCollection(userId: number, id: number) {
  const ids = subtreeIds(userId, id);
  if (!ids.length) throw notFound('Collection not found');
  tx(() => {
    run(
      `UPDATE bookmarks SET deleted_at = ?, collection_id = NULL
       WHERE user_id = ? AND collection_id IN (${placeholders(ids.length)}) AND deleted_at IS NULL`,
      now(),
      userId,
      ...ids,
    );
    run('DELETE FROM collections WHERE id = ? AND user_id = ?', id, userId);
  });
}

// --- Groups ------------------------------------------------------------------

type GroupRow = { id: number; name: string; position: number; collapsed: number };
const toGroup = (r: GroupRow): CollectionGroup => ({ id: r.id, name: r.name, position: r.position, collapsed: !!r.collapsed });

export function listGroups(userId: number): CollectionGroup[] {
  return all<GroupRow>('SELECT id, name, position, collapsed FROM collection_groups WHERE user_id = ? ORDER BY position, id', userId).map(
    toGroup,
  );
}

export function createGroup(userId: number, name: string): CollectionGroup {
  const clean = name.trim() || 'Untitled';
  const max = get<{ p: number | null }>('SELECT MAX(position) AS p FROM collection_groups WHERE user_id = ?', userId)?.p;
  const { lastId } = run(
    'INSERT INTO collection_groups (user_id, name, position, created_at) VALUES (?, ?, ?, ?)',
    userId,
    clean.slice(0, 100),
    between(max, null),
    now(),
  );
  return toGroup(get<GroupRow>('SELECT * FROM collection_groups WHERE id = ?', lastId)!);
}

export function updateGroup(
  userId: number,
  id: number,
  patch: { name?: string; collapsed?: boolean; prevId?: number | null; nextId?: number | null },
): CollectionGroup {
  const group = get<GroupRow>('SELECT * FROM collection_groups WHERE id = ? AND user_id = ?', id, userId);
  if (!group) throw notFound('Group not found');
  if (patch.name !== undefined && patch.name.trim()) run('UPDATE collection_groups SET name = ? WHERE id = ?', patch.name.trim().slice(0, 100), id);
  if (patch.collapsed !== undefined) run('UPDATE collection_groups SET collapsed = ? WHERE id = ?', patch.collapsed, id);
  if (patch.prevId !== undefined || patch.nextId !== undefined) {
    const pos = (gid: number | null | undefined) =>
      gid == null ? null : (get<{ position: number }>('SELECT position FROM collection_groups WHERE id = ? AND user_id = ?', gid, userId)?.position ?? null);
    let prev = pos(patch.prevId);
    let next = pos(patch.nextId);
    if (tooClose(prev, next)) {
      renumber('collection_groups', 'user_id = ?', userId);
      prev = pos(patch.prevId);
      next = pos(patch.nextId);
    }
    run('UPDATE collection_groups SET position = ? WHERE id = ?', between(prev, next), id);
  }
  return toGroup(get<GroupRow>('SELECT * FROM collection_groups WHERE id = ?', id)!);
}

/** Delete a group; its collections move to the first remaining group. */
export function deleteGroup(userId: number, id: number) {
  if (!get('SELECT 1 FROM collection_groups WHERE id = ? AND user_id = ?', id, userId)) throw notFound('Group not found');
  const fallback = get<{ id: number }>(
    'SELECT id FROM collection_groups WHERE user_id = ? AND id != ? ORDER BY position, id LIMIT 1',
    userId,
    id,
  );
  if (!fallback) throw badRequest("You can't delete your only group");
  tx(() => {
    const max = get<{ p: number | null }>(
      'SELECT MAX(position) AS p FROM collections WHERE user_id = ? AND parent_id IS NULL AND group_id = ?',
      userId,
      fallback.id,
    )?.p ?? 0;
    const moving = all<{ id: number }>(
      'SELECT id FROM collections WHERE user_id = ? AND parent_id IS NULL AND group_id = ? ORDER BY position',
      userId,
      id,
    );
    moving.forEach((c, i) => run('UPDATE collections SET group_id = ?, position = ? WHERE id = ?', fallback.id, max + 1 + i, c.id));
    run('DELETE FROM collection_groups WHERE id = ?', id);
  });
}

/** Find or create a collection path like ["Study", "Photography"] (used by importers). */
export function ensureCollectionPath(userId: number, path: string[], cache: Map<string, number>): number | null {
  let parentId: number | null = null;
  let key = '';
  for (const raw of path) {
    const name = raw.trim();
    if (!name) continue;
    key += `/${name.toLowerCase()}`;
    let id = cache.get(key);
    if (id === undefined) {
      const existing: { id: number } | undefined =
        parentId == null
          ? get<{ id: number }>('SELECT id FROM collections WHERE user_id = ? AND parent_id IS NULL AND name = ? COLLATE NOCASE', userId, name)
          : get<{ id: number }>('SELECT id FROM collections WHERE user_id = ? AND parent_id = ? AND name = ? COLLATE NOCASE', userId, parentId, name);
      id = existing?.id ?? createCollection(userId, { name, parentId }).id;
      cache.set(key, id);
    }
    parentId = id;
  }
  return parentId;
}
