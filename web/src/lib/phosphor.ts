// The Phosphor icon set for collection icons, loaded on first use. (The "ph:<name>" format is in shared/types.ts.)
import { useEffect, useState } from 'react';

export interface PhosphorIcon {
  name: string;
  /** SVG path data, in a 256×256 viewBox. */
  d: string;
  /** Tags and categories, for search. */
  terms: string;
}

let icons: Map<string, PhosphorIcon> | null = null;
let loading: Promise<Map<string, PhosphorIcon>> | null = null;

/** Load the icon set (one lazily loaded chunk, shared by every caller). */
export function loadPhosphor(): Promise<Map<string, PhosphorIcon>> {
  loading ??= import('virtual:phosphor-icons').then(({ default: list }) => {
    icons = new Map(list.map(([name, d, terms]) => [name, { name, d, terms }]));
    return icons;
  });
  return loading;
}

/** The icon set, or null until it has loaded. */
export function usePhosphor(enabled = true): Map<string, PhosphorIcon> | null {
  const [loaded, setLoaded] = useState(icons);
  useEffect(() => {
    if (enabled && !loaded) loadPhosphor().then(setLoaded, () => {});
  }, [enabled, loaded]);
  return loaded;
}

/** Icons matching a search: every word must appear in the name or its terms. Name matches come first. */
export function searchPhosphor(all: Iterable<PhosphorIcon>, query: string): PhosphorIcon[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [...all];
  const q = words.join('-');
  const rank = (icon: PhosphorIcon) => (icon.name === q ? 0 : icon.name.startsWith(q) ? 1 : icon.name.includes(q) ? 2 : 3);
  return [...all]
    .filter((icon) => words.every((w) => icon.name.includes(w) || icon.terms.includes(w)))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
