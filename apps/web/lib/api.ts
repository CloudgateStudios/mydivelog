import { readAccessToken, readRefreshToken, storeSession, type TokenPair } from './session';

/**
 * Server-side calls to the MyDiveLog API.
 *
 * Only ever runs on the server: the access token comes from an httpOnly cookie
 * the browser cannot read, and it must not start being sent from the client to
 * make a component simpler.
 */

const API_URL = process.env['API_URL'] ?? 'http://localhost:53001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/**
 * A request that carries the session, refreshing it once if the access token
 * has expired.
 *
 * The retry is deliberately single. Refresh tokens rotate with reuse
 * detection, so a loop that retried on every 401 would eventually replay one
 * and revoke the whole family — signing the diver out of every device to fix a
 * transient error.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await readAccessToken();
  const response = await call(path, init, token);
  if (response.status !== 401) return response;

  const refreshed = await refresh();
  if (!refreshed) return response;
  return call(path, init, refreshed.accessToken);
}

async function call(path: string, init: RequestInit, token?: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    // A logbook page must not be served from a cache shared with another
    // diver, and Next caches fetches by default.
    cache: 'no-store',
  });
}

async function refresh(): Promise<TokenPair | undefined> {
  const refreshToken = await readRefreshToken();
  if (!refreshToken) return undefined;

  const response = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!response.ok) return undefined;

  const tokens = (await response.json()) as TokenPair;
  await storeSession(tokens);
  return tokens;
}

/** Parsed JSON, or a thrown ApiError carrying the problem detail. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(response.status, problem.detail ?? `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

/** The signed-in diver, or undefined. Never throws for a missing session. */
export async function currentUser(): Promise<TokenPair['user'] | undefined> {
  if (!(await readAccessToken()) && !(await readRefreshToken())) return undefined;
  try {
    const session = await apiJson<{ user: TokenPair['user'] }>('/v1/auth/session');
    return session.user;
  } catch {
    return undefined;
  }
}

export { API_URL };
