import { headers } from 'next/headers';

/**
 * Staff calls to the MyDiveLog API.
 *
 * Reads in this panel go straight to the database — see `db.ts` — but nothing
 * that *changes* data does. Every mutation goes through `/v1/admin`, where the
 * change and its audit row are written by the same transaction. Two apps
 * writing to the same tables is how an acceptance criterion quietly stops
 * being true in one of them.
 *
 * Authentication is the Cloudflare Access token this request already carries,
 * forwarded unchanged. The API verifies it again against Cloudflare's keys
 * rather than trusting that this app did: the panel and the API are separate
 * services, and an API that trusts a header from whatever claims to be the
 * panel is an API with no staff authentication at all.
 */

const API_URL = process.env['API_URL'] ?? 'http://localhost:53001';

/**
 * Said once, at startup.
 *
 * `API_URL` is a Fly secret rather than an entry in `infra/fly/admin.*.toml` —
 * this repository is public and the address of an internal service does not
 * belong in it. The cost of that is a setting nobody can see by reading the
 * config, so a deployed panel with the secret unset looks exactly like a
 * correctly configured one right up until somebody presses a button and the
 * request goes to localhost.
 *
 * `APP_ENV` is set on both deployed panels and on neither developer laptop,
 * which makes it the signal for "this default is wrong here".
 */
if (process.env['APP_ENV'] !== undefined && process.env['API_URL'] === undefined) {
  console.warn(
    `admin: API_URL is not set, so staff changes will be sent to ${API_URL} and fail. ` +
      'Set it: fly secrets set --app mydivelog-admin-<env> API_URL=...',
  );
}

/**
 * Deliberately not an exception.
 *
 * A server action that throws renders Next's error page, which says nothing
 * about what went wrong — and the API's refusals are the useful part here.
 * "Merge it into the right site instead" is the whole answer to the question
 * the operator just asked.
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; detail: string };

export async function apiSend<T = unknown>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<ApiResult<T>> {
  const incoming = await headers();
  const token = incoming.get('cf-access-jwt-assertion');
  const ip = incoming.get('cf-connecting-ip');

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: init.method,
      headers: {
        'content-type': 'application/json',
        // Absent locally, where both services run with the Access check
        // disabled. Sending an empty header instead would look configured.
        ...(token === null ? {} : { 'cf-access-jwt-assertion': token }),
        // So the audit row names the staff member's address rather than this
        // container's. Trusted exactly as far as the token above is.
        ...(ip === null ? {} : { 'cf-connecting-ip': ip }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch (err) {
    // The API being unreachable is the single most likely failure in a panel
    // deployed separately from it, and "fetch failed" on a blank page is the
    // least useful way to learn that.
    return {
      ok: false,
      status: 0,
      detail: `Could not reach the API at ${API_URL}: ${String(err)}`,
    };
  }

  if (response.status === 204) return { ok: true, data: undefined as T };

  const text = await response.text();
  const parsed = text === '' ? undefined : safeJson(text);

  if (!response.ok) {
    const problem = parsed as { detail?: string; title?: string } | undefined;
    return {
      ok: false,
      status: response.status,
      detail: problem?.detail ?? problem?.title ?? `The API answered ${response.status}.`,
    };
  }

  return { ok: true, data: parsed as T };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Where a failed action puts its message.
 *
 * A redirect that carries an error nobody reads is how a broken button looks
 * exactly like a working one — which is a bug this codebase has already
 * shipped once. `Notice` in `components/StaffForm.tsx` is the other half, and
 * every page with an action renders it.
 */
export const withError = (path: string, detail: string): string =>
  `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(detail)}`;

export const withDone = (path: string, message: string): string =>
  `${path}${path.includes('?') ? '&' : '?'}done=${encodeURIComponent(message)}`;
