import { createPrismaClient, type PrismaClient } from '@mydivelog/db';

/**
 * The admin panel reads the database directly.
 *
 * It is a staff tool behind Cloudflare Access, not a public surface, and going
 * through the API would mean minting staff tokens and duplicating every read
 * as an endpoint only this app calls.
 *
 * Every query here is read-only. Anything that changes a diver's data belongs
 * in the API, where it is scoped, audited and rate-limited.
 */

declare global {
  var __adminPrisma: PrismaClient | undefined;
}

/**
 * Constructed on first use, not on import.
 *
 * Next evaluates modules during the build, and a client built at import time
 * makes `next build` need a reachable database — which it did, until this
 * became a Proxy. Next reloads modules on every edit in development too, so
 * the instance is cached globally or each reload opens another pool until
 * Postgres refuses connections.
 */
function client(): PrismaClient {
  globalThis.__adminPrisma ??= createPrismaClient();
  return globalThis.__adminPrisma;
}

export const db = new Proxy({} as PrismaClient, {
  get: (_target, property) => Reflect.get(client(), property) as unknown,
});

export { DIVE_SELECT, WITHHELD_FIELD_PATHS, redactProvenanceValue } from './privacy';
