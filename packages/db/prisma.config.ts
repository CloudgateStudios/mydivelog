import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// A prisma.config.ts disables Prisma's own .env loading, so load the repo-root
// .env here. Without this, `pnpm db:migrate` fails on a fresh clone with an
// unhelpful "Environment variable not found".
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// `prisma generate` validates that the datasource env vars resolve, but does
// not connect. CI generates the client without a database, so give the CLI
// something syntactically valid to look at. Runtime never reads this file.
process.env.DATABASE_URL ??= 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
process.env.DIRECT_DATABASE_URL ??= process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',

  // Prisma 7 moved connection URLs out of the schema. This is only what the
  // CLI connects with — migrate, db push, studio. The application client uses
  // a driver adapter instead (src/client.ts).
  //
  // Prefer the direct URL: migrations take advisory locks and run DDL, neither
  // of which survives a connection pooler. Locally the two are the same.
  //
  // shadowDatabaseUrl is deliberately unset. It is a scratch database Prisma
  // creates to detect drift, not the direct connection — pointing it at the
  // real database fails with "the shadow database appears to be the same as
  // the main database".
  datasource: {
    url: (process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL) as string,
  },

  migrations: {
    seed: 'node --experimental-strip-types prisma/seed.ts',
  },
});
