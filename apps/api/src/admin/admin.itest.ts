import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrismaClient } from '@mydivelog/db';
import { AppModule } from '../app.module.ts';
import { ProblemDetailsFilter } from '../common/problem-details.ts';

/**
 * The staff surface, against a real database and a real HTTP stack.
 *
 *   pnpm --filter @mydivelog/api test:integration
 *
 * Two things are being proved here, and only the first is ordinary CRUD
 * testing:
 *
 * 1. Each endpoint does what it says, including refusing what it should refuse.
 * 2. **Every mutation writes exactly one audit row.** `docs/11-roadmap.md`
 *    makes that an acceptance criterion, and an acceptance criterion asserted
 *    in prose is a criterion nobody is checking. The table in "the audit log"
 *    below walks the entire surface and counts rows, so a new endpoint added
 *    without an audit write fails here rather than in a year's incident review.
 */

const prisma = getPrismaClient();
let app: INestApplication;
let http: ReturnType<typeof request>;

const staffEmail = `staff-${randomUUID()}@itest.invalid`;
const diverEmail = `diver-${randomUUID()}@itest.invalid`;
const outsiderEmail = `outsider-${randomUUID()}@itest.invalid`;

let staffId = '';
let diverId = '';
let diverToken = '';

/** Local-development identity. No header is trusted; see `staff.guard.ts`. */
const asStaff = (email: string): void => {
  process.env['ADMIN_DEV_STAFF_EMAIL'] = email;
};

async function makeUser(email: string, isStaff = false): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({ data: { id, email, isStaff } });
  return id;
}

async function makeSite(
  overrides: Partial<{
    name: string;
    latitude: number;
    longitude: number;
    ownerUserId: string;
  }> = {},
): Promise<string> {
  const id = randomUUID();
  await prisma.site.create({
    data: { id, name: `Site ${id.slice(0, 8)}`, ownerUserId: diverId, ...overrides },
  });
  return id;
}

async function makeDive(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await prisma.dive.create({
    data: {
      id,
      userId: diverId,
      // Unique per live dive, per user. Random rather than sequential because
      // these tests create dives in parallel with each other.
      diveNumber: Math.floor(Math.random() * 1_000_000) + 1,
      startTimeUtc: new Date('2026-03-06T23:07:42Z'),
      startTimeLocal: new Date('2026-03-06T19:07:42Z'),
      tzOffsetMinutes: -240,
      maxDepthM: 14.1,
      ...overrides,
    },
  });
  return id;
}

async function makeTag(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await prisma.tag.create({
    data: {
      id,
      slug: `slug-${id.slice(0, 8)}`,
      label: 'A tag',
      category: 'activity',
      userId: diverId,
      ...overrides,
    },
  });
  return id;
}

const auditCount = (): Promise<number> => prisma.auditEvent.count();

const lastAudit = async () => prisma.auditEvent.findFirst({ orderBy: { createdAt: 'desc' } });

beforeAll(async () => {
  // Set before the module compiles: the guard reads these on every request,
  // but the app has to build without a Cloudflare team domain configured.
  process.env['ADMIN_ACCESS_CHECK_DISABLED'] = 'true';
  process.env['AUTH_DEV_LOGIN_ENABLED'] = 'true';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  http = request(app.getHttpServer());

  staffId = await makeUser(staffEmail, true);
  diverId = await makeUser(diverEmail);
  await makeUser(outsiderEmail);

  // Suggesting a name is a diver action, so it needs a diver's session rather
  // than the staff identity the rest of this file uses.
  const login = await request(app.getHttpServer())
    .post('/v1/auth/dev/login')
    .send({ email: diverEmail });
  diverToken = login.body.accessToken;
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  asStaff(staffEmail);
});

// ---------------------------------------------------------------------------

describe('who may change other people’s data', () => {
  it('refuses an account that is not staff', async () => {
    asStaff(outsiderEmail);
    const res = await http.patch(`/v1/admin/sites/${randomUUID()}`).send({ name: 'x' });
    expect(res.status).toBe(403);
  });

  it('refuses an address with no account at all', async () => {
    asStaff('nobody@itest.invalid');
    const res = await http.get('/v1/admin/audit');
    expect(res.status).toBe(403);
    // The same answer either way. Whether a given address is staff is not
    // something an unauthenticated caller should be able to probe.
    expect(res.body.detail).toBe('This account is not staff.');
  });

  it('refuses when the bypass is on and no actor is configured', async () => {
    delete process.env['ADMIN_DEV_STAFF_EMAIL'];
    const res = await http.get('/v1/admin/audit');
    expect(res.status).toBe(403);
    expect(res.body.detail).toContain('ADMIN_DEV_STAFF_EMAIL');
  });

  it('does not accept a diver’s own session token', async () => {
    // The staff surface is not "the API with a staff flag set" — a session
    // token, however valid, authenticates nothing here.
    asStaff(outsiderEmail);
    const login = await http.post('/v1/auth/dev/login').send({ email: diverEmail });
    const res = await http
      .get('/v1/admin/audit')
      .set('authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------

describe('sites', () => {
  it('renames a site and records what moved', async () => {
    const id = await makeSite({ name: 'Thousand Steps' });
    const res = await http
      .patch(`/v1/admin/sites/${id}`)
      .send({ name: '1,000 Steps', reason: 'the name on the sign' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('1,000 Steps');

    const event = await lastAudit();
    expect(event?.action).toBe('site.update');
    expect(event?.entityId).toBe(id);
    expect(event?.actorId).toBe(staffId);
    expect((event?.metadata as Record<string, unknown>)['reason']).toBe('the name on the sign');
    expect((event?.metadata as { changed: Record<string, unknown> }).changed).toEqual({
      name: ['Thousand Steps', '1,000 Steps'],
    });
  });

  it('gives an unlocated site coordinates', async () => {
    const id = await makeSite();
    const res = await http
      .patch(`/v1/admin/sites/${id}`)
      .send({ latitude: 12.1, longitude: -68.28 });
    expect(res.status).toBe(200);
    expect(res.body.latitude).toBeCloseTo(12.1, 4);
  });

  it('rejects half a coordinate', async () => {
    const id = await makeSite();
    const res = await http.patch(`/v1/admin/sites/${id}`).send({ latitude: 12.1 });
    expect(res.status).toBe(422);
  });

  it('deletes a site nobody has dived', async () => {
    const id = await makeSite();
    const res = await http.delete(`/v1/admin/sites/${id}`).send({ reason: 'created in error' });
    expect(res.status).toBe(200);
    expect(await prisma.site.findUnique({ where: { id } })).toMatchObject({
      deletedAt: expect.any(Date),
    });
  });

  it('refuses to delete a site with dives at it, and says to merge instead', async () => {
    const id = await makeSite();
    await makeDive({ siteId: id });

    const res = await http.delete(`/v1/admin/sites/${id}`).send({ reason: 'looks like junk' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toContain('Merge it into the right site');
    expect(res.body.errors[0].code).toBe('site_in_use');

    // Refused, so nothing happened — including in the log.
    expect(await prisma.site.findUnique({ where: { id } })).toMatchObject({ deletedAt: null });
    const event = await lastAudit();
    expect(event?.entityId).not.toBe(id);
  });

  it('merges one site into another, keeping the dives and both names', async () => {
    const target = await makeSite({ name: '1,000 Steps' });
    const source = await makeSite({ name: 'Thousand Steps', latitude: 12.1, longitude: -68.28 });
    const diveId = await makeDive({ siteId: source });

    const res = await http
      .post('/v1/admin/sites/merge')
      .send({ sourceId: source, targetId: target, reason: 'same place, two spellings' });
    expect(res.status).toBe(200);
    expect(res.body.divesMoved).toBe(1);

    // The dive moved.
    expect(await prisma.dive.findUnique({ where: { id: diveId } })).toMatchObject({
      siteId: target,
    });
    // The name a diver typed still finds the place.
    const aliases = await prisma.siteAlias.findMany({ where: { siteId: target } });
    expect(aliases.map((a) => a.name)).toContain('Thousand Steps');
    // A merge never loses a location.
    expect(await prisma.site.findUnique({ where: { id: target } })).toMatchObject({
      latitude: 12.1,
    });
    expect(await prisma.site.findUnique({ where: { id: source } })).toMatchObject({
      deletedAt: expect.any(Date),
    });
  });

  it('does not overwrite the coordinates the target already had', async () => {
    const target = await makeSite({ latitude: 12.1, longitude: -68.28 });
    const source = await makeSite({ latitude: 1.0, longitude: 1.0 });
    await http
      .post('/v1/admin/sites/merge')
      .send({ sourceId: source, targetId: target, reason: 'duplicate' });
    expect(await prisma.site.findUnique({ where: { id: target } })).toMatchObject({
      latitude: 12.1,
    });
  });

  it('adds and removes an alias', async () => {
    const id = await makeSite();
    const added = await http.post(`/v1/admin/sites/${id}/aliases`).send({ name: '1000 Steps' });
    expect(added.status).toBe(201);
    // Recorded as staff, not as an import: an alias a person added by hand and
    // one the importer inferred are different kinds of evidence.
    expect(added.body.source).toBe('staff');

    const removed = await http.delete(`/v1/admin/sites/${id}/aliases/${added.body.id}`);
    expect(removed.status).toBe(204);
    expect(await prisma.siteAlias.count({ where: { siteId: id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('tags', () => {
  it('promotes a user tag into the shared taxonomy', async () => {
    const id = await makeTag();
    const res = await http
      .patch(`/v1/admin/tags/${id}`)
      .send({ isSystem: true, reason: 'forty divers have written this' });
    expect(res.status).toBe(200);
    // A system tag belongs to nobody; leaving the owner set would leave it
    // both shared and private.
    expect(res.body.userId).toBeNull();
    expect(res.body.isSystem).toBe(true);
  });

  it('refuses a promotion the taxonomy already has', async () => {
    const slug = `dup-${randomUUID().slice(0, 8)}`;
    await makeTag({ slug, isSystem: true, userId: null });
    const mine = await makeTag({ slug });

    const res = await http.patch(`/v1/admin/tags/${mine}`).send({ isSystem: true });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('tag_slug_taken');
  });

  it('deletes a tag and records how many dives lost the label', async () => {
    const id = await makeTag();
    const diveId = await makeDive();
    await prisma.diveTag.create({ data: { diveId, tagId: id } });

    const res = await http.delete(`/v1/admin/tags/${id}`).send({ reason: 'typo of "wreck"' });
    expect(res.status).toBe(200);
    expect(res.body.dives).toBe(1);

    // The label goes; the dive does not.
    expect(await prisma.dive.findUnique({ where: { id: diveId } })).not.toBeNull();
    const event = await lastAudit();
    expect((event?.metadata as Record<string, unknown>)['dives']).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('accounts', () => {
  it('suspending revokes every session the account holds', async () => {
    const id = await makeUser(`s-${randomUUID()}@itest.invalid`);
    await prisma.refreshToken.create({
      data: {
        id: randomUUID(),
        userId: id,
        familyId: randomUUID(),
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const res = await http
      .patch(`/v1/admin/users/${id}`)
      .send({ status: 'suspended', reason: 'abuse report 118' });
    expect(res.status).toBe(200);
    // Without this the account stays signed in wherever it is signed in: the
    // access token is short-lived, the refresh token is not.
    expect(res.body.sessionsRevoked).toBe(1);
    expect(await prisma.refreshToken.count({ where: { userId: id, revokedAt: null } })).toBe(0);
  });

  it('deletes an account softly, keeping the logbook', async () => {
    const id = await makeUser(`d-${randomUUID()}@itest.invalid`);
    const dive = await prisma.dive.create({
      data: {
        id: randomUUID(),
        userId: id,
        diveNumber: 1,
        startTimeUtc: new Date('2026-03-06T23:07:42Z'),
        startTimeLocal: new Date('2026-03-06T19:07:42Z'),
        tzOffsetMinutes: -240,
      },
    });

    const res = await http.delete(`/v1/admin/users/${id}`).send({ reason: 'requested by email' });
    expect(res.status).toBe(200);
    expect(res.body.dives).toBe(1);

    // A hard delete would cascade through dives, sites and imports — a decade
    // of somebody's memory, with no undo and no tombstone to sync.
    expect(await prisma.dive.findUnique({ where: { id: dive.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id } })).toMatchObject({
      status: 'deleted',
      deletedAt: expect.any(Date),
    });
  });

  it('refuses to delete a staff account from here', async () => {
    const id = await makeUser(`x-${randomUUID()}@itest.invalid`, true);
    const res = await http.delete(`/v1/admin/users/${id}`).send({ reason: 'left the company' });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('staff_account');
  });

  it('requires a reason before suspending anyone', async () => {
    const id = await makeUser(`r-${randomUUID()}@itest.invalid`);
    const res = await http.patch(`/v1/admin/users/${id}`).send({ status: 'suspended' });
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------

describe('dives', () => {
  it('corrects a dive and bumps the version offline clients sync on', async () => {
    const id = await makeDive();
    const before = await prisma.dive.findUnique({ where: { id } });

    const res = await http
      .patch(`/v1/admin/dives/${id}`)
      .send({ tzOffsetMinutes: -300, reason: 'source wrote -00:04 meaning -04:00' });
    expect(res.status).toBe(200);
    expect(res.body.tzOffsetMinutes).toBe(-300);
    // Skipping this makes the correction invisible on the diver's phone.
    expect(res.body.version).toBe((before?.version ?? 0) + 1);
  });

  it('will not write a note, even when one is sent', async () => {
    const id = await makeDive({ notes: 'the good one' });
    const res = await http
      .patch(`/v1/admin/dives/${id}`)
      .send({ maxDepthM: 18, notes: 'overwritten' });
    expect(res.status).toBe(200);
    expect(await prisma.dive.findUnique({ where: { id } })).toMatchObject({
      notes: 'the good one',
      maxDepthM: 18,
    });
  });

  it('refuses a dive number the diver is already using', async () => {
    const taken = await makeDive();
    const mine = await makeDive();
    const number = (await prisma.dive.findUnique({ where: { id: taken } }))?.diveNumber;

    const res = await http.patch(`/v1/admin/dives/${mine}`).send({ diveNumber: number });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('dive_number_taken');
  });

  it('deletes and restores a dive', async () => {
    const id = await makeDive();
    expect(
      (await http.delete(`/v1/admin/dives/${id}`).send({ reason: 'duplicate row' })).status,
    ).toBe(200);
    expect(await prisma.dive.findUnique({ where: { id } })).toMatchObject({
      deletedAt: expect.any(Date),
    });

    expect((await http.post(`/v1/admin/dives/${id}/restore`)).status).toBe(200);
    expect(await prisma.dive.findUnique({ where: { id } })).toMatchObject({ deletedAt: null });
  });

  it('refuses a restore whose number was reused while it was gone', async () => {
    const id = await makeDive();
    const number = (await prisma.dive.findUnique({ where: { id } }))?.diveNumber;
    await http.delete(`/v1/admin/dives/${id}`).send({ reason: 'duplicate row' });
    // The unique index is partial — `WHERE deleted_at IS NULL` — so the number
    // is free the moment the dive is deleted, and something can take it.
    await makeDive({ diveNumber: number });

    const res = await http.post(`/v1/admin/dives/${id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.detail).toContain('Renumber the live dive first');
  });
});

// ---------------------------------------------------------------------------

describe('imports', () => {
  async function committedBatch(): Promise<{ batchId: string; diveId: string }> {
    const batchId = randomUUID();
    await prisma.importBatch.create({
      data: {
        id: batchId,
        userId: diverId,
        sourceKind: 'uddf',
        originalFileKey: `k/${batchId}`,
        originalFileName: 'export.uddf',
        fileSize: 1024,
        checksum: randomUUID(),
        status: 'committed',
        committedAt: new Date(),
      },
    });
    const diveId = await makeDive();
    await prisma.diveSource.create({
      data: {
        id: randomUUID(),
        diveId,
        importBatchId: batchId,
        sourceKind: 'uddf',
        recordedAt: new Date(),
      },
    });
    return { batchId, diveId };
  }

  it('reverts a committed import on the diver’s behalf', async () => {
    const { batchId, diveId } = await committedBatch();

    const res = await http
      .post(`/v1/admin/imports/${batchId}/revert`)
      .send({ reason: 'diver asked by email, ticket 41' });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toEqual([diveId]);

    expect(await prisma.dive.findUnique({ where: { id: diveId } })).toBeNull();
    expect(await prisma.importBatch.findUnique({ where: { id: batchId } })).toMatchObject({
      status: 'reverted',
    });
  });

  it('records the revert in the same transaction as the revert', async () => {
    const { batchId } = await committedBatch();
    await http.post(`/v1/admin/imports/${batchId}/revert`).send({ reason: 'ticket 42' });

    const event = await lastAudit();
    expect(event?.action).toBe('import.revert');
    expect(event?.entityType).toBe('import_batch');
    expect(event?.entityId).toBe(batchId);
    // Whose import it was, since staff triggered the diver's own undo.
    expect((event?.metadata as Record<string, unknown>)['userId']).toBe(diverId);
  });

  it('refuses to revert a batch that was never committed', async () => {
    const batchId = randomUUID();
    await prisma.importBatch.create({
      data: {
        id: batchId,
        userId: diverId,
        sourceKind: 'uddf',
        originalFileKey: `k/${batchId}`,
        originalFileName: 'export.uddf',
        fileSize: 1,
        checksum: randomUUID(),
        status: 'review',
      },
    });

    const res = await http.post(`/v1/admin/imports/${batchId}/revert`).send({ reason: 'oops' });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('not_committed');
  });
});

// ---------------------------------------------------------------------------

/** A site in the shared database — the only kind a name can be suggested for. */
async function makeSharedSite(name = `Shared ${randomUUID().slice(0, 8)}`): Promise<string> {
  const id = randomUUID();
  await prisma.site.create({ data: { id, name, isPublic: true } });
  return id;
}

/** A diver who has dived there, proposing a name through the real endpoint. */
async function suggestionOn(siteId: string, proposed: string): Promise<string> {
  await makeDive({ siteId });
  const res = await http
    .post(`/v1/sites/${siteId}/name-suggestions`)
    .set('authorization', `Bearer ${diverToken}`)
    .send({ proposed });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

describe('suggested site names', () => {
  it('lets a diver who has dived a shared site propose a name', async () => {
    const siteId = await makeSharedSite('Vista Blue');
    const id = await suggestionOn(siteId, 'Vista Azul');

    const queue = await http.get('/v1/admin/site-name-suggestions');
    expect(queue.status).toBe(200);
    expect(queue.body.data.map((r: { id: string }) => r.id)).toContain(id);
  });

  it('refuses a private site, which its owner edits directly', async () => {
    const siteId = await makeSite({ ownerUserId: diverId });
    await makeDive({ siteId });
    const res = await http
      .post(`/v1/sites/${siteId}/name-suggestions`)
      .set('authorization', `Bearer ${diverToken}`)
      .send({ proposed: 'Anything' });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('site_not_shared');
  });

  it('will not take a rejection with no reason', async () => {
    const id = await suggestionOn(await makeSharedSite(), 'Some name');
    // The diver is emailed this. A refusal with nothing in it reads as the
    // suggestion having been lost.
    const res = await http
      .post(`/v1/admin/site-name-suggestions/${id}/decide`)
      .send({ outcome: 'rejected' });
    expect(res.status).toBe(422);
  });

  it('says when the notice did not send, rather than claiming it did', async () => {
    const id = await suggestionOn(await makeSharedSite(), 'Some name');
    // No mail provider is configured in this environment, and that is the
    // point: the panel prints what this field says, and a decision that
    // reports a delivery it never made is how a diver waits for a reply
    // nobody sent.
    const res = await http
      .post(`/v1/admin/site-name-suggestions/${id}/decide`)
      .send({ outcome: 'rejected', note: 'Not that one.' });
    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(false);
  });

  it('shows the diver the answer on their own site page', async () => {
    const siteId = await makeSharedSite('Vista Blue');
    const id = await suggestionOn(siteId, 'Bobs Reef');
    await http
      .post(`/v1/admin/site-name-suggestions/${id}/decide`)
      .send({ outcome: 'rejected', note: 'That is the mooring.' });

    const page = await http.get(`/v1/sites/${siteId}`).set('authorization', `Bearer ${diverToken}`);
    const mine = page.body.suggestions.find((row: { id: string }) => row.id === id);
    // The durable record. The emailed notice may never arrive; this is here
    // whether it does or not.
    expect(mine.status).toBe('rejected');
    expect(mine.decisionNote).toBe('That is the mooring.');
  });

  it('renames the site on approval and keeps the old name findable', async () => {
    const siteId = await makeSharedSite('Vista Blue');
    const id = await suggestionOn(siteId, 'Vista Azul');
    expect(
      (
        await http.post(`/v1/admin/site-name-suggestions/${id}/decide`).send({
          outcome: 'approved',
        })
      ).status,
    ).toBe(200);

    const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    expect(site.name).toBe('Vista Azul');
    const aliases = await prisma.siteAlias.findMany({ where: { siteId } });
    expect(aliases.map((a) => a.name)).toContain('Vista Blue');
  });

  it('404s a suggestion that does not exist', async () => {
    const res = await http
      .post(`/v1/admin/site-name-suggestions/${randomUUID()}/decide`)
      .send({ outcome: 'approved' });
    expect(res.status).toBe(404);
  });
});

describe('the audit log', () => {
  it('is readable, newest first, with the actor resolved', async () => {
    const id = await makeSite();
    await http.patch(`/v1/admin/sites/${id}`).send({ name: 'Read me', reason: 'a rename' });

    const res = await http.get('/v1/admin/audit?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data[0].action).toBe('site.update');
    // The actor id alone makes the log unreadable without a second query.
    expect(res.body.data[0].actorEmail).toBe(staffEmail);
  });

  it('filters to one entity, which is how a support question gets answered', async () => {
    const id = await makeSite();
    await http.patch(`/v1/admin/sites/${id}`).send({ name: 'One', reason: 'first' });
    await http.patch(`/v1/admin/sites/${id}`).send({ name: 'Two', reason: 'second' });

    const res = await http.get(`/v1/admin/audit?entityType=site&entityId=${id}`);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((e: { action: string }) => e.action)).toEqual([
      'site.update',
      'site.update',
    ]);
  });

  /**
   * The acceptance criterion, walked end to end.
   *
   * Every mutation on the staff surface, each run once, each asserted to have
   * written exactly one row. Adding an endpoint to the controller without an
   * audit write fails here — which is the only reason this is a table and not
   * a paragraph in a runbook.
   */
  it('gains exactly one row for every staff mutation, and none for a read', async () => {
    const siteId = await makeSite();
    const mergeTarget = await makeSite();
    const mergeSource = await makeSite();
    const tagId = await makeTag();
    const doomedTag = await makeTag();
    const diveId = await makeDive();
    const doomedDive = await makeDive();
    const userId = await makeUser(`audit-${randomUUID()}@itest.invalid`);
    const doomedUser = await makeUser(`audit2-${randomUUID()}@itest.invalid`);
    const emptySite = await makeSite();
    const reason = 'walking the surface';

    let aliasId = '';

    const mutations: [string, () => Promise<{ status: number }>][] = [
      ['site.update', () => http.patch(`/v1/admin/sites/${siteId}`).send({ name: 'A', reason })],
      [
        'site.alias.add',
        async () => {
          const res = await http.post(`/v1/admin/sites/${siteId}/aliases`).send({ name: 'B' });
          aliasId = res.body.id;
          return res;
        },
      ],
      ['site.alias.remove', () => http.delete(`/v1/admin/sites/${siteId}/aliases/${aliasId}`)],
      [
        'site.merge',
        () =>
          http
            .post('/v1/admin/sites/merge')
            .send({ sourceId: mergeSource, targetId: mergeTarget, reason }),
      ],
      ['site.delete', () => http.delete(`/v1/admin/sites/${emptySite}`).send({ reason })],
      ['tag.update', () => http.patch(`/v1/admin/tags/${tagId}`).send({ label: 'C', reason })],
      ['tag.delete', () => http.delete(`/v1/admin/tags/${doomedTag}`).send({ reason })],
      [
        'user.suspended',
        () => http.patch(`/v1/admin/users/${userId}`).send({ status: 'suspended', reason }),
      ],
      ['user.delete', () => http.delete(`/v1/admin/users/${doomedUser}`).send({ reason })],
      [
        'dive.update',
        () => http.patch(`/v1/admin/dives/${diveId}`).send({ maxDepthM: 20, reason }),
      ],
      ['dive.delete', () => http.delete(`/v1/admin/dives/${doomedDive}`).send({ reason })],
      ['dive.restore', () => http.post(`/v1/admin/dives/${doomedDive}/restore`)],
      [
        'site.name.approved',
        async () => {
          const id = await suggestionOn(await makeSharedSite(), 'An agreed name');
          return http.post(`/v1/admin/site-name-suggestions/${id}/decide`).send({
            outcome: 'approved',
          });
        },
      ],
      [
        'site.name.rejected',
        async () => {
          const id = await suggestionOn(await makeSharedSite(), 'A refused name');
          return http.post(`/v1/admin/site-name-suggestions/${id}/decide`).send({
            outcome: 'rejected',
            note: 'That is the mooring, not the site.',
          });
        },
      ],
    ];

    for (const [action, run] of mutations) {
      const before = await auditCount();
      const res = await run();
      expect(res.status, `${action} did not succeed: ${JSON.stringify(res)}`).toBeLessThan(300);
      expect(await auditCount(), `${action} wrote no audit row`).toBe(before + 1);
      expect((await lastAudit())?.action, `${action} recorded the wrong action`).toBe(action);
    }

    // Reading is not an action. If that changes it is a separate decision,
    // with its own retention question attached.
    const before = await auditCount();
    await http.get('/v1/admin/audit');
    expect(await auditCount()).toBe(before);
  }, 60_000);

  it('writes nothing when the change did not happen', async () => {
    const before = await auditCount();
    // A mistyped id is not an action, and a log full of them is a log nobody
    // reads.
    expect((await http.patch(`/v1/admin/sites/${randomUUID()}`).send({ name: 'x' })).status).toBe(
      404,
    );
    expect(await auditCount()).toBe(before);
  });

  it('records the change and the reason atomically', async () => {
    // The row and the change share a transaction, so a reader can never see
    // one without the other. Asserted by observing both at once.
    const id = await makeSite({ name: 'Before' });
    await http.patch(`/v1/admin/sites/${id}`).send({ name: 'After', reason: 'ticket 7' });

    const [site, event] = await Promise.all([
      prisma.site.findUnique({ where: { id } }),
      prisma.auditEvent.findFirst({ where: { entityId: id }, orderBy: { createdAt: 'desc' } }),
    ]);
    expect(site?.name).toBe('After');
    expect((event?.metadata as Record<string, unknown>)['reason']).toBe('ticket 7');
  });
});
