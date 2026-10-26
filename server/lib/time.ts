/** A valid IANA time zone name, or UTC. */
export function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** How far `timeZone` is ahead of UTC at the instant `ms`, in milliseconds. */
function offsetAt(ms: number, timeZone: string): number {
  const p: Record<string, string> = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  for (const part of fmt.formatToParts(ms)) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!, +p.second!);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant a calendar date ("2024-01-31") begins in `timeZone`, or null if it isn't a date. */
export function startOfDay(date: string, timeZone: string): number | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const utc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  if (Number.isNaN(utc)) return null;
  // The offset at the guess and at the answer can differ across a DST change; the second pass settles it.
  return utc - offsetAt(utc - offsetAt(utc, timeZone), timeZone);
}
