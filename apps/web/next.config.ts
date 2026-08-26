import type { NextConfig } from 'next';

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
