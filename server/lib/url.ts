/** Parse a user-supplied URL, adding https:// when the scheme is missing. Only http(s) is allowed. */
export function parseBookmarkUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|_hsenc|_hsmi)$/i;

/** A canonical form of a URL used to spot duplicates. */
export function normalizeUrl(input: string): string | null {
  const url = parseBookmarkUrl(input);
  if (!url) return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  const query = url.searchParams.toString();
  return `${host}${url.port ? `:${url.port}` : ''}${path}${query ? `?${query}` : ''}`.toLowerCase();
}

export function siteOf(input: string | null): string | null {
  if (!input) return null;
  try {
    return new URL(input).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Resolve a possibly-relative URL against a base, returning only http(s) results. */
export function absoluteUrl(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
