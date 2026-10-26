// Types shared by the server and the web client.

export const BOOKMARK_TYPES = ['link', 'article', 'video', 'image', 'audio', 'document', 'note'] as const;
export type BookmarkType = (typeof BOOKMARK_TYPES)[number];

export type FetchStatus = 'pending' | 'done' | 'failed' | 'skipped';

/** Where a bookmark was saved from. */
export const BOOKMARK_SOURCES = ['web', 'bookmarklet', 'extension', 'api', 'import'] as const;
export type BookmarkSource = (typeof BOOKMARK_SOURCES)[number];

export const FILTERS = [
  'favorites',
  'notes',
  'links',
  'articles',
  'videos',
  'images',
  'audios',
  'documents',
  'broken',
  'duplicates',
  'untagged',
] as const;
export type Filter = (typeof FILTERS)[number];

export const SORTS = ['manual', '-created', 'created', 'title', '-title', 'site', '-site', 'relevance'] as const;
export type Sort = (typeof SORTS)[number];

export const VIEW_MODES = ['list', 'cards', 'headlines', 'moodboard'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const THEMES = ['system', 'light', 'dark', 'dark-sidebar', 'sepia'] as const;
export type Theme = (typeof THEMES)[number];

/** The browser extension is packaged once per browser family (scripts/package-extension.ts). */
export const EXTENSION_BROWSERS = ['chrome', 'firefox'] as const;
export type ExtensionBrowser = (typeof EXTENSION_BROWSERS)[number];

export type OpenAction = 'tab' | 'preview' | 'edit';

export interface User {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
  createdAt: number;
}

export interface ViewPrefs {
  view?: ViewMode;
  sort?: Sort;
}

export interface UserSettings {
  theme: Theme;
  largeFont: boolean;
  defaultView: ViewMode;
  openAction: OpenAction;
  tagSort: 'name' | 'count';
  autoBackup: boolean;
  /** Per-view overrides, keyed by view key (e.g. "all", "c:12", "f:favorites"). */
  views: Record<string, ViewPrefs>;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  largeFont: false,
  defaultView: 'list',
  openAction: 'tab',
  tagSort: 'name',
  autoBackup: true,
  views: {},
};

export interface Me extends User {
  settings: UserSettings;
}

export interface Bookmark {
  id: number;
  type: BookmarkType;
  url: string | null;
  title: string;
  description: string;
  note: string;
  site: string | null;
  cover: string | null;
  favicon: string | null;
  file: { url: string; mime: string; size: number; name: string } | null;
  collectionId: number | null;
  tags: string[];
  favorite: boolean;
  fetchStatus: FetchStatus;
  broken: boolean;
  hasContent: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface BookmarkContent {
  html: string | null;
  text: string | null;
}

export interface BookmarkPage {
  items: Bookmark[];
  total: number;
  nextOffset: number | null;
}

// A collection's icon is an emoji, or a Phosphor icon (phosphoricons.com) stored as "ph:<name>", e.g. "ph:camera".
export const PHOSPHOR_PREFIX = 'ph:';

/** The Phosphor icon name in a stored icon, or null for an emoji (or no icon). */
export const phosphorName = (icon: string | null | undefined) => (icon?.startsWith(PHOSPHOR_PREFIX) ? icon.slice(PHOSPHOR_PREFIX.length) : null);

export interface Collection {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  parentId: number | null;
  groupId: number | null;
  position: number;
  collapsed: boolean;
  count: number;
}

export interface CollectionGroup {
  id: number;
  name: string;
  position: number;
  collapsed: boolean;
}

export interface Tag {
  id: number;
  name: string;
  count: number;
}

export interface Counts {
  all: number;
  unsorted: number;
  trash: number;
  filters: Record<Filter, number>;
}

export interface Sidebar {
  counts: Counts;
  groups: CollectionGroup[];
  collections: Collection[];
  tags: Tag[];
}

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface Backup {
  id: number;
  createdAt: number;
  bookmarkCount: number;
  size: number;
  automatic: boolean;
}

export interface ImportResult {
  format: string;
  created: number;
  skipped: number;
  collections: number;
  errors: string[];
}

export interface Stats {
  timeZone: string;
  firstSavedAt: number | null;
  totals: { bookmarks: number; favorites: number; collections: number; tags: number; notes: number; files: number };
  activity: {
    thisWeek: number;
    lastWeek: number;
    thisMonth: number;
    lastMonth: number;
    thisYear: number;
    lastYear: number;
    /** One entry per day for the last 53 weeks (oldest first, starting on a Monday), in `timeZone`. */
    days: { date: string; count: number }[];
    /** The last 12 calendar months, oldest first ("YYYY-MM"). */
    months: { month: string; count: number }[];
    /** Monday … Sunday. */
    byWeekday: number[];
    /** 00:00 … 23:00. */
    byHour: number[];
  };
  types: { type: BookmarkType; count: number }[];
  sources: { source: BookmarkSource | 'unknown'; count: number }[];
  topSites: { site: string; count: number; favicon: string | null }[];
  topTags: { name: string; count: number }[];
  topCollections: { id: number; name: string; icon: string | null; color: string | null; count: number }[];
  reading: { articles: number; words: number };
  storage: { total: number; groups: { label: string; count: number; size: number }[] };
  health: { broken: number; duplicates: number; untagged: number; unsorted: number; pending: number; failed: number; trash: number };
}

export interface AuthStatus {
  hasUsers: boolean;
  signupsEnabled: boolean;
}

export type BulkAction =
  | { action: 'move'; collectionId: number | null }
  | { action: 'addTags'; tags: string[] }
  | { action: 'removeTags'; tags: string[] }
  | { action: 'favorite'; value: boolean }
  | { action: 'trash' }
  | { action: 'restore' }
  | { action: 'delete' }
  | { action: 'refetch' };
