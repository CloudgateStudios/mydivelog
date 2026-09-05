import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// The repo keeps one .env at the root and every other package reads it. Next
// only looks in the app directory, so without this `pnpm dev` starts an admin
// panel that cannot reach the database it is meant to inspect.
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

/**
 * Security headers.
 *
 * docs/10-security-privacy.md has listed these since Phase 0 and nothing was
 * sending them. This panel shows other people's dive data to staff, so the
 * frame-ancestors denial matters here more than anywhere: an admin session is
 * exactly what a clickjacking page would want to borrow.
 *
 * The CSP is deliberately strict because this app has no third-party scripts,
 * no analytics SDK and no embedded widgets — there is nothing to allowlist, so
 * the policy costs nothing to keep tight. `'unsafe-inline'` for styles is
 * Next's inline critical CSS; scripts do not get it.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The API is called from the server, never the browser, so the browser needs
  // to reach nothing but this origin.
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // A dive log URL can name a site, and a site names a place someone was.
  // Send the origin to other sites and never the path.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  // Only meaningful over HTTPS; harmless on localhost, where browsers ignore it.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const config: NextConfig = {
  reactStrictMode: true,
  // Standalone output ships a self-contained server directory, so the runtime
  // container does not need node_modules or a package manager.
  output: 'standalone',
  // The app lives inside a pnpm workspace; without this Next traces file
  // dependencies from the app directory and misses hoisted packages.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default config;
