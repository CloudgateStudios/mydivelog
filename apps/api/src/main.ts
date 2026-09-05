import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';

/**
 * Load the repo-root .env, the same way prisma.config.ts and vitest.config.ts
 * already do.
 *
 * `nest start` does not read one, so `pnpm dev` from a clean clone failed at
 * boot on a missing AUTH_ACCESS_SECRET even though .env.example sets it — the
 * runbook's three commands did not work, and the reason was invisible from the
 * error. A deployed image has no .env (it is gitignored and dockerignored), so
 * this is a no-op there and configuration still comes from the platform.
 */
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Everything lives under /v1. A new major version becomes a new prefix
  // rather than a breaking change to this one.
  app.setGlobalPrefix('v1', { exclude: ['health'] });

  // The web and admin apps are served from different hostnames, so the browser
  // treats every API call as cross-origin.
  const origins = (
    process.env['CORS_ORIGINS'] ??
    process.env['WEB_URL'] ??
    'http://localhost:53000'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'idempotent-replay', 'retry-after'],
  });

  // Fly routes to the container's port, so bind to all interfaces rather than
  // localhost — a loopback bind is reachable in dev and invisible in production.
  const port = Number(process.env['API_PORT'] ?? 53001);
  await app.listen(port, '0.0.0.0');

  console.log(`api listening on http://0.0.0.0:${port}`);
}

void bootstrap();
