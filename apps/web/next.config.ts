import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { MAX_UPLOAD_BYTES } from '@mydivelog/contracts';

// One .env at the repo root, which every other package already reads and Next
// does not look for.
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

/**
 * Security headers.
 *
 * docs/10-security-privacy.md has listed these since Phase 0 and nothing was
 * sending them. The privacy page makes claims about how this site behaves in a
 * browser; these are what make some of those claims true rather than intended.
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
  experimental: {
    /*
     * An import posts the file through a Server Action, and Next buffers the
     * whole body with a default limit of 1 MB. The API accepts 32 MB, so every
     * upload between the two failed inside Next before any of our code ran —
     * a blank "This page couldn't load" with the real reason only in the
     * server log. The real 96-dive Oceanic+ export is 4.4 MB, so this was
     * every dive computer export of any size.
     *
     * Matched to MAX_UPLOAD_BYTES rather than picked: two limits that disagree
     * is what caused this.
     */
    serverActions: { bodySizeLimit: MAX_UPLOAD_BYTES },
  },
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
