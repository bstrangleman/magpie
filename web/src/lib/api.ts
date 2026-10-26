export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(`/api${path}`, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? res.statusText;
    if (res.status === 401 && !path.startsWith('/auth/') && path !== '/me') signInAgain();
    throw new ApiError(res.status, message || 'Request failed');
  }
  return data as T;
}

/**
 * The session ended (expired, signed out elsewhere, or ended by a password change): go to the
 * sign-in page, then come back. A full page load, so nothing from the old session stays cached.
 * (A 401 from /me itself is handled by the router, which shows the sign-in page.)
 */
function signInAgain() {
  const { pathname, search } = window.location;
  if (pathname === '/login' || pathname === '/signup') return;
  window.location.replace(`/login?next=${encodeURIComponent(pathname + search)}`);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
