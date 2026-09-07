import { createPrismaClient, type PrismaClient } from '@mydivelog/db';

/**
 * The admin panel reads the database directly.
 *
 * It is a staff tool behind Cloudflare Access, not a public surface, and
 * routing reads through the API would mean duplicating every one of them as an
 * endpoint only this app calls — the import inspector alone is a dozen.
 *
 * Every query here is read-only, and that is now load-bearing rather than
 * aspirational. Staff can change data — sites, tags, accounts, dives, imports —
 * and every one of those changes goes through `/v1/admin` in the API, because
 * that is where the change and its audit row are written by the same
 * transaction. See `lib/api.ts`.
 *
 * The split is not bureaucracy. `docs/11-roadmap.md` makes "every staff action
 * appears in the audit log" an acceptance criterion, and two applications
 * writing to the same tables is exactly how a criterion stays true in one of
 * them and quietly stops being true in the other. Reads have no such
 * requirement, which is why they stayed here.
 *
 * So: a `findMany` in this app is fine. An `update` is not, and
 * `db.write.test.ts` fails the build if one appears.
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
