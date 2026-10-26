// Package the built extension (dist/extension) once per browser, as dist/extension-<browser>/
// (for loading unpacked) and dist/magpie-extension-<browser>.zip (served by the app).
//   node scripts/package-extension.ts
import fs from 'node:fs';
import path from 'node:path';
import { EXTENSION_BROWSERS } from '../shared/types.ts';
import { manifestFor, type Manifest } from './extension-manifest.ts';
import { zipDirectory } from './zip.ts';

const dist = path.resolve(import.meta.dirname, '../dist');
const built = path.join(dist, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8')) as Manifest;
const { version } = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string };

for (const browser of EXTENSION_BROWSERS) {
  const dir = path.join(dist, `extension-${browser}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(built, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifestFor(manifest, browser, version), null, 2)}\n`);
  zipDirectory(dir, path.join(dist, `magpie-extension-${browser}.zip`));
}
