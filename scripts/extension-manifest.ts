// Chrome and Firefox run a Manifest V3 extension's background script differently: Chrome as a
// service worker, Firefox as a background script. Each warns about the other's key (and Chrome
// has no use for Firefox's settings), so every package gets a manifest with only its own.
import type { ExtensionBrowser } from '../shared/types.ts';

export interface Manifest {
  background?: { service_worker?: string; scripts?: string[] };
  browser_specific_settings?: unknown;
  [key: string]: unknown;
}

/** The manifest for one browser's package. `version` comes from package.json, the one place it's written. */
export function manifestFor(manifest: Manifest, browser: ExtensionBrowser, version: string): Manifest {
  const out = { ...structuredClone(manifest), version };
  if (browser === 'chrome') {
    delete out.background?.scripts;
    delete out.browser_specific_settings;
  } else {
    delete out.background?.service_worker;
  }
  return out;
}
