import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  Bookmark,
  BookOpen,
  CircleAlert,
  CircleHelp,
  Code,
  FileText,
  FileUp,
  Flame,
  Folder,
  HardDrive,
  Hash,
  Heart,
  Inbox,
  LoaderCircle,
  Minus,
  Puzzle,
  StickyNote,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { BookmarkType, Stats } from '../../../shared/types.ts';
import {
  BarList,
  CalendarHeatmap,
  ChartCard,
  ColumnChart,
  CompositionBar,
  HeatLegend,
  SparkColumns,
  StatTile,
  TipBody,
  TooltipLayer,
} from '../components/charts.tsx';
import { CollectionIcon, Favicon } from '../components/common.tsx';
import { buttonClass, Spinner } from '../components/ui.tsx';
import { useStats } from '../lib/queries.ts';
import { cn, formatBytes, plural } from '../lib/utils.ts';
import { FILTER_META } from '../lib/view.ts';

// --- Formatting ----------------------------------------------------------------------------

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const big = (n: number) => (n >= 10_000 ? compact.format(n) : n.toLocaleString());

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const monthLong = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShort = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const dayShort = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' });
// "9 am" where clocks are 12-hour; "09:00" where they're 24-hour (a bare "09" reads oddly).
const twentyFourHour = /h2[34]/.test(new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle ?? '');
const hourFmt = new Intl.DateTimeFormat(
  undefined,
  twentyFourHour ? { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' } : { hour: 'numeric', timeZone: 'UTC' },
);
const sinceFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

/** 2024-01-01 was a Monday, so day i of the week is that date + i. */
const weekdayName = (i: number, fmt = weekdayShort) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i)));
const hourName = (h: number) => hourFmt.format(new Date(Date.UTC(2024, 0, 1, h)));

/** Reading time for a word count at ~238 words per minute. */
function readingTime(words: number): string {
  const minutes = words / 238;
  if (minutes < 1) return '0 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1).replace(/\.0$/, '') : Math.round(hours).toLocaleString()} h`;
}

/** Indexes of the largest values (ties included). */
const peaks = (values: number[]) => {
  const max = Math.max(...values);
  return values.flatMap((v, i) => (v === max ? [i] : []));
};

/** "Mondays", "Mondays and Thursdays", "Mondays, Tuesdays and 2 more" */
const list = (items: string[]) =>
  items.length <= 2 ? items.join(' and ') : `${items.slice(0, 2).join(', ')} and ${items.length - 2} more`;

function streaks(days: { count: number }[]) {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // The current streak may end today or yesterday (today isn't over yet).
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i]!.count > 0) current++;
    else if (i === days.length - 1) continue;
    else break;
  }
  return { longest, current };
}

// --- Labels -------------------------------------------------------------------------------------

const TYPES: Record<BookmarkType, { label: string; icon: LucideIcon; color: string }> = {
  link: { label: 'Links', icon: FILTER_META.links.icon, color: 'var(--viz-1)' },
  article: { label: 'Articles', icon: FILTER_META.articles.icon, color: 'var(--viz-2)' },
  video: { label: 'Videos', icon: FILTER_META.videos.icon, color: 'var(--viz-3)' },
  image: { label: 'Images', icon: FILTER_META.images.icon, color: 'var(--viz-4)' },
  audio: { label: 'Audio', icon: FILTER_META.audios.icon, color: 'var(--viz-5)' },
  document: { label: 'Documents', icon: FILTER_META.documents.icon, color: 'var(--viz-6)' },
  note: { label: 'Notes', icon: StickyNote, color: 'var(--viz-7)' },
};

const SOURCES: Record<Stats['sources'][number]['source'], { label: string; icon: LucideIcon }> = {
  web: { label: 'Web app', icon: AppWindow },
  extension: { label: 'Browser extension', icon: Puzzle },
  bookmarklet: { label: 'Bookmarklet', icon: Bookmark },
  api: { label: 'API', icon: Code },
  import: { label: 'Imported', icon: FileUp },
  unknown: { label: 'Not recorded', icon: CircleHelp },
};

const small = (Icon: LucideIcon) => <Icon size={15} strokeWidth={1.7} className="shrink-0 text-ink-3" />;

// --- Page -------------------------------------------------------------------------------------------

export function StatsPage() {
  const { data: s, isLoading, error, isFetching } = useStats();

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={22} />
      </div>
    );
  }
  if (error || !s) return <p className="py-10 text-sm text-danger">Couldn't load statistics: {(error as Error)?.message}</p>;

  if (s.totals.bookmarks === 0) {
    return (
      <>
        <PageHeader s={s} />
        <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <h2 className="font-semibold">No statistics yet</h2>
          <p className="mt-1 text-sm text-ink-2">Save or import some bookmarks and this page will fill in.</p>
          <div className="mt-5 flex justify-center gap-2">
            <Link to="/all" className={buttonClass('primary')}>
              Go to bookmarks
            </Link>
            <Link to="/settings/import" className={buttonClass()}>
              Import bookmarks
            </Link>
          </div>
        </div>
      </>
    );
  }

  const a = s.activity;
  const lastYear = a.days.reduce((n, d) => n + d.count, 0);
  const busiestDay = a.days.reduce((best, d) => (d.count > best.count ? d : best), a.days[0]!);
  const { longest, current } = streaks(a.days);
  const peakWeekdays = peaks(a.byWeekday).map((i) => `${weekdayName(i, weekdayLong)}s`);
  const peakHours = peaks(a.byHour).map(hourName);
  const typeTotal = s.types.reduce((n, t) => n + t.count, 0);
  const health = s.health;

  return (
    <TooltipLayer>
      <PageHeader s={s} />
      <div className={cn('space-y-4 transition-opacity', isFetching && 'opacity-70')}>
        {/* Headline */}
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="flex flex-wrap items-end justify-between gap-6 rounded-xl border border-line bg-surface p-5 lg:col-span-2">
            <div>
              <div className="text-sm text-ink-2">Bookmarks saved</div>
              <div className="mt-1 text-[3.4rem] leading-none font-semibold tracking-tight">{big(s.totals.bookmarks)}</div>
              <div className="mt-3 text-sm text-ink-3">
                {a.thisMonth > 0 ? `+${a.thisMonth.toLocaleString()} this month` : 'None yet this month'}
                {s.firstSavedAt && <> · since {sinceFmt.format(new Date(s.firstSavedAt))}</>}
              </div>
            </div>
            <div>
              <SparkColumns
                points={a.months.map((m) => ({ key: m.month, label: monthLong.format(utc(`${m.month}-01`)), value: m.count }))}
              />
              <div className="mt-1.5 flex justify-between text-[0.7rem] text-ink-3">
                <span>{monthShort.format(utc(`${a.months[0]!.month}-01`))}</span>
                <span>Last 12 months</span>
                <span>{monthShort.format(utc(`${a.months.at(-1)!.month}-01`))}</span>
              </div>
            </div>
          </section>
          <section className="divide-y divide-line rounded-xl border border-line bg-surface">
            <Period label="This week" value={a.thisWeek} previous={a.lastWeek} than="last week" />
            <Period label="This month" value={a.thisMonth} previous={a.lastMonth} than="last month" />
            <Period label="This year" value={a.thisYear} previous={a.lastYear} than="last year" />
          </section>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Collections" icon={small(Folder)} value={big(s.totals.collections)} />
          <StatTile label="Tags" icon={small(Hash)} value={big(s.totals.tags)} />
          <StatTile label="Favorites" icon={small(Heart)} value={big(s.totals.favorites)} />
          <StatTile label="Notes" icon={small(StickyNote)} value={big(s.totals.notes)} />
          <StatTile label="Storage" icon={small(HardDrive)} value={formatBytes(s.storage.total)} detail={plural(s.totals.files, 'upload')} />
          <StatTile
            label="Reading time"
            icon={small(BookOpen)}
            value={`≈ ${readingTime(s.reading.words)}`}
            detail={`in ${plural(s.reading.articles, 'saved article')}`}
          />
        </div>

        {/* Activity */}
        <ChartCard
          title="Saving activity"
          subtitle={
            <>
              {plural(lastYear, 'bookmark')} in the last year
              {busiestDay.count > 0 && <> · most in a day: {busiestDay.count.toLocaleString()} on {dayShort.format(utc(busiestDay.date))}</>}
            </>
          }
          table={{ columns: ['Month', 'Bookmarks'], rows: a.months.map((m) => [monthLong.format(utc(`${m.month}-01`)), m.count]) }}
        >
          <CalendarHeatmap days={a.days} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-xs text-ink-2">
              <Flame size={14} className="text-ink-3" />
              {current > 0 ? `${plural(current, 'day')} in a row` : 'No current streak'}
              <span className="text-ink-3">· longest {plural(longest, 'day')}</span>
            </div>
            <HeatLegend />
          </div>
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="By day of the week"
            subtitle={`Most active on ${list(peakWeekdays)}`}
            table={{ columns: ['Day', 'Bookmarks'], rows: a.byWeekday.map((n, i) => [weekdayName(i, weekdayLong), n]) }}
          >
            <ColumnChart
              emphasis
              peakLabel={(v) => v.toLocaleString()}
              columns={a.byWeekday.map((n, i) => ({
                key: `d${i}`,
                tick: weekdayName(i),
                value: n,
                tip: <TipBody value={plural(n, 'bookmark')} label={`${weekdayName(i, weekdayLong)}s`} />,
              }))}
            />
          </ChartCard>
          <ChartCard
            title="By time of day"
            subtitle={`Busiest around ${list(peakHours)} · ${s.timeZone.replace(/_/g, ' ')}`}
            table={{ columns: ['Hour', 'Bookmarks'], rows: a.byHour.map((n, h) => [`${hourName(h)}–${hourName((h + 1) % 24)}`, n]) }}
          >
            <ColumnChart
              emphasis
              peakLabel={(v) => v.toLocaleString()}
              columns={a.byHour.map((n, h) => ({
                key: `h${h}`,
                tick: h % 6 === 0 ? hourName(h) : undefined,
                value: n,
                tip: <TipBody value={plural(n, 'bookmark')} label={`${hourName(h)} – ${hourName((h + 1) % 24)}`} />,
              }))}
            />
          </ChartCard>
        </div>

        {/* What you save */}
        <ChartCard title="Bookmark types" subtitle={`What your ${plural(typeTotal, 'bookmark')} are`}>
          <CompositionBar
            segments={s.types.map((t) => ({
              key: t.type,
              label: TYPES[t.type].label,
              value: t.count,
              color: TYPES[t.type].color,
              icon: small(TYPES[t.type].icon),
            }))}
          />
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Top sites" subtitle="Where your bookmarks come from">
            <BarList
              empty="No links yet"
              items={s.topSites.map((x) => ({
                key: x.site,
                label: x.site,
                icon: <Favicon src={x.favicon} size={15} />,
                value: x.count,
                href: `/all?q=${encodeURIComponent(`site:${x.site}`)}`,
              }))}
            />
          </ChartCard>
          <ChartCard title="Most used tags" subtitle={`${plural(s.totals.tags, 'tag')} in use`}>
            <BarList
              empty="No tags yet"
              items={s.topTags.map((t) => ({
                key: t.name,
                label: t.name,
                icon: small(Hash),
                value: t.count,
                href: `/tag/${encodeURIComponent(t.name)}`,
              }))}
            />
          </ChartCard>
          <ChartCard title="Largest collections">
            <BarList
              empty="No collections yet"
              items={s.topCollections.map((c) => ({
                key: String(c.id),
                label: c.name,
                icon: <CollectionIcon collection={c} size={15} />,
                value: c.count,
                href: `/collection/${c.id}`,
              }))}
            />
          </ChartCard>
          <ChartCard title="How you save" subtitle="Where new bookmarks are added from">
            <BarList
              items={s.sources.map((x) => ({
                key: x.source,
                label: SOURCES[x.source].label,
                icon: small(SOURCES[x.source].icon),
                value: x.count,
              }))}
            />
          </ChartCard>
          <ChartCard title="Storage" subtitle={`${formatBytes(s.storage.total)} of uploads and cached preview images`}>
            <BarList
              empty="Nothing stored yet"
              items={s.storage.groups.map((g) => ({
                key: g.label,
                label: g.label,
                icon: small(g.label === 'Preview images' ? FILTER_META.images.icon : FileText),
                value: g.size,
                display: formatBytes(g.size),
                tip: <TipBody value={formatBytes(g.size)} label={`${g.label} · ${plural(g.count, 'file')}`} />,
              }))}
            />
          </ChartCard>
          <ChartCard
            title="Library health"
            subtitle={health.broken + health.duplicates === 0 ? 'No broken links or duplicates' : 'Things you might want to tidy up'}
          >
            <ul className="divide-y divide-line text-[0.85rem]">
              <HealthRow icon={FILTER_META.broken.icon} label="Broken links" count={health.broken} to="/filter/broken" />
              <HealthRow icon={FILTER_META.duplicates.icon} label="Duplicates" count={health.duplicates} to="/filter/duplicates" />
              <HealthRow icon={Hash} label="Without tags" count={health.untagged} to="/filter/untagged" />
              <HealthRow icon={Inbox} label="Unsorted" count={health.unsorted} to="/unsorted" />
              <HealthRow icon={CircleAlert} label="Couldn't fetch details" count={health.failed} />
              {health.pending > 0 && <HealthRow icon={LoaderCircle} label="Fetching details" count={health.pending} />}
              <HealthRow icon={Trash2} label="In the Trash" count={health.trash} to="/trash" />
            </ul>
          </ChartCard>
        </div>
      </div>
    </TooltipLayer>
  );
}

function PageHeader({ s }: { s: Stats }) {
  return (
    <div className="mb-6">
      <h1 className="text-lg font-semibold">Statistics</h1>
      <p className="mt-1 text-sm text-ink-2">
        An overview of your library{s.firstSavedAt ? ` since ${sinceFmt.format(new Date(s.firstSavedAt))}` : ''}. Times are in{' '}
        {s.timeZone.replace(/_/g, ' ')}.
      </p>
    </div>
  );
}

function Period({ label, value, previous, than }: { label: string; value: number; previous: number; than: string }) {
  const diff = value - previous;
  // Saving more or less isn't good or bad, so the change stays in neutral ink.
  const Icon = diff > 0 ? ArrowUp : diff < 0 ? ArrowDown : Minus;
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
      <div>
        <div className="text-[0.8rem] text-ink-2">{label}</div>
        <div className="text-2xl leading-tight font-semibold">{value.toLocaleString()}</div>
      </div>
      <div className="flex items-center gap-1 text-xs text-ink-3">
        <Icon size={13} />
        {diff === 0 ? `Same as ${than}` : `${Math.abs(diff).toLocaleString()} ${diff > 0 ? 'more' : 'fewer'} than ${than}`}
      </div>
    </div>
  );
}

function HealthRow({ icon: Icon, label, count, to }: { icon: LucideIcon; label: string; count: number; to?: string }): ReactNode {
  const body = (
    <>
      <Icon size={15} strokeWidth={1.7} className="shrink-0 text-ink-3" />
      <span className="flex-1">{label}</span>
      <span className={cn('tabular-nums', count ? 'font-medium text-ink' : 'text-ink-3')}>{count.toLocaleString()}</span>
    </>
  );
  return (
    <li>
      {to && count > 0 ? (
        <Link to={to} className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-hover">
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-2.5 py-2">{body}</div>
      )}
    </li>
  );
}
