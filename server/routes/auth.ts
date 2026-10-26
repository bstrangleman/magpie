import fs from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { EXTENSION_BROWSERS, type AuthStatus, type ExtensionBrowser } from '../../shared/types.ts';
import { config } from '../config.ts';
import {
  clearHits,
  clientIp,
  createApiKey,
  endAllSessions,
  endSession,
  hit,
  isLimited,
  startSession,
  verifyPassword,
  verifyUserPassword,
  type AppEnv,
} from '../lib/auth.ts';
import { all, run } from '../db/index.ts';
import { badRequest, forbidden, intParam, notFound, parse, tooManyRequests, unauthorized } from '../lib/http.ts';
import { THEMES, VIEW_MODES, SORTS } from '../../shared/types.ts';
import { createUser, findUserByEmail, getMe, passwordHash, setPassword, updateProfile, updateSettings, userCount } from '../services/users.ts';

const extensionZip = (browser: ExtensionBrowser) => path.resolve(import.meta.dirname, `../../dist/magpie-extension-${browser}.zip`);

/** Which extension package to serve: `?browser=` if given, otherwise a guess from the User-Agent. */
export function extensionBrowser(requested: string | undefined, userAgent: string | undefined): ExtensionBrowser {
  const known = EXTENSION_BROWSERS.find((b) => b === requested);
  return known ?? (/\bFirefox\//.test(userAgent ?? '') ? 'firefox' : 'chrome');
}

const email = z.string().trim().email('Enter a valid email address').max(200);
const password = z.string().min(8, 'Password must be at least 8 characters').max(200);

const MINUTE = 60_000;
/** Failed sign-ins allowed per account, and per client address, in each window. */
export const LOGIN_LIMITS = { account: 10, ip: 50, windowMs: 15 * MINUTE };
/** Sign-ups allowed per client address in each window. */
export const SIGNUP_LIMIT = { max: 10, windowMs: 60 * MINUTE };

/**
 * Check an email + password. Failures are limited per account (whatever address they come from)
 * and per client address; a successful sign-in clears the account's count.
 */
async function authenticate(c: Context, emailInput: string, passwordInput: string) {
  const accountKey = `login:${emailInput.trim().toLowerCase()}`;
  const ip = clientIp(c);
  const ipKey = ip ? `login-ip:${ip}` : null;
  if (isLimited(accountKey, LOGIN_LIMITS.account) || (ipKey && isLimited(ipKey, LOGIN_LIMITS.ip))) {
    throw tooManyRequests('Too many attempts. Try again in a few minutes.');
  }
  const user = findUserByEmail(emailInput);
  if (!(await verifyUserPassword(passwordInput, user?.password_hash)) || !user) {
    hit(accountKey, LOGIN_LIMITS.windowMs);
    if (ipKey) hit(ipKey, LOGIN_LIMITS.windowMs);
    throw unauthorized('Incorrect email or password');
  }
  clearHits(accountKey);
  return user;
}

export const authRoutes = new Hono<AppEnv>()
  .get('/auth/status', (c) => {
    const hasUsers = userCount() > 0;
    return c.json<AuthStatus>({ hasUsers, signupsEnabled: !hasUsers || !config.disableSignups });
  })
  .post('/auth/signup', async (c) => {
    const body = parse(z.object({ name: z.string().trim().max(100).default(''), email, password }), await c.req.json());
    if (userCount() > 0 && config.disableSignups) throw forbidden('Sign-ups are disabled on this server');
    const ip = clientIp(c);
    if (ip) {
      if (isLimited(`signup:${ip}`, SIGNUP_LIMIT.max)) throw tooManyRequests('Too many sign-ups from this address. Try again later.');
      hit(`signup:${ip}`, SIGNUP_LIMIT.windowMs);
    }
    const id = await createUser(body);
    startSession(c, id);
    return c.json(getMe(id), 201);
  })
  .post('/auth/login', async (c) => {
    const body = parse(z.object({ email: z.string().trim(), password: z.string() }), await c.req.json());
    const user = await authenticate(c, body.email, body.password);
    startSession(c, user.id);
    return c.json(getMe(user.id));
  })
  // Exchange an email + password for an API key (used by the browser extension).
  .post('/auth/token', async (c) => {
    const body = parse(
      z.object({ email: z.string().trim(), password: z.string(), name: z.string().trim().max(100).default('') }),
      await c.req.json(),
    );
    const user = await authenticate(c, body.email, body.password);
    const { id, key } = createApiKey(user.id, body.name || 'Browser extension');
    return c.json({ id, key, user: getMe(user.id) }, 201);
  })
  // The packaged browser extension for Chrome or Firefox, built by `npm run build:extension`.
  .get('/extension.zip', (c) => {
    const browser = extensionBrowser(c.req.query('browser'), c.req.header('user-agent'));
    const file = extensionZip(browser);
    if (!fs.existsSync(file)) throw notFound('The browser extension has not been built. Run `npm run build:extension`.');
    return c.body(fs.readFileSync(file), 200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="magpie-extension-${browser}.zip"`,
      vary: 'User-Agent',
    });
  })
  .post('/auth/logout', (c) => {
    endSession(c);
    return c.json({ ok: true });
  });

const viewPrefs = z.object({ view: z.enum(VIEW_MODES).optional(), sort: z.enum(SORTS).optional() });

export const accountRoutes = new Hono<AppEnv>()
  .get('/me', (c) => c.json(getMe(c.var.user.id)))
  .patch('/me', async (c) => {
    const body = parse(z.object({ name: z.string().max(100).optional(), email: email.optional() }), await c.req.json());
    return c.json(updateProfile(c.var.user.id, body));
  })
  .post('/me/password', async (c) => {
    const body = parse(z.object({ current: z.string(), next: password }), await c.req.json());
    // Shares the sign-in limit, so a stolen session can't be used to guess the password.
    const accountKey = `login:${c.var.user.email.toLowerCase()}`;
    if (isLimited(accountKey, LOGIN_LIMITS.account)) throw tooManyRequests('Too many attempts. Try again in a few minutes.');
    if (!(await verifyPassword(body.current, passwordHash(c.var.user.id)))) {
      hit(accountKey, LOGIN_LIMITS.windowMs);
      throw badRequest('Current password is incorrect');
    }
    await setPassword(c.var.user.id, body.next);
    endAllSessions(c.var.user.id);
    startSession(c, c.var.user.id);
    return c.json({ ok: true });
  })
  .patch('/settings', async (c) => {
    const body = parse(
      z.object({
        theme: z.enum(THEMES).optional(),
        largeFont: z.boolean().optional(),
        defaultView: z.enum(VIEW_MODES).optional(),
        openAction: z.enum(['tab', 'preview', 'edit']).optional(),
        tagSort: z.enum(['name', 'count']).optional(),
        autoBackup: z.boolean().optional(),
        views: z.record(z.string().max(200), viewPrefs.nullable()).optional(),
      }),
      await c.req.json(),
    );
    return c.json(updateSettings(c.var.user.id, body));
  })
  .get('/keys', (c) =>
    c.json(
      all<{ id: number; name: string; prefix: string; createdAt: number; lastUsedAt: number | null }>(
        'SELECT id, name, prefix, created_at AS createdAt, last_used_at AS lastUsedAt FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
        c.var.user.id,
      ),
    ),
  )
  .post('/keys', async (c) => {
    const body = parse(z.object({ name: z.string().trim().min(1, 'Name is required').max(100) }), await c.req.json());
    return c.json(createApiKey(c.var.user.id, body.name), 201);
  })
  .delete('/keys/:id', (c) => {
    const { changes } = run('DELETE FROM api_keys WHERE id = ? AND user_id = ?', intParam(c.req.param('id')), c.var.user.id);
    if (!changes) throw notFound('API key not found');
    return c.json({ ok: true });
  });
