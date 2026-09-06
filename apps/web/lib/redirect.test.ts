import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { redirectTo } from './redirect';

/**
 * No route may build a redirect out of its own origin.
 *
 * A Route Handler sees the address the server is bound to, which inside a
 * container is `0.0.0.0:8080`. Signing in with Google sent people to
 * `https://0.0.0.0:8080/logbook`, and the magic link did the same — neither
 * showed up in development, because there the bind address happens to be the
 * address people use.
 *
 * This scans the source rather than exercising the routes, for the same reason
 * the admin panel's privacy test does: the failure is a shape in the code, and
 * a shape is worth catching in every file including the one added next week.
 */

const appDir = fileURLToPath(new URL('../app', import.meta.url));

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === 'route.ts' ? [full] : [];
  });
}

/** Ways to end up with the server's own address in a Location header. */
const FORBIDDEN = [
  { pattern: /nextUrl\.origin/, why: 'nextUrl.origin is the address the server is bound to' },
  { pattern: /nextUrl\.host\b/, why: 'nextUrl.host is the address the server is bound to' },
  { pattern: /new URL\([^)]*request\.url/, why: 'request.url carries the bind address' },
  {
    pattern: /x-forwarded-host/i,
    why: 'x-forwarded-host is a header any client can send; trusting it is worse than not knowing',
  },
];

describe('route handlers', () => {
  const files = routeFiles(appDir);

  it('found the routes to check', () => {
    // Otherwise a rename turns this whole file into a silent pass.
    expect(files.length).toBeGreaterThan(2);
  });

  it.each(files.map((f) => [f.slice(appDir.length + 1), f]))(
    '%s redirects without naming its own host',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(source), `${why} — use redirectTo() from lib/redirect`).toBe(false);
      }
    },
  );

  it('sends a relative Location, so the browser resolves it itself', () => {
    // The browser is the only party that knows what this site is publicly
    // called. Asserted on the response rather than on the source, because the
    // first version of this test matched the example URL in redirect.ts's own
    // comment and failed on the fix it was written to protect.
    const response = redirectTo('/logbook');
    expect(response.headers.get('location')).toBe('/logbook');
    expect(response.status).toBe(303);
  });

  it('keeps a query string intact', () => {
    expect(redirectTo('/signin?error=cancelled').headers.get('location')).toBe(
      '/signin?error=cancelled',
    );
  });
});
