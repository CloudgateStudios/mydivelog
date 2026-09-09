import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';

const API_URL = process.env['API_URL'] ?? 'http://localhost:53001';
const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:53000';

/**
 * Sign in without driving the sign-in form.
 *
 * The magic-link flow has its own test; every *other* test needs a session and
 * should not pay for one. The development login stub mints the same tokens the
 * real flow does, and they are written into the same httpOnly cookies the web
 * app sets — so what these tests exercise is the authenticated app, not a
 * pretend session that skips the middleware.
 */
/*
 * One login per email per run, not one per test.
 *
 * The suite runs every test in both colour schemes, which doubled the calls to
 * the login stub and started tripping its rate limit — a 429 that looked like
 * an authentication bug and was really the tests hammering an endpoint that is
 * right to push back. The tokens are identical for every test anyway.
 */
const sessions = new Map<string, Promise<{ accessToken: string; refreshToken: string }>>();

async function tokensFor(email: string) {
  const existing = sessions.get(email);
  if (existing) return existing;

  const pending = (async () => {
    const response = await fetch(`${API_URL}/v1/auth/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) {
      throw new Error(
        `dev login failed (${response.status}). Is the API running with AUTH_DEV_LOGIN_ENABLED=true?`,
      );
    }
    return (await response.json()) as { accessToken: string; refreshToken: string };
  })();

  sessions.set(email, pending);
  return pending;
}

/**
 * A logbook built through the API, for a test that needs a particular shape of
 * data rather than the demo diver's.
 *
 * Over HTTP rather than by touching the database: a test that seeds rows
 * directly can create a logbook the import engine would never produce, and
 * then proves something about a state no diver can reach.
 */
export async function importFixtureFor(email: string, fileName: string): Promise<void> {
  const { accessToken } = await tokensFor(email);
  const auth = { authorization: `Bearer ${accessToken}` };

  // `__dirname`, not `import.meta`: Playwright compiles these specs to
  // CommonJS, where the latter is a syntax error rather than a wrong path.
  const bytes = await readFile(join(__dirname, '..', 'fixtures', fileName));
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(bytes)]), fileName);

  const created = await fetch(`${API_URL}/v1/imports`, {
    method: 'POST',
    headers: auth,
    body: form,
  });
  if (!created.ok) throw new Error(`import of ${fileName} failed: ${created.status}`);
  const batch = (await created.json()) as {
    id: string;
    rows: { rowIndex: number; decision: string }[];
  };

  for (const row of batch.rows) {
    if (row.decision !== 'pending') continue;
    await fetch(`${API_URL}/v1/imports/${batch.id}/rows/${row.rowIndex}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'create' }),
    });
  }
  await fetch(`${API_URL}/v1/imports/${batch.id}/commit`, { method: 'POST', headers: auth });
}

/**
 * Promotes a site into the shared database, the way staff would.
 *
 * There is no diver-facing route to this: promotion is staff-initiated, which
 * is the whole reason renaming a shared site is a request rather than an edit.
 * So the test does what a moderator does — the same `/v1/admin` endpoint the
 * panel calls, authenticated by the development staff identity CI configures.
 *
 * Returns the site's id, so a test can go straight to its page.
 */
export async function shareASiteOf(email: string): Promise<string> {
  const { accessToken } = await tokensFor(email);
  const sites = await fetch(`${API_URL}/v1/sites`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = (await sites.json()) as { data: { id: string }[] };
  const site = body.data[0];
  if (!site) throw new Error(`${email} has no sites; import a logbook first.`);

  const promoted = await fetch(`${API_URL}/v1/admin/sites/${site.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ isPublic: true, reason: 'e2e: a site everyone can see' }),
  });
  if (!promoted.ok) {
    throw new Error(
      `could not promote a site (${promoted.status}). Is the API running with ` +
        'ADMIN_ACCESS_CHECK_DISABLED=true and a staff account for ADMIN_DEV_STAFF_EMAIL? ' +
        'See `pnpm staff <email> --create`.',
    );
  }
  return site.id;
}

export async function signIn(context: BrowserContext, email: string): Promise<void> {
  const tokens = await tokensFor(email);
  const { hostname } = new URL(WEB_URL);

  await context.addCookies([
    { name: 'mdl_at', value: tokens.accessToken, domain: hostname, path: '/', httpOnly: true },
    { name: 'mdl_rt', value: tokens.refreshToken, domain: hostname, path: '/', httpOnly: true },
  ]);
}
