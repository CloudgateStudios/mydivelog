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

export async function signIn(context: BrowserContext, email: string): Promise<void> {
  const tokens = await tokensFor(email);
  const { hostname } = new URL(WEB_URL);

  await context.addCookies([
    { name: 'mdl_at', value: tokens.accessToken, domain: hostname, path: '/', httpOnly: true },
    { name: 'mdl_rt', value: tokens.refreshToken, domain: hostname, path: '/', httpOnly: true },
  ]);
}
