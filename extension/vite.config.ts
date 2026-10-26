import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = import.meta.dirname;
const outDir = path.resolve(root, '../dist/extension');

// Two builds (see `npm run build:extension`):
//  1. the popup + options pages, as ES modules;
//  2. `--mode background`: the background script as one classic file, so the same file works as a
//     Chrome service worker and as a Firefox background script.
export default defineConfig(({ mode }) =>
  mode === 'background'
    ? {
        root,
        publicDir: false,
        build: {
          outDir,
          emptyOutDir: false,
          target: 'es2022',
          rolldownOptions: {
            input: path.resolve(root, 'src/background.ts'),
            output: { format: 'iife', entryFileNames: 'background.js' },
          },
        },
      }
    : {
        root,
        base: './',
        plugins: [react(), tailwindcss()],
        build: {
          outDir,
          emptyOutDir: true,
          target: 'es2022',
          // The preload polyfill is an inline-ish helper extensions don't need.
          modulePreload: { polyfill: false },
          rolldownOptions: {
            input: { popup: path.resolve(root, 'popup.html'), options: path.resolve(root, 'options.html') },
          },
        },
        // `npm run dev:extension` serves the pages with a mocked browser API (src/dev-shim.ts).
        server: {
          port: 5174,
          strictPort: true,
          proxy: { '/api': { target: 'http://localhost:3000', xfwd: true } },
        },
      },
);
