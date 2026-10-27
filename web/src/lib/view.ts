import {
  ArticleIcon,
  CloudIcon,
  CopyIcon,
  FilesIcon,
  GhostIcon,
  HashIcon,
  HeartIcon,
  ImageIcon,
  LinkIcon,
  MusicNotesIcon,
  NoteIcon,
  TrashIcon,
  TrayIcon,
  VideoIcon,
  type Icon,
} from '@phosphor-icons/react';
import { FILTERS, type Filter, type Sort } from '../../../shared/types.ts';

export type View =
  | { kind: 'all' }
  | { kind: 'unsorted' }
  | { kind: 'trash' }
  | { kind: 'collection'; id: number }
  | { kind: 'filter'; filter: Filter }
  | { kind: 'tag'; tag: string };

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function viewFromPath(pathname: string): View | null {
  const [, a, b] = pathname.split('/').map(safeDecode);
  if (a === 'all') return { kind: 'all' };
  if (a === 'unsorted') return { kind: 'unsorted' };
  if (a === 'trash') return { kind: 'trash' };
  if (a === 'collection' && Number(b) > 0) return { kind: 'collection', id: Number(b) };
  if (a === 'filter' && (FILTERS as readonly string[]).includes(b ?? '')) return { kind: 'filter', filter: b as Filter };
  if (a === 'tag' && b) return { kind: 'tag', tag: b };
  return null;
}

export function pathOf(view: View): string {
  switch (view.kind) {
    case 'collection':
      return `/collection/${view.id}`;
    case 'filter':
      return `/filter/${view.filter}`;
    case 'tag':
      return `/tag/${encodeURIComponent(view.tag)}`;
    default:
      return `/${view.kind}`;
  }
}

/** Key for remembering view/sort preferences per view. All tags share one entry. */
export function viewKey(view: View): string {
  switch (view.kind) {
    case 'collection':
      return `c:${view.id}`;
    case 'filter':
      return `f:${view.filter}`;
    case 'tag':
      return 'tags';
    default:
      return view.kind;
  }
}

export const sameView = (a: View, b: View) => pathOf(a) === pathOf(b);

export const canSortManually = (view: View) => view.kind === 'collection' || view.kind === 'unsorted';

export function defaultSort(view: View): Sort {
  return canSortManually(view) ? 'manual' : '-created';
}

/** The viewer's time zone, for before:/after: dates in searches and for statistics. */
export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function listQuery(view: View, q: string, sort: Sort): string {
  const p = new URLSearchParams({ view: view.kind, sort });
  if (view.kind === 'collection') p.set('collection', String(view.id));
  if (view.kind === 'filter') p.set('filter', view.filter);
  if (view.kind === 'tag') p.set('tag', view.tag);
  if (q.trim()) {
    p.set('q', q.trim());
    // before:/after: dates are days where you are.
    p.set('tz', timeZone());
  }
  return p.toString();
}

export const SYSTEM_VIEWS: { kind: 'all' | 'unsorted' | 'trash'; label: string; icon: Icon }[] = [
  { kind: 'all', label: 'All bookmarks', icon: CloudIcon },
  { kind: 'unsorted', label: 'Unsorted', icon: TrayIcon },
  { kind: 'trash', label: 'Trash', icon: TrashIcon },
];

export const FILTER_META: Record<Filter, { label: string; icon: Icon; color: string }> = {
  favorites: { label: 'Favorites', icon: HeartIcon, color: '#e5484d' },
  notes: { label: 'Notes', icon: NoteIcon, color: '#e2a336' },
  links: { label: 'Links', icon: LinkIcon, color: '#8b8d98' },
  articles: { label: 'Articles', icon: ArticleIcon, color: '#e5803a' },
  videos: { label: 'Video', icon: VideoIcon, color: '#6e56cf' },
  images: { label: 'Images', icon: ImageIcon, color: '#30a46c' },
  audios: { label: 'Audio', icon: MusicNotesIcon, color: '#8e4ec6' },
  documents: { label: 'Documents', icon: FilesIcon, color: '#3e63dd' },
  broken: { label: 'Broken links', icon: GhostIcon, color: '#e5484d' },
  duplicates: { label: 'Duplicates', icon: CopyIcon, color: '#12a594' },
  untagged: { label: 'Without tags', icon: HashIcon, color: '#8b8d98' },
};

export const SORT_LABELS: Record<Sort, string> = {
  manual: 'Manual',
  '-created': 'By date ↓',
  created: 'By date ↑',
  title: 'By name (A-Z)',
  '-title': 'By name (Z-A)',
  site: 'Sites (A-Z)',
  '-site': 'Sites (Z-A)',
  relevance: 'Relevance',
};
