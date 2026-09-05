import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// The repo keeps one .env at the root and every other package reads it. Next
// only looks in the app directory, so without this `pnpm dev` starts an admin
// panel that cannot reach the database it is meant to inspect.
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const config: NextConfig = {
  reactStrictMode: true,
  // Standalone output ships a self-contained server directory, so the runtime
  // container does not need node_modules or a package manager.
  output: 'standalone',
  // The app lives inside a pnpm workspace; without this Next traces file
  // dependencies from the app directory and misses hoisted packages.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default config;
