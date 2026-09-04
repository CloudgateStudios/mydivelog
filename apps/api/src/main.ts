import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';

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
