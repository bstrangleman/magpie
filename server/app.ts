import fs from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { checkOrigin, requireAuth, type AppEnv } from './lib/auth.ts';
import { accountRoutes, authRoutes } from './routes/auth.ts';
import { bookmarkRoutes } from './routes/bookmarks.ts';
import { collectionRoutes } from './routes/collections.ts';
import { ioRoutes } from './routes/io.ts';
import { statsRoutes } from './routes/stats.ts';

const defaultWebDist = path.resolve(import.meta.dirname, '../dist/web');

/**
 * Content-Security-Policy for the web app's pages. Scripts only from this origin; images from
 * anywhere (covers and pictures inside saved articles); embeds only from YouTube's no-cookie host
 * and this origin (PDFs). Inline style attributes are allowed: they're low risk, and saved notes use them.
 */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

export function createApp({ webDist = defaultWebDist }: { webDist?: string } = {}) {
  const app = new Hono<AppEnv>();

  app.use(secureHeaders({ crossOriginResourcePolicy: false, crossOriginOpenerPolicy: false, referrerPolicy: 'same-origin' }));
  app.use('*', async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/api/') && c.res.headers.get('content-type')?.startsWith('text/html')) {
      c.header('content-security-policy', APP_CSP);
    }
  });
  app.use('/api/*', checkOrigin);

  // Public endpoints first; everything registered after requireAuth needs a session or API key.
  app.route('/api', authRoutes);
  app.use('/api/*', requireAuth);
  app.route('/api', accountRoutes);
  app.route('/api', bookmarkRoutes);
  app.route('/api', collectionRoutes);
  app.route('/api', ioRoutes);
  app.route('/api', statsRoutes);
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  // The built web client (production). In development Vite serves it instead.
  if (fs.existsSync(webDist)) {
    const index = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
    app.use('/assets/*', async (c, next) => {
      await next();
      if (c.res.ok) c.header('cache-control', 'public, max-age=31536000, immutable');
    });
    app.use('/*', serveStatic({ root: path.relative(process.cwd(), webDist) || '.' }));
    // A missing build file is a 404, not the app's HTML (which the rule above would cache for a year).
    app.get('/assets/*', (c) => c.text('Not found', 404));
    app.get('*', (c) => c.html(index));
  }

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  return app;
}
