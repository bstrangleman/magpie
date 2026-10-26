import { Hono } from 'hono';
import type { AppEnv } from '../lib/auth.ts';
import { getStats, validTimeZone } from '../services/stats.ts';

export const statsRoutes = new Hono<AppEnv>()
  // ?tz=Europe/London buckets activity by the viewer's calendar days and hours.
  .get('/stats', (c) => c.json(getStats(c.var.user.id, validTimeZone(c.req.query('tz')))));
