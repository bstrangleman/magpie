// Small, dependency-free chart pieces for the statistics page.
// Marks follow one spec: thin bars (≤ 24px) with 4px rounded data-ends, hairline gridlines,
// 2px gaps between touching marks, values in text colours (never the series colour),
// a hover/focus tooltip on every mark, and a table view for every chart.
import { ChartBarIcon, TableIcon } from '@phosphor-icons/react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils.ts';

// --- Tooltip ---------------------------------------------------------------------

type Tip = { x: number; y: number; content: ReactNode };
const TipContext = createContext<(tip: Tip | null) => void>(() => {});

export function TooltipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <TipContext.Provider value={setTip}>
      {children}
      {tip &&
        createPortal(
          <div
            role="tooltip"
            className="shadow-pop pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs whitespace-nowrap"
            style={{ left: Math.min(Math.max(tip.x, 90), window.innerWidth - 90), top: tip.y - 10 }}
          >
            {tip.content}
          </div>,
          document.body,
        )}
    </TipContext.Provider>
  );
}

/** Event handlers that show a tooltip for a mark on hover and on keyboard focus. */
export function useTip() {
  const set = useContext(TipContext);
  return (content: ReactNode) => ({
    onPointerMove: (e: React.PointerEvent) => set({ x: e.clientX, y: e.clientY, content }),
    onPointerLeave: () => set(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      set({ x: r.left + r.width / 2, y: r.top, content });
    },
    onBlur: () => set(null),
  });
}

/** Tooltip body: the value leads, the label follows. */
export function TipBody({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <>
      <div className="font-semibold text-ink">{value}</div>
      <div className="text-ink-3">{label}</div>
    </>
  );
}

// --- Containers ---------------------------------------------------------------------

export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

export function ChartCard({
  title,
  subtitle,
  table,
  className,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  table?: TableData;
  className?: string;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={cn('min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5', className)}>
      <header className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.95rem] font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[0.8rem] text-ink-3">{subtitle}</p>}
        </div>
        {table && (
          <button
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            title={asTable ? 'Show chart' : 'Show as table'}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-3 hover:bg-hover hover:text-ink-2"
          >
            {asTable ? <ChartBarIcon size={14} /> : <TableIcon size={14} />}
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </header>
      {asTable && table ? <DataTable {...table} /> : children}
    </section>
  );
}

export function DataTable({ columns, rows }: TableData) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-[0.82rem]">
        <thead className="sticky top-0 bg-surface text-left text-xs text-ink-3">
          <tr>
            {columns.map((c, i) => (
              <th key={c} className={cn('py-1.5 font-medium', i > 0 && 'text-right')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={cn('py-1.5', j > 0 && 'text-right tabular-nums text-ink-2')}>
                  {typeof cell === 'number' ? cell.toLocaleString() : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatTile({ label, value, detail, icon }: { label: string; value: ReactNode; detail?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[0.8rem] text-ink-2">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-[1.6rem] leading-tight font-semibold tracking-tight">{value}</div>
      {detail && <div className="mt-0.5 truncate text-xs text-ink-3">{detail}</div>}
    </div>
  );
}

// --- Column chart ---------------------------------------------------------------------

/** A "nice" axis maximum: 1, 2, 2.5 or 5 × a power of ten. */
export function niceMax(value: number): number {
  if (value <= 4) return Math.max(1, Math.ceil(value));
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= value) return m * pow;
  return 10 * pow;
}

export interface Column {
  key: string;
  /** Axis label; omit to leave this column unlabelled (dense axes). */
  tick?: string;
  value: number;
  tip: ReactNode;
}

/**
 * Columns from one baseline. `emphasis` colours the peak (every column tied for it) and quiets the rest — use it when
 * the story is "when is the busiest time", not a comparison of every value.
 */
export function ColumnChart({ columns, height = 140, emphasis, peakLabel }: { columns: Column[]; height?: number; emphasis?: boolean; peakLabel?: (v: number) => string }) {
  const tip = useTip();
  const max = Math.max(0, ...columns.map((c) => c.value));
  const top = niceMax(max);
  const isPeak = (value: number) => max > 0 && value === max;
  return (
    <div className="flex gap-2">
      {/* y-axis ticks */}
      <div className="relative w-6 shrink-0 text-right text-[0.7rem] text-ink-3 tabular-nums" style={{ height }}>
        {[top, top / 2, 0].map((t, i) => (
          <span key={i} className="absolute right-0 -translate-y-1/2 leading-none" style={{ top: `${(i / 2) * 100}%` }}>
            {Number.isInteger(t) ? t.toLocaleString() : ''}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height }}>
          {/* hairline gridlines + baseline */}
          {[0, 0.5].map((f) => (
            <div key={f} className="absolute inset-x-0 border-t border-[var(--viz-grid)]" style={{ top: `${f * 100}%` }} />
          ))}
          <div className="absolute inset-x-0 bottom-0 border-t border-line" />
          <div className="absolute inset-0 flex items-end">
            {columns.map((c) => {
              const h = top ? (c.value / top) * 100 : 0;
              const loud = !emphasis || isPeak(c.value);
              return (
                <div
                  key={c.key}
                  tabIndex={0}
                  aria-label={`${c.tick ?? c.key}: ${c.value}`}
                  {...tip(c.tip)}
                  className="group relative flex h-full flex-1 items-end justify-center px-[1px] outline-none"
                >
                  {isPeak(c.value) && peakLabel && (
                    <span
                      className="absolute left-1/2 -translate-x-1/2 -translate-y-full pb-1 text-[0.7rem] font-semibold whitespace-nowrap text-ink-2"
                      style={{ bottom: `${h}%` }}
                    >
                      {peakLabel(c.value)}
                    </span>
                  )}
                  <div
                    className="w-full max-w-6 rounded-t-[4px] transition-[filter] group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-accent"
                    style={{
                      height: `${h}%`,
                      minHeight: c.value > 0 ? 2 : 0,
                      background: loud ? 'var(--viz-1)' : 'var(--viz-quiet)',
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-1.5 flex text-[0.7rem] text-ink-3">
          {columns.map((c) => (
            <span key={c.key} className="flex-1 text-center whitespace-nowrap">
              {c.tick ?? ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Horizontal bar list -------------------------------------------------------------------

export interface BarItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  value: number;
  /** Text shown at the end of the row (defaults to the value). */
  display?: string;
  tip?: ReactNode;
  href?: string;
}

/** A ranked list: label and value on one line, a thin bar underneath. One series, one colour. */
export function BarList({ items, empty = 'Nothing yet' }: { items: BarItem[]; empty?: string }) {
  const tip = useTip();
  const max = Math.max(0, ...items.map((i) => i.value));
  if (!items.length) return <p className="py-6 text-center text-sm text-ink-3">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const Row = item.href ? 'a' : 'div';
        return (
          <li key={item.key}>
            <Row
              {...(item.href ? { href: item.href } : {})}
              {...tip(item.tip ?? <TipBody value={item.display ?? item.value.toLocaleString()} label={item.label} />)}
              className={cn('group block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent', item.href && 'hover:bg-hover')}
              tabIndex={item.href ? undefined : 0}
            >
              <div className="flex items-center gap-2 text-[0.85rem]">
                {item.icon}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="shrink-0 text-ink-2 tabular-nums">{item.display ?? item.value.toLocaleString()}</span>
              </div>
              <div className="mt-1 h-1.5">
                <div
                  className="h-full rounded-r-[4px] transition-[filter] group-hover:brightness-110"
                  style={{ width: `${max ? Math.max((item.value / max) * 100, 1.5) : 0}%`, background: 'var(--viz-1)' }}
                />
              </div>
            </Row>
          </li>
        );
      })}
    </ul>
  );
}

// --- Part-to-whole bar ------------------------------------------------------------------------

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
  icon?: ReactNode;
}

/** One stacked bar with 2px gaps, and a legend that doubles as the table (counts + shares). */
export function CompositionBar({ segments }: { segments: Segment[] }) {
  const tip = useTip();
  const total = segments.reduce((n, s) => n + s.value, 0);
  const shown = segments.filter((s) => s.value > 0);
  const pct = (v: number) => `${total ? Math.round((v / total) * 1000) / 10 : 0}%`;
  return (
    <div>
      <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-[4px]" aria-hidden>
        {shown.map((s) => (
          <div
            key={s.key}
            {...tip(<TipBody value={`${s.value.toLocaleString()} · ${pct(s.value)}`} label={s.label} />)}
            className="h-full min-w-[3px] transition-[filter] hover:brightness-110"
            style={{ flexGrow: s.value, background: s.color }}
          />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {segments.map((s) => (
          <li key={s.key} className={cn('flex items-center gap-2 text-[0.85rem]', !s.value && 'opacity-45')}>
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
            {s.icon}
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="text-ink-2 tabular-nums">{s.value.toLocaleString()}</span>
            <span className="w-12 text-right text-xs text-ink-3 tabular-nums">{pct(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Calendar heatmap ---------------------------------------------------------------------------

const utcDate = (date: string) => new Date(`${date}T00:00:00Z`);
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });

/** Days → intensity step 0-4 relative to the busiest day. */
const level = (count: number, max: number) => (count === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((count / max) * 4))));

/**
 * GitHub-style year of activity: one column per week (Mon at the top), one-hue ordinal ramp.
 * `days` must start on a Monday and be in order.
 */
export function CalendarHeatmap({ days }: { days: { date: string; count: number }[] }) {
  const tip = useTip();
  const scroller = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  const weeks: { date: string; count: number }[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const startsMonth = (w: { date: string }[]) => w.find((d) => d.date.endsWith('-01'));
  // Label the week holding each month's 1st; the first column too, unless a label follows right after it.
  const monthLabels = weeks.map((w, i) => {
    const first = startsMonth(w) ?? (i === 0 && !weeks.slice(1, 3).some(startsMonth) ? w[0] : undefined);
    return first ? monthFmt.format(utcDate(first.date)) : null;
  });

  // Show the most recent weeks first on narrow screens.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const CELL = 13;
  const GAP = 3;
  return (
    <div className="flex gap-2">
      <div className="shrink-0 pt-[18px] text-[0.7rem] text-ink-3" style={{ display: 'grid', gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className="leading-[13px]">
            {i % 2 === 0 ? weekdayFmt.format(utcDate(days[i]?.date ?? '2024-01-01')) : ''}
          </span>
        ))}
      </div>
      <div ref={scroller} className="min-w-0 overflow-x-auto pb-1">
        <div className="relative" style={{ width: weeks.length * (CELL + GAP) - GAP }}>
          {/* month labels above the first week of each month */}
          <div className="relative h-[18px] text-[0.7rem] text-ink-3">
            {monthLabels.map(
              (label, i) =>
                label && (
                  <span key={i} className="absolute top-0" style={{ left: i * (CELL + GAP) }}>
                    {label}
                  </span>
                ),
            )}
          </div>
          <div className="flex" style={{ gap: GAP }}>
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-col" style={{ gap: GAP }}>
                {w.map((d) => (
                  <div
                    key={d.date}
                    {...tip(<TipBody value={`${d.count.toLocaleString()} bookmark${d.count === 1 ? '' : 's'}`} label={dayFmt.format(utcDate(d.date))} />)}
                    className="rounded-[3px] hover:outline-2 hover:outline-offset-1 hover:outline-[var(--ink-3)]"
                    style={{ width: CELL, height: CELL, background: `var(--viz-heat-${level(d.count, max)})` }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HeatLegend() {
  return (
    <div className="flex items-center gap-1.5 text-[0.7rem] text-ink-3">
      Less
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} className="size-[11px] rounded-[3px]" style={{ background: `var(--viz-heat-${l})` }} />
      ))}
      More
    </div>
  );
}

// --- Sparkline columns (hero) ----------------------------------------------------------------------

/** Twelve thin columns in the quiet colour, the current period in the accent. */
export function SparkColumns({ points, height = 64 }: { points: { key: string; label: string; value: number }[]; height?: number }) {
  const tip = useTip();
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {points.map((p, i) => (
        <div
          key={p.key}
          tabIndex={0}
          aria-label={`${p.label}: ${p.value}`}
          {...tip(<TipBody value={`${p.value.toLocaleString()} saved`} label={p.label} />)}
          className="group flex h-full w-3.5 items-end outline-none sm:w-4"
        >
          <div
            className="w-full rounded-t-[3px] group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-accent"
            style={{
              height: `${(p.value / max) * 100}%`,
              minHeight: 2,
              background: i === points.length - 1 ? 'var(--viz-1)' : 'var(--viz-quiet)',
            }}
          />
        </div>
      ))}
    </div>
  );
}
