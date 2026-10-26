import fs from 'node:fs';
import path from 'node:path';

const env = process.env;
const flag = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

/** package.json is the one place the version is written down. */
const { version } = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string };

export const config = {
  version,
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  /** Block new sign-ups once the first account exists. */
  disableSignups: flag(env.DISABLE_SIGNUPS, false),
  /** Behind a reverse proxy: take the client address from the last X-Forwarded-For entry (for rate limits). */
  trustProxy: flag(env.TRUST_PROXY, false),
  /** Fetch page metadata for new bookmarks. Disabled in tests. */
  fetchEnabled: flag(env.FETCH_ENABLED, true),
  /** Allow fetching URLs that resolve to private / loopback addresses (homelab links). */
  fetchAllowPrivate: flag(env.FETCH_ALLOW_PRIVATE_NETWORKS, false),
  fetchTimeoutMs: Number(env.FETCH_TIMEOUT_MS ?? 15_000),
  fetchConcurrency: Number(env.FETCH_CONCURRENCY ?? 3),
  fetchUserAgent:
    env.FETCH_USER_AGENT ??
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Magpie/${version}`,
  /** Discogs pages challenge bots, so their metadata comes from the public API instead. Replaced in tests. */
  discogsApiUrl: 'https://api.discogs.com',
  maxUploadBytes:Number(env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024,
  backupRetention: Number(env.BACKUP_RETENTION ?? 14),
  sessionDays: 30,
};
