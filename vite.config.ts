import fs from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { phosphorIcons } from './scripts/vite-phosphor.ts';

const { version } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss(), phosphorIcons()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:3000', xfwd: true } },
  },
});
