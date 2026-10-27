// Vite plugin for Phosphor icons, generated from @phosphor-icons/core at build time:
//
//  - `import { HeartIcon } from '@phosphor-icons/react'` gives the app's icons. The package itself
//    ships all six weights of every icon (~2 kB each), so its import is served by a module with only
//    the weights the app uses (regular, bold, fill); its types still come from the package. Unused
//    icons are tree-shaken from the build.
//  - `import('virtual:phosphor-icons')` gives every icon (regular weight) as [name, svg path, search
//    terms], for the collection icon picker. It's loaded lazily, so the ~1,500 icons are one cached
//    chunk rather than part of the main bundle.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

const ID = 'virtual:phosphor-icons';
const RESOLVED = `\0${ID}`;
const REACT = '@phosphor-icons/react';
const RESOLVED_REACT = `\0${REACT}`;
const WEIGHTS = ['regular', 'bold', 'fill'] as const;

const assets = path.resolve(path.dirname(createRequire(import.meta.url).resolve('@phosphor-icons/core/assets/regular/acorn.svg')), '..');

/** An icon's markup inside <svg>, in a 256×256 viewBox. */
function inner(name: string, weight: string): string {
  const file = weight === 'regular' ? `${name}.svg` : `${name}-${weight}.svg`;
  const svg = fs.readFileSync(path.join(assets, weight, file), 'utf8');
  const markup = svg.match(/^<svg[^>]*>(.*)<\/svg>\s*$/s)?.[1];
  if (!markup) throw new Error(`Unexpected markup in Phosphor icon ${file}`);
  return markup;
}

// Renders like the package's own IconBase (minus IconContext, which the app doesn't use).
const RUNTIME = `import { createElement, forwardRef } from 'react';
const icon = (name, weights) => {
  const Icon = forwardRef(({ alt, color = 'currentColor', size = '1em', weight = 'regular', mirrored, children, ...rest }, ref) =>
    createElement(
      'svg',
      { ref, xmlns: 'http://www.w3.org/2000/svg', width: size, height: size, fill: color, viewBox: '0 0 256 256', transform: mirrored ? 'scale(-1, 1)' : undefined, ...rest },
      alt ? createElement('title', null, alt) : null,
      children,
      createElement('g', { dangerouslySetInnerHTML: { __html: weights[weight] ?? weights.regular } }),
    ),
  );
  Icon.displayName = name;
  return Icon;
};
`;

export function phosphorIcons(): Plugin {
  return {
    name: 'magpie-phosphor-icons',
    enforce: 'pre',
    resolveId: (id) => (id === ID ? RESOLVED : id === REACT ? RESOLVED_REACT : undefined),
    async load(id) {
      if (id !== RESOLVED && id !== RESOLVED_REACT) return;
      const { icons } = await import('@phosphor-icons/core');
      if (id === RESOLVED_REACT) {
        const exports = icons.map((icon) => {
          const weights = Object.fromEntries(WEIGHTS.map((w) => [w, inner(icon.name, w)]));
          const name = `${icon.pascal_name}Icon`;
          return `export const ${name} = /* @__PURE__ */ icon(${JSON.stringify(name)}, ${JSON.stringify(weights)});`;
        });
        return RUNTIME + exports.join('\n');
      }
      const entries = icons.map((icon) => {
        const d = inner(icon.name, 'regular').match(/^<path d="([^"]+)"\/>$/)?.[1];
        if (!d) throw new Error(`Unexpected markup in Phosphor icon ${icon.name}`);
        // Tags like "*new*" are labels for the Phosphor site, not search terms.
        const terms = [...icon.tags, ...icon.categories].filter((t) => !t.startsWith('*')).join(' ');
        return [icon.name, d, terms];
      });
      return `export default ${JSON.stringify(entries)};`;
    },
  };
}
