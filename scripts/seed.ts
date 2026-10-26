// Fill a running Magpie server with demo data through the HTTP API.
//   node scripts/seed.ts [http://localhost:3000]            collections + a few real links
//   node scripts/seed.ts --history [http://localhost:3000]  also import a year of sample history
// Creates (or signs in as) demo@magpie.test / magpie-demo.

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const withHistory = args.includes('--history');
const account = { name: 'Demo', email: 'demo@magpie.test', password: 'magpie-demo' };
let cookie = '';

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

try {
  await call('POST', '/auth/signup', account);
  console.log(`Created ${account.email}`);
} catch {
  await call('POST', '/auth/login', account);
  console.log(`Signed in as ${account.email}`);
}

// A year of plausible saving history (for the statistics page), imported as a bookmarks file.
// Deterministic, and re-running it skips what's already there.
async function importHistory() {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  // folder is the collection path (nested collections match the ones created above).
  const sites: { host: string; folder: string[]; tags: string[]; titles: string[]; weight: number }[] = [
    { host: 'github.com', folder: ['Programming'], tags: ['code', 'open-source'], titles: ['A tiny SQLite ORM', 'Self-hosted photo library', 'Terminal file manager', 'Static site generator'], weight: 9 },
    { host: 'developer.mozilla.org', folder: ['Programming'], tags: ['css', 'javascript'], titles: ['CSS container queries', 'Intl.DateTimeFormat', 'The :has() selector', 'View transitions API'], weight: 7 },
    { host: 'en.wikipedia.org', folder: ['Read Later'], tags: ['learning'], titles: ['Corvidae', 'Golden ratio', 'History of photography', 'Bauhaus'], weight: 7 },
    { host: 'www.youtube.com', folder: ['Streaming', 'Video'], tags: ['video'], titles: ['Lens review', 'Knife skills 101', 'Building a homelab', 'Street photography walk'], weight: 6 },
    { host: 'news.ycombinator.com', folder: ['Read Later'], tags: ['news'], titles: ['Ask HN: Favourite tools', 'Show HN: A bookmark manager', 'The case for boring tech'], weight: 6 },
    { host: 'www.seriouseats.com', folder: ['Recipes'], tags: ['recipe'], titles: ['Perfect roast potatoes', 'Weeknight ramen', 'Crispy smashed burgers', 'Sourdough basics'], weight: 6 },
    { host: 'www.dpreview.com', folder: ['Study', 'Photography'], tags: ['cameras'], titles: ['Prime lens buying guide', 'Mirrorless roundup', 'Shooting in low light'], weight: 4 },
    { host: 'petapixel.com', folder: ['Study', 'Photography'], tags: ['photography'], titles: ['Composition rules to break', 'Film is back', 'Editing workflow'], weight: 3 },
    { host: 'www.smashingmagazine.com', folder: ['Programming', 'UI/UX Design'], tags: ['design'], titles: ['Designing better forms', 'Accessible colour palettes', 'Typography for the web'], weight: 4 },
    { host: 'dribbble.com', folder: ['Programming', 'UI/UX Design'], tags: ['design', 'inspiration'], titles: ['Dashboard concept', 'Mobile banking app', 'Icon set'], weight: 3 },
    { host: 'arxiv.org', folder: ['Study', 'AI'], tags: ['ai', 'papers'], titles: ['Scaling laws revisited', 'Retrieval for long context', 'Tool use in agents'], weight: 3 },
    { host: 'www.anthropic.com', folder: ['Study', 'AI'], tags: ['ai'], titles: ['Research notes', 'Interpretability update'], weight: 2 },
    { host: 'www.theverge.com', folder: ['Read Later'], tags: ['tech'], titles: ['Best e-readers', 'The state of smart homes', 'Laptop review'], weight: 4 },
    { host: 'unsplash.com', folder: ['Content Creation', 'Stock Photography'], tags: ['photos'], titles: ['Mountain mornings', 'Minimal interiors', 'City at night'], weight: 2 },
    { host: 'open.spotify.com', folder: ['Streaming'], tags: ['music'], titles: ['Focus playlist', 'Jazz for rainy days', 'New releases'], weight: 3 },
    { host: 'www.ikea.com', folder: ['Home'], tags: ['home'], titles: ['Bookshelf', 'Desk lamp', 'Storage boxes'], weight: 2 },
    { host: 'www.gardenersworld.com', folder: ['Home'], tags: ['garden'], titles: ['Raised bed planning', 'Pruning roses', 'Winter vegetables'], weight: 2 },
    { host: 'www.reddit.com', folder: [], tags: ['reddit'], titles: ['r/homelab setup', 'r/photography critique', 'r/cooking tips'], weight: 4 },
  ];
  const weighted = sites.flatMap((s) => Array<typeof s>(s.weight).fill(s));
  // Busier on weekdays (peaking Thursday), with morning, lunchtime and evening peaks.
  const weekdayWeight = [1.0, 1.1, 1.15, 1.35, 1.0, 0.6, 0.55];
  const hours = [7, 8, 8, 9, 9, 9, 10, 12, 12, 13, 15, 17, 19, 20, 20, 21, 21, 21, 22, 22, 23];

  type Folder = { links: string[]; children: Map<string, Folder> };
  const root: Folder = { links: [], children: new Map() };
  const folderAt = (path: string[]) =>
    path.reduce((node, name) => {
      if (!node.children.has(name)) node.children.set(name, { links: [], children: new Map() });
      return node.children.get(name)!;
    }, root);
  let count = 0;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let back = 364; back >= 1; back--) {
    const day = new Date(start);
    day.setDate(start.getDate() - back);
    const growth = 0.55 + (1 - back / 365) * 0.9; // saving more as the year goes on
    const burst = rand() < 0.05 ? 4 : 1;
    const expected = 1.25 * weekdayWeight[(day.getDay() + 6) % 7]! * growth * burst;
    let n = 0;
    while (rand() < expected / (n + 1.6) && n < 12) n++;
    for (let i = 0; i < n; i++) {
      const site = pick(weighted);
      const when = new Date(day);
      when.setHours(pick(hours), Math.floor(rand() * 60));
      const title = pick(site.titles);
      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${count++}`;
      const tags = site.tags.filter(() => rand() < 0.8);
      folderAt(site.folder).links.push(
        `<DT><A HREF="https://${site.host}/${slug}" ADD_DATE="${Math.floor(when.getTime() / 1000)}"${tags.length ? ` TAGS="${esc(tags.join(','))}"` : ''}${rand() < 0.08 ? ' DATA-IMPORTANT="true"' : ''}>${esc(title)}</A>`,
      );
    }
  }
  const render = (node: Folder): string =>
    [...[...node.children].map(([name, child]) => `<DT><H3>${esc(name)}</H3>\n<DL><p>\n${render(child)}\n</DL><p>`), ...node.links].join('\n');
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n${render(root)}\n</DL><p>\n`;

  const form = new FormData();
  form.set('file', new File([html], 'history.html', { type: 'text/html' }));
  form.set('fetchMetadata', 'false');
  const res = await fetch(`${base}/api/import`, { method: 'POST', headers: { cookie }, body: form });
  const result = (await res.json()) as { created: number; skipped: number };
  if (!res.ok) throw new Error(`import: ${res.status} ${JSON.stringify(result)}`);
  console.log(`History: imported ${result.created} bookmarks (${result.skipped} already there).`);
}

const sidebar = await call('GET', '/sidebar');
if (sidebar.counts.all > 0) {
  if (withHistory) await importHistory();
  else console.log('Account already has bookmarks; nothing to do. (Add --history for a year of sample data.)');
  process.exit(0);
}

const side = await call('POST', '/groups', { name: 'Side Hustles' });
const col = async (name: string, icon: string | null, extra: object = {}) => (await call('POST', '/collections', { name, icon, ...extra })).id as number;

const home = await col('Home', '🏠');
const study = await col('Study', '📚');
const photography = await col('Photography', '📷', { parentId: study, color: '#64748b' });
const ai = await col('AI', '🧠', { parentId: study });
const streaming = await col('Streaming', '📺', { color: '#e5484d' });
const video = await col('Video', '🎬', { parentId: streaming });
const programming = await col('Programming', '💻', { color: '#3a7bd5' });
const design = await col('UI/UX Design', '🎨', { parentId: programming });
const recipes = await col('Recipes', '🍳');
const readLater = await col('Read Later', '📖', { color: '#f97316' });
const content = await col('Content Creation', '🎥', { groupId: side.id });
const stock = await col('Stock Photography', null, { parentId: content });

const bookmarks: [string, number | null, string[]?][] = [
  ['https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout', programming, ['css']],
  ['https://react.dev/learn', programming, ['react']],
  ['https://sqlite.org/fts5.html', programming, ['sqlite', 'search']],
  ['https://github.com/louislam/uptime-kuma', programming, ['self-hosted']],
  ['https://tailwindcss.com/docs/installation', design, ['css']],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', video],
  ['https://en.wikipedia.org/wiki/Eurasian_magpie', readLater, ['birds']],
  ['https://paulgraham.com/greatwork.html', readLater, ['essays']],
  ['https://www.seriouseats.com/the-food-lab-complete-guide-to-sous-vide-steak', recipes, ['recipe']],
  ['https://www.dpreview.com/', photography],
  ['https://en.wikipedia.org/wiki/Exposure_triangle', photography, ['learning']],
  ['https://www.anthropic.com/research', ai],
  ['https://unsplash.com/', stock],
  ['https://news.ycombinator.com/', null],
  ['https://this-domain-does-not-exist.example/', null],
];

for (const [url, collectionId, tags] of bookmarks) {
  await call('POST', '/bookmarks', { url, collectionId, tags });
}
await call('POST', '/bookmarks', {
  title: 'Garden ideas',
  note: '## Spring\n- Raised beds along the **north fence**\n- Move the lemon tree\n\n## Later\n- Drip irrigation',
  collectionId: home,
  tags: ['garden'],
});
await call('POST', '/bookmarks', { url: 'https://react.dev/learn', collectionId: null, tags: ['react'] });

console.log(`Seeded ${bookmarks.length + 2} bookmarks. Metadata is being fetched in the background.`);
if (withHistory) await importHistory();
