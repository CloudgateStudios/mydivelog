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
export async function signIn(context: BrowserContext, email: string): Promise<void> {
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
  const tokens = (await response.json()) as { accessToken: string; refreshToken: string };
  const { hostname } = new URL(WEB_URL);

  await context.addCookies([
    { name: 'mdl_at', value: tokens.accessToken, domain: hostname, path: '/', httpOnly: true },
    { name: 'mdl_rt', value: tokens.refreshToken, domain: hostname, path: '/', httpOnly: true },
  ]);
}
