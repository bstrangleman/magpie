import { BOOKMARK_TYPES, type BookmarkType } from '../../shared/types.ts';
import { startOfDay } from './time.ts';

export interface ParsedQuery {
  /** FTS5 MATCH expression, or null when there is no free text. */
  match: string | null;
  /** FTS5 expression for excluded words and phrases (-word, -"a phrase"); matching bookmarks are left out. */
  exclude: string | null;
  tags: string[];
  excludeTags: string[];
  types: BookmarkType[];
  sites: string[];
  favorite: boolean | null;
  hasNote: boolean | null;
  before: number | null;
  after: number | null;
}

const TYPE_ALIASES: Record<string, BookmarkType> = {
  link: 'link',
  links: 'link',
  article: 'article',
  articles: 'article',
  video: 'video',
  videos: 'video',
  image: 'image',
  images: 'image',
  audio: 'audio',
  audios: 'audio',
  document: 'document',
  documents: 'document',
  doc: 'document',
  pdf: 'document',
  note: 'note',
  notes: 'note',
};

/** Split on whitespace, keeping "quoted phrases" (and key:"quoted values") together. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /(-?[\w#:.]*"[^"]*"?)|(\S+)/g;
  for (const m of input.matchAll(re)) tokens.push(m[0]);
  return tokens;
}

const unquote = (s: string) => s.replace(/^"|"$/g, '');

/** A plain date ("2024-01-31") means the start of that day where the user is; anything else Date.parse understands is used as is. */
function parseDate(value: string, timeZone: string): number | null {
  const day = startOfDay(value, timeZone);
  if (day !== null) return day;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Parse a search string. Supported operators:
 *   #tag  -#tag  tag:"two words"  is:fav  -is:fav  is:note  type:video  site:github.com
 *   before:2024-01-01  after:2024-01-01   "exact phrase"   plain words (prefix-matched)
 *   -word  -"exact phrase"   (exclude)
 * Dates are calendar days in `timeZone`.
 */
export function parseQuery(input: string, timeZone = 'UTC'): ParsedQuery {
  const q: ParsedQuery = {
    match: null,
    exclude: null,
    tags: [],
    excludeTags: [],
    types: [],
    sites: [],
    favorite: null,
    hasNote: null,
    before: null,
    after: null,
  };
  const include: string[] = [];
  const exclude: string[] = [];

  for (const raw of tokenize(input)) {
    const negated = raw.startsWith('-') && raw.length > 1;
    const token = negated ? raw.slice(1) : raw;

    if (token.startsWith('#') && token.length > 1) {
      (negated ? q.excludeTags : q.tags).push(unquote(token.slice(1)));
      continue;
    }
    const op = token.match(/^(\w+):(.+)$/);
    if (op) {
      const key = op[1]!.toLowerCase();
      const value = unquote(op[2]!);
      if (key === 'tag') {
        (negated ? q.excludeTags : q.tags).push(value);
        continue;
      }
      if (key === 'is') {
        const v = value.toLowerCase();
        if (['fav', 'favorite', 'favourite', 'favorites', 'starred'].includes(v)) {
          q.favorite = !negated;
          continue;
        }
        if (v === 'note' || v === 'noted') {
          q.hasNote = !negated;
          continue;
        }
      }
      if (key === 'type' && TYPE_ALIASES[value.toLowerCase()]) {
        q.types.push(TYPE_ALIASES[value.toLowerCase()]!);
        continue;
      }
      if (key === 'site' || key === 'domain') {
        q.sites.push(value.toLowerCase().replace(/^www\./, ''));
        continue;
      }
      if (key === 'before' || key === 'after') {
        const t = parseDate(value, timeZone);
        if (t !== null) {
          q[key] = t;
          continue;
        }
      }
    }

    // Free text. Each term is quoted so FTS syntax characters can't cause errors.
    const phrase = token.startsWith('"');
    const text = unquote(token).replace(/"/g, '').trim();
    if (!text) continue;
    const words = phrase ? [text] : text.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
    if (!words.length) continue;
    if (negated) {
      // -word excludes words starting with it; -"a phrase" and -two-words exclude that phrase.
      exclude.push(words.length === 1 && !phrase ? `"${words[0]}"*` : `"${words.join(' ')}"`);
    } else {
      for (const w of words) include.push(phrase ? `"${w}"` : `"${w}"*`);
    }
  }

  // Exclusions are a separate expression (applied as NOT IN), because FTS5 can't express
  // "everything except" on its own: a query can't start with NOT.
  q.match = include.length ? include.join(' ') : null;
  q.exclude = exclude.length ? exclude.join(' OR ') : null;
  return q;
}

export const isBookmarkType = (v: string): v is BookmarkType => (BOOKMARK_TYPES as readonly string[]).includes(v);
