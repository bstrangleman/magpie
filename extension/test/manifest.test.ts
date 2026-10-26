import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { manifestFor, type Manifest } from '../../scripts/extension-manifest.ts';

const source = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/manifest.json'), 'utf8')) as Manifest;

describe('per-browser manifests', () => {
  test('Chrome gets only the service worker, without Firefox settings', () => {
    const m = manifestFor(source, 'chrome', '1.2.3');
    assert.deepEqual(m.background, { service_worker: 'background.js' });
    assert.equal('browser_specific_settings' in m, false);
  });

  test('Firefox gets only the background script, and keeps its add-on id', () => {
    const m = manifestFor(source, 'firefox', '1.2.3');
    assert.deepEqual(m.background, { scripts: ['background.js'] });
    assert.deepEqual(m.browser_specific_settings, source.browser_specific_settings);
  });

  test('the version comes from package.json', () => {
    const { version } = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8')) as { version: string };
    assert.equal('version' in source, false, 'not written in the source manifest');
    for (const browser of ['chrome', 'firefox'] as const) assert.equal(manifestFor(source, browser, version).version, version);
  });

  test('everything else is unchanged, and the source is left alone', () => {
    const before = structuredClone(source);
    for (const browser of ['chrome', 'firefox'] as const) {
      const { background: _b, browser_specific_settings: _s, version: _v, ...rest } = manifestFor(source, browser, '1.2.3');
      const { background: _sb, browser_specific_settings: _ss, ...sourceRest } = source;
      assert.deepEqual(rest, sourceRest);
    }
    assert.deepEqual(source, before);
  });
});
