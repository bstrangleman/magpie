import './env.ts';
import { createApp } from '../app.ts';
import { openDb } from '../db/index.ts';

openDb(':memory:');
export const app = createApp();

/** A tiny client that keeps the session cookie between requests. */
export class Client {
  cookie = '';
  headers: Record<string, string> = {};
  /** Set to make requests appear to come from this address (as the Node server would see it). */
  ip?: string;

  async req<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T; res: Response }> {
    const init: RequestInit = { method, headers: { ...this.headers, ...(this.cookie ? { cookie: this.cookie } : {}) } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
    }
    const env = this.ip ? { incoming: { socket: { remoteAddress: this.ip } } } : undefined;
    const res = await app.request(`http://localhost${path}`, init, env);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0]!;
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data: data as T, res };
  }

  get = <T = any>(path: string) => this.req<T>('GET', path);
  post = <T = any>(path: string, body?: unknown) => this.req<T>('POST', path, body ?? {});
  patch = <T = any>(path: string, body: unknown) => this.req<T>('PATCH', path, body);
  del = <T = any>(path: string) => this.req<T>('DELETE', path);
}

let n = 0;
export async function signedInClient(name = 'Test') {
  const c = new Client();
  const r = await c.post('/api/auth/signup', { name, email: `user${++n}-${Date.now()}@example.com`, password: 'correct horse' });
  if (r.status !== 201) throw new Error(`signup failed: ${JSON.stringify(r.data)}`);
  return c;
}
