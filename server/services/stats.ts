import { BOOKMARK_TYPES, type BookmarkType, type Stats } from '../../shared/types.ts';
import { all, get } from '../db/index.ts';
import { getCounts } from './bookmarks.ts';
import { listCollections } from './collections.ts';
import { listTags } from './tags.ts';

export { validTimeZone } from '../lib/time.ts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 86_400_000;

/** Average characters per English word, spaces included — used to estimate reading time. */
const CHARS_PER_WORD = 6;

/** Calendar date, weekday and hour of a timestamp in a time zone. */
function localParts(timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  return (ms: number) => {
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(ms)) p[part.type] = part.value;
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: WEEKDAYS.indexOf(p.weekday!) };
  };
}

// Calendar dates as day numbers, so date ranges are simple integer maths.
const dayNumber = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY_MS;
const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`; // month: 1-12

function activity(userId: number, timeZone: string, now: number): Stats['activity'] {
  const parts = localParts(timeZone);
  const today = parts(now);
  const todayN = dayNumber(today.date);
  const weekStart = todayN - today.weekday;
  const firstDay = weekStart - 52 * 7;
  const year = +today.date.slice(0, 4);
  const month = +today.date.slice(5, 7);
  const thisMonth = monthKey(year, month);
  const lastMonth = month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = month - 11 + i;
    return m > 0 ? monthKey(year, m) : monthKey(year - 1, m + 12);
  });

  const perDay = new Map<number, number>();
  const perMonth = new Map<string, number>();
  const byWeekday = Array<number>(7).fill(0);
  const byHour = Array<number>(24).fill(0);
  const out = { thisWeek: 0, lastWeek: 0, thisMonth: 0, lastMonth: 0, thisYear: 0, lastYear: 0 };

  for (const { created_at } of all<{ created_at: number }>(
    'SELECT created_at FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL',
    userId,
  )) {
    const p = parts(created_at);
    const day = dayNumber(p.date);
    const key = p.date.slice(0, 7);
    const y = +p.date.slice(0, 4);
    byWeekday[p.weekday]!++;
    byHour[p.hour]!++;
    if (day >= firstDay && day <= todayN) perDay.set(day, (perDay.get(day) ?? 0) + 1);
    perMonth.set(key, (perMonth.get(key) ?? 0) + 1);
    if (day >= weekStart && day <= todayN) out.thisWeek++;
    else if (day >= weekStart - 7 && day < weekStart) out.lastWeek++;
    if (key === thisMonth) out.thisMonth++;
    else if (key === lastMonth) out.lastMonth++;
    if (y === year) out.thisYear++;
    else if (y === year - 1) out.lastYear++;
  }

  return {
    ...out,
    days: Array.from({ length: todayN - firstDay + 1 }, (_, i) => ({ date: dateOf(firstDay + i), count: perDay.get(firstDay + i) ?? 0 })),
    months: months.map((m) => ({ month: m, count: perMonth.get(m) ?? 0 })),
    byWeekday,
    byHour,
  };
}

function storageLabel(kind: string, mime: string): string {
  if (kind === 'cover') return 'Preview images';
  if (kind === 'favicon') return 'Site icons';
  if (mime === 'application/pdf') return 'PDFs';
  if (mime.startsWith('image/')) return 'Images';
  if (mime.startsWith('video/')) return 'Video';
  if (mime.startsWith('audio/')) return 'Audio';
  return 'Other files';
}

export function getStats(userId: number, timeZone: string, now = Date.now()): Stats {
  const counts = getCounts(userId);
  const live = 'user_id = ? AND deleted_at IS NULL';

  const typeCounts = new Map(
    all<{ type: BookmarkType; n: number }>(`SELECT type, COUNT(*) AS n FROM bookmarks WHERE ${live} GROUP BY type`, userId).map((r) => [
      r.type,
      r.n,
    ]),
  );

  const storageGroups = new Map<string, { label: string; count: number; size: number }>();
  for (const r of all<{ kind: string; mime: string; n: number; size: number }>(
    'SELECT kind, mime, COUNT(*) AS n, SUM(size) AS size FROM assets WHERE user_id = ? GROUP BY kind, mime',
    userId,
  )) {
    const label = storageLabel(r.kind, r.mime);
    const g = storageGroups.get(label) ?? { label, count: 0, size: 0 };
    g.count += r.n;
    g.size += r.size;
    storageGroups.set(label, g);
  }
  const groups = [...storageGroups.values()].sort((a, b) => b.size - a.size);

  const reading = get<{ n: number; chars: number | null }>(
    `SELECT COUNT(*) AS n, SUM(LENGTH(content_text)) AS chars FROM bookmarks
     WHERE ${live} AND type = 'article' AND content_text IS NOT NULL`,
    userId,
  )!;
  const fetches = get<{ pending: number | null; failed: number | null }>(
    `SELECT SUM(fetch_status = 'pending') AS pending, SUM(fetch_status = 'failed' AND broken = 0) AS failed
     FROM bookmarks WHERE ${live}`,
    userId,
  )!;
  const tags = listTags(userId).filter((t) => t.count > 0);
  const collections = listCollections(userId);

  return {
    timeZone,
    firstSavedAt: get<{ t: number | null }>(`SELECT MIN(created_at) AS t FROM bookmarks WHERE ${live}`, userId)?.t ?? null,
    totals: {
      bookmarks: counts.all,
      favorites: counts.filters.favorites,
      collections: collections.length,
      tags: tags.length,
      notes: counts.filters.notes,
      files: get<{ n: number }>(`SELECT COUNT(*) AS n FROM bookmarks WHERE ${live} AND file_asset_id IS NOT NULL`, userId)!.n,
    },
    activity: activity(userId, timeZone, now),
    types: BOOKMARK_TYPES.map((type) => ({ type, count: typeCounts.get(type) ?? 0 })),
    sources: all<{ source: Stats['sources'][number]['source']; count: number }>(
      `SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS count FROM bookmarks WHERE ${live}
       GROUP BY 1 ORDER BY count DESC`,
      userId,
    ),
    // Each site's icon: the locally cached copy when there is one.
    topSites: all<{ site: string; count: number; favicon: string | null }>(
      `SELECT s.site, s.count, COALESCE('/api/assets/' || fv.asset_id, s.favicon) AS favicon
       FROM (SELECT site, COUNT(*) AS count, MAX(favicon_url) AS favicon FROM bookmarks
             WHERE ${live} AND site IS NOT NULL GROUP BY site ORDER BY count DESC, site LIMIT 10) s
       LEFT JOIN favicons fv ON fv.user_id = ? AND fv.url = s.favicon
       ORDER BY s.count DESC, s.site`,
      userId,
      userId,
    ),
    topTags: [...tags]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map((t) => ({ name: t.name, count: t.count })),
    topCollections: collections
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, count: c.count })),
    reading: { articles: reading.n, words: Math.round((reading.chars ?? 0) / CHARS_PER_WORD) },
    storage: { total: groups.reduce((n, g) => n + g.size, 0), groups },
    health: {
      broken: counts.filters.broken,
      duplicates: counts.filters.duplicates,
      untagged: counts.filters.untagged,
      unsorted: counts.unsorted,
      pending: fetches.pending ?? 0,
      failed: fetches.failed ?? 0,
      trash: counts.trash,
    },
  };
}
