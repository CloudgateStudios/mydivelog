import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

export default defineConfig({
  // Vitest transforms with esbuild, which does not implement
  // emitDecoratorMetadata. Without it Nest cannot read design:paramtypes and
  // injects undefined for every constructor dependency — the failure surfaces
  // as "Cannot read properties of undefined" deep inside a guard, not as
  // anything resembling a DI error. SWC emits the metadata.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // *.itest.ts needs a live database, so `pnpm test` excludes it.
    include: ['src/**/*.test.ts', 'src/**/*.itest.ts'],
    testTimeout: 60_000,
    pool: 'forks',
  },
});
