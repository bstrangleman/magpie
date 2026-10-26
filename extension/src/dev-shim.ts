// `npm run dev:extension` serves the popup and options pages as ordinary web pages with hot reload.
// Outside a real extension there's no `chrome` API, so a small stand-in is installed here.
// This module is empty in production builds.
//   Popup:   http://localhost:5174/popup.html?url=https://example.com&title=Example
//   Options: http://localhost:5174/options.html   (use http://localhost:5174 as the server address)

if (import.meta.env.DEV && !(globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id) {
  const params = new URLSearchParams(location.search);
  const KEY = 'magpie-extension-dev';
  const read = (): Record<string, unknown> => JSON.parse(localStorage.getItem(KEY) ?? '{}');
  const write = (value: Record<string, unknown>) => localStorage.setItem(KEY, JSON.stringify(value));
  const noop = async () => {};

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: read()[key] }),
        set: async (items: Record<string, unknown>) => write({ ...read(), ...items }),
        remove: async (key: string) => {
          const all = read();
          delete all[key];
          write(all);
        },
      },
    },
    tabs: {
      query: async () => [
        {
          id: 1,
          url: params.get('url') ?? 'https://developer.mozilla.org/en-US/docs/Web/HTML',
          title: params.get('title') ?? 'HTML: HyperText Markup Language | MDN',
          favIconUrl: params.get('favicon') ?? '',
        },
      ],
      create: async ({ url }: { url: string }) => {
        window.open(url, '_blank');
      },
    },
    runtime: {
      openOptionsPage: async () => location.assign('/options.html'),
      sendMessage: noop,
      getManifest: () => ({ version: 'dev' }),
    },
    permissions: { request: async () => true },
    commands: { getAll: async () => [{ name: '_execute_action', shortcut: 'Alt+Shift+M' }] },
  };
  // The popup closes itself after some actions; a harness tab shouldn't.
  window.close = () => console.info('[magpie] window.close() ignored in dev');
  console.info('[magpie] Running outside the extension with a mocked browser API.');
}
