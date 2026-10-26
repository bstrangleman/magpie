// Firefox exposes the WebExtension API as `browser`, Chrome as `chrome`. Both are promise-based
// in Manifest V3, so the Chrome typings describe either.
export const ext: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? globalThis.chrome;
