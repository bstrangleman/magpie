import type { Collection, CollectionGroup } from '../../../shared/types.ts';

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

const sameYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const otherYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' });

export function shortDate(ms: number) {
  const d = new Date(ms);
  return d.getFullYear() === new Date().getFullYear() ? sameYear.format(d) : otherYear.format(d);
}

export const longDate = (ms: number) => full.format(new Date(ms));

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export interface TreeNode {
  collection: Collection;
  children: TreeNode[];
  depth: number;
}

/** Build per-group collection trees. Roots without a (known) group land in the first group. */
export function buildTrees(groups: CollectionGroup[], collections: Collection[]) {
  const byParent = new Map<number | null, Collection[]>();
  const ids = new Set(collections.map((c) => c.id));
  for (const c of collections) {
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), c]);
  }
  const build = (c: Collection, depth: number): TreeNode => ({
    collection: c,
    depth,
    children: (byParent.get(c.id) ?? []).map((child) => build(child, depth + 1)),
  });
  const groupIds = new Set(groups.map((g) => g.id));
  const fallback = groups[0]?.id ?? null;
  const roots = new Map<number | null, TreeNode[]>();
  for (const c of byParent.get(null) ?? []) {
    const gid = c.groupId && groupIds.has(c.groupId) ? c.groupId : fallback;
    roots.set(gid, [...(roots.get(gid) ?? []), build(c, 0)]);
  }
  return roots;
}

/** Collections in display order, flattened with depth (for pickers). */
export function flattenTrees(groups: CollectionGroup[], collections: Collection[]) {
  const trees = buildTrees(groups, collections);
  const out: { group: CollectionGroup; items: { collection: Collection; depth: number }[] }[] = [];
  const walk = (nodes: TreeNode[], items: { collection: Collection; depth: number }[]) => {
    for (const n of nodes) {
      items.push({ collection: n.collection, depth: n.depth });
      walk(n.children, items);
    }
  };
  for (const g of groups) {
    const items: { collection: Collection; depth: number }[] = [];
    walk(trees.get(g.id) ?? [], items);
    out.push({ group: g, items });
  }
  return out;
}

export function descendantIds(collections: Collection[], id: number): Set<number> {
  const out = new Set<number>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of collections) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

export function collectionPath(collections: Collection[], id: number | null): Collection[] {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const path: Collection[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur && path.length < 50) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** Markdown → a one-line plain-text excerpt. */
export const plainText = (md: string) =>
  md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export const youtubeId = (url: string | null) =>
  url?.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;
