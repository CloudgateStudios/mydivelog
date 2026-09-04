import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Fly routes to the container's port, so bind to all interfaces rather than
  // localhost — a loopback bind is reachable in dev and invisible in production.
  const port = Number(process.env['API_PORT'] ?? 53001);
  await app.listen(port, '0.0.0.0');

  console.log(`api listening on http://0.0.0.0:${port}`);
}

void bootstrap();
