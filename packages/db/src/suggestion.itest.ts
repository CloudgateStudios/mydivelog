/**
 * Suggested site names, against a real database.
 *
 *   pnpm services:up && pnpm --filter @mydivelog/db test:integration
 *
 * Integration rather than unit tests because the whole point of `decide` is
 * what lands together: the rename, the alias, the other divers' pending
 * suggestions and the audit row share one transaction, and a fake would only
 * prove that my idea of a transaction is self-consistent.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.ts';
import { createAdminRepository } from './repositories/admin.repository.ts';
import { UNNAMED_SITE } from './repositories/import.repository.ts';
import {
  createSuggestionRepository,
  SuggestionRefusal,
} from './repositories/suggestion.repository.ts';
import { staffScope, userScope, type UserScope } from './scope.ts';

const prisma = createPrismaClient();
const repo = createSuggestionRepository(prisma);
const admin = createAdminRepository(prisma);

let diverId: string;
let diver: UserScope;
let staffId: string;

const user = async (): Promise<string> => {
  const id = randomUUID();
  await prisma.user.create({ data: { id, email: `itest-${id}@mydivelog.invalid` } });
  return id;
};

const site = async (name: string, isPublic = true): Promise<string> => {
  const id = randomUUID();
  await prisma.site.create({
    data: {
      id,
      name,
      isPublic,
      ...(isPublic ? {} : { ownerUserId: diverId }),
    },
  });
  return id;
};

/** A dive is the evidence that someone has actually been to a place. */
let diveNumber = 0;
const dive = async (userId: string, siteId: string): Promise<string> => {
  const id = randomUUID();
  diveNumber += 1;
  await prisma.dive.create({
    data: {
      id,
      userId,
      siteId,
      diveNumber,
      startTimeLocal: new Date('2026-04-02T10:00:00Z'),
      startTimeUtc: new Date('2026-04-02T14:00:00Z'),
      tzOffsetMinutes: -240,
    },
  });
  return id;
};

const decide = (suggestionId: string, outcome: 'approved' | 'rejected', note?: string) =>
  repo.decide(staffScope(staffId, 'itest'), suggestionId, outcome, note, admin.writeAuditIn);

beforeEach(async () => {
  diverId = await user();
  diver = userScope(diverId);
  staffId = await user();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('suggest', () => {
  it('records a proposal from a diver who has been there', async () => {
    const s = await site('Blue Heron Bridge');
    await dive(diverId, s);

    const created = await repo.suggest(diver, s, 'Blue Heron Bridge, east side', 'Two sites here.');
    expect(created?.status).toBe('pending');
    expect(created?.reason).toBe('Two sites here.');
  });

  it('refuses a diver who has never dived the site', async () => {
    const s = await site('Blue Heron Bridge');
    await expect(repo.suggest(diver, s, 'Somewhere else')).rejects.toThrow(SuggestionRefusal);
  });

  it('refuses a private site, which its owner edits directly', async () => {
    const s = await site('My secret spot', false);
    await dive(diverId, s);
    await expect(repo.suggest(diver, s, 'A better name')).rejects.toMatchObject({
      code: 'site_not_shared',
    });
  });

  it('refuses a name the site already has, whatever the case and spacing', async () => {
    const s = await site('Blue Heron Bridge');
    await dive(diverId, s);
    // Compared by slug, the same way the importer decides two rows name one
    // place — so a diver cannot fill the queue with recapitalisations.
    await expect(repo.suggest(diver, s, '  blue   heron bridge ')).rejects.toMatchObject({
      code: 'already_named_that',
    });
  });

  it('allows one open suggestion per diver, so the queue is readable', async () => {
    const s = await site('Blue Heron Bridge');
    await dive(diverId, s);
    await repo.suggest(diver, s, 'First idea');
    await expect(repo.suggest(diver, s, 'Second idea')).rejects.toMatchObject({
      code: 'already_suggested',
    });
  });

  it('returns null for a site that does not exist, so the API can 404', async () => {
    expect(await repo.suggest(diver, randomUUID(), 'Anything')).toBeNull();
  });
});

describe('pending', () => {
  it('tells the moderator how many dives the suggester has logged there', async () => {
    const s = await site('Blue Heron Bridge');
    await dive(diverId, s);
    await dive(diverId, s);
    await repo.suggest(diver, s, 'Phil Foster Park');

    const queue = await repo.pending();
    const row = queue.find((r) => r.siteId === s);
    expect(row?.diverDives).toBe(2);
    expect(row?.site.name).toBe('Blue Heron Bridge');
  });
});

describe('decide', () => {
  it('renames the site and keeps the old name findable', async () => {
    const s = await site('Vista Blue');
    await dive(diverId, s);
    const created = await repo.suggest(diver, s, 'Vista Azul');

    const result = await decide(created!.id, 'approved');
    expect(result?.outcome).toBe('approved');

    const after = await prisma.site.findUniqueOrThrow({ where: { id: s } });
    expect(after.name).toBe('Vista Azul');
    const aliases = await prisma.siteAlias.findMany({ where: { siteId: s } });
    // So a re-import of an older file still lands on this site rather than
    // making a second one beside it.
    expect(aliases.map((a) => a.name)).toContain('Vista Blue');
  });

  it('does not keep the placeholder as an alias', async () => {
    const s = await site(UNNAMED_SITE);
    await dive(diverId, s);
    const created = await repo.suggest(diver, s, 'Vista Blue');

    await decide(created!.id, 'approved');

    const aliases = await prisma.siteAlias.findMany({ where: { siteId: s } });
    // `Unnamed site` as an alias would match every coordinates-only site a
    // dive computer ever produced, and merge places that are not the same.
    expect(aliases.map((a) => a.name)).not.toContain(UNNAMED_SITE);
  });

  it('drops an alias the site has just been renamed to', async () => {
    const s = await site('Vista Blue');
    await prisma.siteAlias.create({
      data: { id: randomUUID(), siteId: s, name: 'Vista Azul', source: 'import' },
    });
    await dive(diverId, s);
    const created = await repo.suggest(diver, s, 'Vista Azul');

    await decide(created!.id, 'approved');

    const aliases = await prisma.siteAlias.findMany({ where: { siteId: s } });
    // The name is the name now; an alias equal to it is a duplicate row that
    // would make the site page say "also recorded as" its own name.
    expect(aliases.map((a) => a.name)).toEqual(['Vista Blue']);
  });

  it('answers everyone else waiting on the same site', async () => {
    const s = await site('Vista Blue');
    const otherId = await user();
    await dive(diverId, s);
    await dive(otherId, s);
    const mine = await repo.suggest(diver, s, 'Vista Azul');
    const theirs = await repo.suggest(userScope(otherId), s, 'Blue View');

    await decide(mine!.id, 'approved');

    const after = await prisma.siteNameSuggestion.findUniqueOrThrow({ where: { id: theirs!.id } });
    // Left pending it would later be decided against a name that has moved.
    expect(after.status).toBe('rejected');
    expect(after.decisionNote).toContain('Vista Azul');
  });

  it('keeps the name on a rejection and records why', async () => {
    const s = await site('Vista Blue');
    await dive(diverId, s);
    const created = await repo.suggest(diver, s, 'Bobs Reef');

    const result = await decide(
      created!.id,
      'rejected',
      'That is the name of the mooring, not the site.',
    );
    expect(result?.outcome).toBe('rejected');

    const after = await prisma.site.findUniqueOrThrow({ where: { id: s } });
    expect(after.name).toBe('Vista Blue');
    const row = await prisma.siteNameSuggestion.findUniqueOrThrow({ where: { id: created!.id } });
    // The durable record of the answer. The email can fail; this cannot.
    expect(row.status).toBe('rejected');
    expect(row.decisionNote).toContain('mooring');
  });

  it('writes an audit row in the same transaction as the rename', async () => {
    const s = await site('Vista Blue');
    await dive(diverId, s);
    const created = await repo.suggest(diver, s, 'Vista Azul');

    await decide(created!.id, 'approved');

    const events = await prisma.auditEvent.findMany({ where: { entityId: s } });
    expect(events.map((e) => e.action)).toContain('site.name.approved');
  });

  it('refuses to decide the same suggestion twice', async () => {
    const s = await site('Vista Blue');
    await dive(diverId, s);
    const created = await repo.suggest(diver, s, 'Vista Azul');
    await decide(created!.id, 'approved');

    await expect(decide(created!.id, 'rejected', 'Changed my mind')).rejects.toMatchObject({
      code: 'already_decided',
    });
  });

  it('leaves nothing behind when the transaction refuses', async () => {
    const s = await site('Vista Blue');
    await dive(diverId, s);
    const created = await repo.suggest(diver, s, 'Vista Azul');
    await decide(created!.id, 'approved');
    const auditBefore = await prisma.auditEvent.count({ where: { entityId: s } });

    await expect(decide(created!.id, 'approved')).rejects.toThrow(SuggestionRefusal);

    expect(await prisma.auditEvent.count({ where: { entityId: s } })).toBe(auditBefore);
  });

  it('returns null for a suggestion that does not exist', async () => {
    expect(await decide(randomUUID(), 'approved')).toBeNull();
  });
});
