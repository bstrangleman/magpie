// Vite plugin: `import('virtual:phosphor-icons')` gives every Phosphor icon (regular weight) as
// [name, svg path, search terms]. It's generated from @phosphor-icons/core at build time and
// loaded lazily, so the ~1,500 icons are one cached chunk rather than part of the main bundle.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

const ID = 'virtual:phosphor-icons';
const RESOLVED = `\0${ID}`;

export function phosphorIcons(): Plugin {
  return {
    name: 'magpie-phosphor-icons',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    async load(id) {
      if (id !== RESOLVED) return;
      const { icons } = await import('@phosphor-icons/core');
      const dir = path.dirname(createRequire(import.meta.url).resolve('@phosphor-icons/core/assets/regular/acorn.svg'));
      const entries = icons.map((icon) => {
        const svg = fs.readFileSync(path.join(dir, `${icon.name}.svg`), 'utf8');
        const d = svg.match(/<path d="([^"]+)"\/>/)?.[1];
        if (!d) throw new Error(`Unexpected markup in Phosphor icon ${icon.name}`);
        // Tags like "*new*" are labels for the Phosphor site, not search terms.
        const terms = [...icon.tags, ...icon.categories].filter((t) => !t.startsWith('*')).join(' ');
        return [icon.name, d, terms];
      });
      return `export default ${JSON.stringify(entries)};`;
    },
  };
}
