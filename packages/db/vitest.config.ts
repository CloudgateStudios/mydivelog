import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Integration tests connect to the local stack, so load the repo-root .env
// here rather than relying on the caller having sourced it.
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

export default defineConfig({
  test: {
    // *.itest.ts needs a live database, so `pnpm test` excludes it and
    // `pnpm test:integration` opts in. Unit tests stay runnable with nothing up.
    include: ['src/**/*.test.ts', 'src/**/*.itest.ts'],
    testTimeout: 30_000,
    env: {
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      ...(process.env.DIRECT_DATABASE_URL
        ? { DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL }
        : {}),
    },
  },
});
