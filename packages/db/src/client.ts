import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.ts';

export type { PrismaClient };

let singleton: PrismaClient | undefined;

/**
 * Prisma 7 requires a driver adapter rather than reading a connection string
 * from the schema. The adapter owns the connection pool, so pool sizing is now
 * ours to set rather than Prisma's to infer.
 */
export function createPrismaClient(connectionString?: string): PrismaClient {
  const url = connectionString ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

/**
 * Process-wide client. Next.js dev reloads modules on every edit, which would
 * otherwise open a new pool per reload until Postgres refuses connections.
 */
export function getPrismaClient(): PrismaClient {
  singleton ??= createPrismaClient();
  return singleton;
}
