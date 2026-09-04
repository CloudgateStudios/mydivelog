import { PrismaClient } from './generated/client.ts';

export type { PrismaClient };

let singleton: PrismaClient | undefined;

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

/**
 * Process-wide client. Next.js dev reloads modules on every edit, which would
 * otherwise open a new pool per reload until Postgres refuses connections.
 */
export function getPrismaClient(): PrismaClient {
  singleton ??= createPrismaClient();
  return singleton;
}
