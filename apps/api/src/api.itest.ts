import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrismaClient } from '@mydivelog/db';
import { AppModule } from './app.module.ts';
import { ProblemDetailsFilter } from './common/problem-details.ts';

/**
 * Phase 2 acceptance criteria, exercised against a real database and a real
 * HTTP stack. Needs `pnpm services:up` and an applied migration.
 *
 *   pnpm --filter @mydivelog/api test:integration
 */

const prisma = getPrismaClient();
let app: INestApplication;
let http: ReturnType<typeof request>;

const emailA = `a-${randomUUID()}@itest.invalid`;
const emailB = `b-${randomUUID()}@itest.invalid`;
// The filter suite asserts exact counts, so it needs a logbook the other
// suites are not adding dives to.
const emailC = `c-${randomUUID()}@itest.invalid`;
let tokenA = '';
let tokenB = '';
let tokenC = '';

const newDive = (overrides: Record<string, unknown> = {}) => ({
  startTimeUtc: '2026-03-06T23:07:42.000Z',
  startTimeLocal: '2026-03-06T19:07:42',
  tzOffsetMinutes: -240,
  maxDepthM: 14.099043,
  durationS: 2776,
  ...overrides,
});

async function login(email: string): Promise<string> {
  const res = await http.post('/v1/auth/dev/login').send({ email });
  if (!res.body?.accessToken) {
    throw new Error(`dev login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

beforeAll(async () => {
  process.env['AUTH_DEV_LOGIN_ENABLED'] = 'true';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  http = request(app.getHttpServer());

  tokenA = await login(emailA);
  tokenB = await login(emailB);
  tokenC = await login(emailC);
}, 60_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB, emailC] } } });
  await app?.close();
  await prisma.$disconnect();
});

describe('authentication', () => {
  it('refuses an unauthenticated request with Problem Details', async () => {
    const res = await http.get('/v1/dives').expect(401);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.type).toContain('unauthorized');
    expect(res.body.status).toBe(401);
  });

  it('refuses a tampered token', async () => {
    await http.get('/v1/dives').set('authorization', `Bearer ${tokenA}x`).expect(401);
  });

  it('returns the session with entitlements, not a plan name to interpret', async () => {
    const res = await http
      .get('/v1/auth/session')
      .set('authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.user.email).toBe(emailA);
    expect(res.body.entitlements).toHaveProperty('features');
  });

  it('rotates refresh tokens and revokes the family when one is replayed', async () => {
    // 200, not 201: logging in returns a session, it does not create a resource.
    const first = await http.post('/v1/auth/dev/login').send({ email: emailA }).expect(200);
    const original = first.body.refreshToken as string;

    const rotated = await http
      .post('/v1/auth/refresh')
      .send({ refreshToken: original })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(original);

    // Replaying the consumed token means it leaked: the whole family dies.
    await http.post('/v1/auth/refresh').send({ refreshToken: original }).expect(401);
    await http
      .post('/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it('answers the magic link request identically for known and unknown addresses', async () => {
    await http.post('/v1/auth/email/request').send({ email: emailA }).expect(204);
    await http.post('/v1/auth/email/request').send({ email: 'nobody@itest.invalid' }).expect(204);
  });
});

describe('dive lifecycle', () => {
  let id = '';

  it('creates a dive and assigns the next number', async () => {
    const res = await http
      .post('/v1/dives')
      .set('authorization', `Bearer ${tokenA}`)
      .send(newDive({ notes: 'Angel City' }))
      .expect(201);
    id = res.body.id;
    expect(res.body.diveNumber).toBeGreaterThanOrEqual(1);
  });

  it('keeps local time as wall clock, independent of the server timezone', async () => {
    const res = await http
      .get(`/v1/dives/${id}`)
      .set('authorization', `Bearer ${tokenA}`)
      .expect(200);
    // Sent without a zone; must come back as the same wall clock rather than
    // shifted by wherever the API happens to run.
    expect(res.body.startTimeLocal).toBe('2026-03-06T19:07:42.000Z');
    expect(res.body.startTimeUtc).toBe('2026-03-06T23:07:42.000Z');
  });

  it('patches without disturbing omitted fields', async () => {
    await http
      .patch(`/v1/dives/${id}`)
      .set('authorization', `Bearer ${tokenA}`)
      .send({ rating: 5 })
      .expect(200);
    const res = await http
      .get(`/v1/dives/${id}`)
      .set('authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.rating).toBe(5);
    expect(res.body.notes).toBe('Angel City');
  });

  it('clears a field when it is explicitly null', async () => {
    await http
      .patch(`/v1/dives/${id}`)
      .set('authorization', `Bearer ${tokenA}`)
      .send({ notes: null })
      .expect(200);
    const res = await http
      .get(`/v1/dives/${id}`)
      .set('authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.notes).toBeNull();
  });

  it('rejects impossible values with a field-level code', async () => {
    const res = await http
      .post('/v1/dives')
      .set('authorization', `Bearer ${tokenA}`)
      .send(newDive({ maxDepthM: 9999 }))
      .expect(422);
    expect(res.body.errors[0].field).toBe('maxDepthM');
    expect(res.body.errors[0].code).toBeTruthy();
  });

  it('soft deletes and restores', async () => {
    await http.delete(`/v1/dives/${id}`).set('authorization', `Bearer ${tokenA}`).expect(204);
    await http.get(`/v1/dives/${id}`).set('authorization', `Bearer ${tokenA}`).expect(404);
    await http.post(`/v1/dives/${id}/restore`).set('authorization', `Bearer ${tokenA}`).expect(200);
    await http.get(`/v1/dives/${id}`).set('authorization', `Bearer ${tokenA}`).expect(200);
  });

  it('summarizes the log', async () => {
    const res = await http
      .get('/v1/stats/summary')
      .set('authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.diveCount).toBeGreaterThanOrEqual(1);
    expect(res.body.maxDepthM).toBeCloseTo(14.099043, 5);
  });
});

describe('ownership', () => {
  let diveOfA = '';

  beforeAll(async () => {
    const res = await http
      .post('/v1/dives')
      .set('authorization', `Bearer ${tokenA}`)
      .send(newDive({ notes: 'private to A' }))
      .expect(201);
    diveOfA = res.body.id;
  });

  /**
   * 404 rather than 403 throughout: a 403 confirms the resource exists, which
   * for a dive log leaks that a particular person logged a particular dive.
   */
  it.each([
    ['GET', (id: string) => http.get(`/v1/dives/${id}`)],
    ['PATCH', (id: string) => http.patch(`/v1/dives/${id}`).send({ rating: 1 })],
    ['DELETE', (id: string) => http.delete(`/v1/dives/${id}`)],
    ['POST restore', (id: string) => http.post(`/v1/dives/${id}/restore`)],
  ])("returns 404, not 403, when user B touches user A's dive via %s", async (_label, call) => {
    const res = await call(diveOfA).set('authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("does not list another user's dives", async () => {
    const res = await http.get('/v1/dives').set('authorization', `Bearer ${tokenB}`).expect(200);
    expect(res.body.data.map((d: { id: string }) => d.id)).not.toContain(diveOfA);
  });
});

describe('idempotency', () => {
  it('replays the original response instead of acting twice', async () => {
    const key = randomUUID();
    const body = newDive({ notes: 'idempotent' });

    const first = await http
      .post('/v1/dives')
      .set('authorization', `Bearer ${tokenA}`)
      .set('idempotency-key', key)
      .send(body)
      .expect(201);

    const replay = await http
      .post('/v1/dives')
      .set('authorization', `Bearer ${tokenA}`)
      .set('idempotency-key', key)
      .send(body);

    expect(replay.body.id).toBe(first.body.id);
    expect(replay.headers['idempotent-replay']).toBe('true');

    const count = await prisma.dive.count({
      where: { userId: first.body.userId, notes: 'idempotent', deletedAt: null },
    });
    expect(count).toBe(1);
  });

  it('refuses the same key with a different body, rather than hiding a client bug', async () => {
    const key = randomUUID();
    await http
      .post('/v1/dives')
      .set('authorization', `Bearer ${tokenA}`)
      .set('idempotency-key', key)
      .send(newDive({ notes: 'first' }))
      .expect(201);

    const res = await http
      .post('/v1/dives')
      .set('authorization', `Bearer ${tokenA}`)
      .set('idempotency-key', key)
      .send(newDive({ notes: 'different' }))
      .expect(409);
    expect(res.body.errors[0].code).toBe('idempotency_key_reused');
  });

  it("scopes keys per user, so one caller cannot read another's response", async () => {
    const key = randomUUID();
    const body = newDive({ notes: 'scoped' });
    const a = await http
      .post('/v1/dives')
      .set('authorization', `Bearer ${tokenA}`)
      .set('idempotency-key', key)
      .send(body)
      .expect(201);
    const b = await http
      .post('/v1/dives')
      .set('authorization', `Bearer ${tokenB}`)
      .set('idempotency-key', key)
      .send(body)
      .expect(201);
    expect(b.body.id).not.toBe(a.body.id);
  });
});

/**
 * Filtering, against a real query parser.
 *
 * The unit tests cover the string handling; what only a real request can show
 * is whether Express hands a repeated `?tag=` to Nest as an array at all. It
 * is the kind of thing that works in a test that builds the object by hand and
 * fails on the wire.
 */
/**
 * Three dives belonging to the third diver: a wreck dive at night, a wreck
 * dive by day, and a night dive on a reef.
 *
 * At module scope because both the filter suite and the stats suite read them,
 * and a fixture owned by whichever suite needed it first is how the next one
 * ends up building a second, subtly different copy.
 */
let wreckId = '';
let nightId = '';
let siteId = '';

beforeAll(async () => {
  const tagged = async (slug: string, label: string) => {
    const tag = await prisma.tag.create({
      data: { id: randomUUID(), slug, label, category: 'activity' },
    });
    return tag.id;
  };
  {
    wreckId = await tagged(`wreck-${randomUUID()}`, 'Wreck');
    nightId = await tagged(`night-${randomUUID()}`, 'Night');

    const site = await prisma.site.create({
      data: { id: randomUUID(), name: `Hilma Hooker ${randomUUID()}` },
    });
    siteId = site.id;

    const user = await prisma.user.findUniqueOrThrow({ where: { email: emailC } });
    const make = async (overrides: Record<string, unknown>, tags: string[], diveNumber: number) => {
      const dive = await prisma.dive.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          diveNumber,
          tzOffsetMinutes: -240,
          startTimeUtc: new Date('2026-03-06T23:07:42.000Z'),
          startTimeLocal: new Date('2026-03-06T19:07:42.000Z'),
          ...overrides,
        },
      });
      for (const tagId of tags) {
        await prisma.diveTag.create({ data: { diveId: dive.id, tagId } });
      }
      return dive.id;
    };

    // A wreck dive at night, a wreck dive by day, a night dive on a reef.
    await make(
      { maxDepthM: 30, siteId, notes: 'manta ray on the safety stop' },
      [wreckId, nightId],
      9001,
    );
    await make({ maxDepthM: 28, siteId }, [wreckId], 9002);
    await make({ maxDepthM: 12 }, [nightId], 9003);
  }
}, 60_000);

/**
 * A dive number means "the nth dive I have done", and an import cannot keep
 * that true on its own: it numbers a batch from the diver's current highest,
 * which is right when the file is newer than everything already logged and
 * wrong when it is not. This is the endpoint that notices.
 */
describe('dive numbering', () => {
  let token = '';

  beforeAll(async () => {
    token = await login(`numbering-${randomUUID()}@itest.invalid`);
  });

  const state = async () => {
    const res = await http.get('/v1/dives/numbering').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as {
      chronological: boolean;
      outOfOrder: number;
      wouldChange: number;
      diveCount: number;
    };
  };

  const addDive = async (utc: string, local: string) =>
    http
      .post('/v1/dives')
      .set('authorization', `Bearer ${token}`)
      .send(newDive({ startTimeUtc: utc, startTimeLocal: local }));

  it('says an empty logbook is in order', async () => {
    expect(await state()).toMatchObject({ chronological: true, diveCount: 0 });
  });

  it('stays in order while dives are added newest last', async () => {
    await addDive('2020-01-01T10:00:00.000Z', '2020-01-01T10:00:00');
    await addDive('2021-01-01T10:00:00.000Z', '2021-01-01T10:00:00');
    expect(await state()).toMatchObject({ chronological: true, outOfOrder: 0, diveCount: 2 });
  });

  it('notices when a dive older than the others is added afterwards', async () => {
    // The case this exists for: a forgotten logbook found in a drawer. The new
    // dive is the oldest and gets the highest number, so the numbering no
    // longer means what a dive number means.
    await addDive('2019-01-01T10:00:00.000Z', '2019-01-01T10:00:00');

    const drifted = await state();
    expect(drifted.chronological).toBe(false);
    expect(drifted.outOfOrder).toBeGreaterThan(0);
    // Renumbering closes gaps too, so it always touches at least as many.
    expect(drifted.wouldChange).toBeGreaterThanOrEqual(drifted.outOfOrder);
  });

  it('is in order again after renumbering, oldest first', async () => {
    const res = await http
      .post('/v1/dives/renumber')
      .set('authorization', `Bearer ${token}`)
      .send({ startAt: 1 });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBeGreaterThan(0);

    expect(await state()).toMatchObject({ chronological: true, outOfOrder: 0, wouldChange: 0 });

    const dives = await http.get('/v1/dives?limit=100').set('authorization', `Bearer ${token}`);
    const byDate = [...dives.body.data].sort((a, b) =>
      a.startTimeLocal.localeCompare(b.startTimeLocal),
    );
    expect(byDate[0].diveNumber).toBe(1);
    expect(byDate.at(-1).diveNumber).toBe(byDate.length);
  });

  it('is not reachable without a session', async () => {
    expect((await http.get('/v1/dives/numbering')).status).toBe(401);
  });
});

describe('filtering the log', () => {
  const list = async (query: string) => {
    const res = await http
      .get(`/v1/dives?${query}`)
      .set('authorization', `Bearer ${tokenC}`)
      .expect(200);
    return res.body as { data: { id: string; diveNumber: number }[]; total?: number };
  };

  it('narrows on two tags rather than widening', async () => {
    const slugs = await prisma.tag.findMany({
      where: { id: { in: [wreckId, nightId] } },
      select: { slug: true, id: true },
    });
    const wreck = slugs.find((t) => t.id === wreckId)?.slug as string;
    const night = slugs.find((t) => t.id === nightId)?.slug as string;

    expect((await list(`tag=${wreck}`)).data).toHaveLength(2);
    expect((await list(`tag=${night}`)).data).toHaveLength(2);
    // The one dive carrying both. If Express collapsed the repeat, this is 2.
    const both = await list(`tag=${wreck}&tag=${night}`);
    expect(both.data).toHaveLength(1);
    expect(both.data[0]?.diveNumber).toBe(9001);
  });

  it('searches notes and site names, and not the notes marked private', async () => {
    expect((await list('q=manta')).data).toHaveLength(1);
    expect((await list('q=Hilma')).data).toHaveLength(2);
    expect((await list('q=MANTA')).data, 'case insensitive').toHaveLength(1);
  });

  it('filters on a depth range in metres', async () => {
    expect((await list('minDepthM=29')).data).toHaveLength(1);
    expect((await list('minDepthM=20&maxDepthM=29')).data).toHaveLength(1);
  });

  it('includes the closing day of a date range', async () => {
    // The dive is 19:07 local on the 6th. A `to` that stopped at midnight
    // would drop it, which is the bug this range exists to prevent.
    expect((await list('from=2026-03-06&to=2026-03-06&withTotal=true')).total).toBe(3);
    expect((await list('from=2026-03-07')).data).toHaveLength(0);
  });

  it('counts matches only when asked', async () => {
    expect((await list('q=manta')).total).toBeUndefined();
    expect((await list('q=manta&withTotal=true')).total).toBe(1);
  });

  it('pages without repeating or losing a dive when the sort has ties', async () => {
    // All three share a start time. Without the id tiebreaker the two pages
    // can overlap, and a diver sees one dive twice and another never.
    const first = await list('limit=2&sort=date_desc');
    expect(first.data).toHaveLength(2);
    const second = await list(
      `limit=2&sort=date_desc&cursor=${(first as { nextCursor?: string }).nextCursor}`,
    );
    const ids = [...first.data, ...second.data].map((d) => d.id);
    expect(new Set(ids).size, 'no dive appears on both pages').toBe(ids.length);
  });

  it('offers only the sites and tags this diver has actually dived', async () => {
    const res = await http
      .get('/v1/dives/facets')
      .set('authorization', `Bearer ${tokenC}`)
      .expect(200);
    expect(res.body.sites.map((s: { id: string }) => s.id)).toContain(siteId);
    expect(res.body.sites.find((s: { id: string }) => s.id === siteId).count).toBe(2);

    const other = await http
      .get('/v1/dives/facets')
      .set('authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(other.body.sites.map((s: { id: string }) => s.id)).not.toContain(siteId);
  });
});

describe('stats and sites', () => {
  it('answers every number the stats page draws from one request', async () => {
    const res = await http
      .get('/v1/stats/overview?bucketM=5')
      .set('authorization', `Bearer ${tokenC}`)
      .expect(200);

    expect(res.body.totals.diveCount).toBe(3);
    expect(res.body.byMonth).toHaveLength(12);
    expect(res.body.milestone.at).toBe(25);
    // Three dives at the same moment on one day is one day, not three.
    expect(res.body.streak.days).toBe(1);
    expect(
      res.body.depthHistogram.reduce((n: number, b: { dives: number }) => n + b.dives, 0),
    ).toBe(3);
  });

  it('buckets depth at the width the caller asked for', async () => {
    // 10 ft is 3.048 m. A diver reading feet wants round feet, and bucketing
    // in metres then relabelling gives boundaries of 16.4 and 32.8 ft.
    const res = await http
      .get('/v1/stats/overview?bucketM=3.048')
      .set('authorization', `Bearer ${tokenC}`)
      .expect(200);
    expect(res.body.depthHistogram[0].toM).toBeCloseTo(3.048, 3);
  });

  it('lists only the sites this diver has dived, with their own counts', async () => {
    const res = await http.get('/v1/sites').set('authorization', `Bearer ${tokenC}`).expect(200);
    const mine = res.body.data.find((s: { id: string }) => s.id === siteId);
    expect(mine.dives).toBe(2);

    // Site records are shared; a diver with no dives there has no such site.
    const other = await http.get('/v1/sites').set('authorization', `Bearer ${tokenB}`).expect(200);
    expect(other.body.data.map((s: { id: string }) => s.id)).not.toContain(siteId);
  });

  it('answers 404 for a site the diver has never dived, not 403', async () => {
    // Existence is not disclosed: 403 would confirm the shared table holds it.
    await http.get(`/v1/sites/${siteId}`).set('authorization', `Bearer ${tokenB}`).expect(404);
    await http.get(`/v1/sites/${siteId}`).set('authorization', `Bearer ${tokenC}`).expect(200);
  });
});

describe('saved views', () => {
  it('round-trips a filter set and reopens it', async () => {
    const name = `Deep wrecks ${randomUUID()}`;
    const created = await http
      .post('/v1/saved-views')
      .set('authorization', `Bearer ${tokenA}`)
      .send({ name, query: 'minDepthM=30&sort=depth_desc&limit=25' })
      .expect(201);
    // Paging is stripped; the filters survive.
    expect(created.body.query).toBe('minDepthM=30&sort=depth_desc');

    const list = await http
      .get('/v1/saved-views')
      .set('authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(list.body.data.map((v: { name: string }) => v.name)).toContain(name);

    await http
      .delete(`/v1/saved-views/${created.body.id}`)
      .set('authorization', `Bearer ${tokenA}`)
      .expect(204);
  });

  it('replaces rather than failing when a name is reused', async () => {
    const name = `Night ${randomUUID()}`;
    const post = (query: string) =>
      http
        .post('/v1/saved-views')
        .set('authorization', `Bearer ${tokenA}`)
        .send({ name, query })
        .expect(201);

    const first = await post('minDepthM=10');
    const second = await post('minDepthM=20');
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.query).toContain('minDepthM=20');
  });

  it("will not delete another diver's view", async () => {
    const created = await http
      .post('/v1/saved-views')
      .set('authorization', `Bearer ${tokenA}`)
      .send({ name: `Private ${randomUUID()}`, query: 'q=manta' })
      .expect(201);

    await http
      .delete(`/v1/saved-views/${created.body.id}`)
      .set('authorization', `Bearer ${tokenB}`)
      .expect(404);
    await http
      .get('/v1/saved-views')
      .set('authorization', `Bearer ${tokenB}`)
      .expect(200)
      .expect((res) => expect(res.body.data).toHaveLength(0));
  });
});

describe('trips', () => {
  let tripId = '';

  it('creates a trip and puts dives in it', async () => {
    const created = await http
      .post('/v1/trips')
      .set('authorization', `Bearer ${tokenC}`)
      .send({ name: 'Bonaire 2026', startDate: '2026-03-02', endDate: '2026-03-08' })
      .expect(201);
    tripId = created.body.id;

    const dives = await http
      .get('/v1/dives?limit=2')
      .set('authorization', `Bearer ${tokenC}`)
      .expect(200);
    const diveIds = dives.body.data.map((d: { id: string }) => d.id);

    const assigned = await http
      .post(`/v1/trips/${tripId}/dives`)
      .set('authorization', `Bearer ${tokenC}`)
      .send({ diveIds })
      .expect(200);
    expect(assigned.body.changed).toBe(2);

    const detail = await http
      .get(`/v1/trips/${tripId}`)
      .set('authorization', `Bearer ${tokenC}`)
      .expect(200);
    expect(detail.body.dives).toHaveLength(2);
  });

  it("will not pull another diver's dive into a trip", async () => {
    // Scoped on both sides. A crafted request must not be able to move a dive
    // that is not the caller's, and must not report that it did.
    const theirs = await prisma.dive.findFirstOrThrow({
      where: { user: { email: emailA }, deletedAt: null },
      select: { id: true, tripId: true },
    });

    const res = await http
      .post(`/v1/trips/${tripId}/dives`)
      .set('authorization', `Bearer ${tokenC}`)
      .send({ diveIds: [theirs.id] })
      .expect(200);
    expect(res.body.changed).toBe(0);

    const after = await prisma.dive.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.tripId).toBe(theirs.tripId);
  });

  it('releases the dives when the trip is deleted rather than removing them', async () => {
    // Deleting a trip must never look like deleting the diving.
    const before = await http
      .get(`/v1/trips/${tripId}`)
      .set('authorization', `Bearer ${tokenC}`)
      .expect(200);
    const diveIds = before.body.dives.map((d: { id: string }) => d.id);

    await http.delete(`/v1/trips/${tripId}`).set('authorization', `Bearer ${tokenC}`).expect(204);

    const survivors = await prisma.dive.findMany({ where: { id: { in: diveIds } } });
    expect(survivors).toHaveLength(diveIds.length);
    expect(survivors.every((d) => d.tripId === null && d.deletedAt === null)).toBe(true);
  });

  it("answers 404 for another diver's trip", async () => {
    const created = await http
      .post('/v1/trips')
      .set('authorization', `Bearer ${tokenC}`)
      .send({ name: `Private ${randomUUID()}` })
      .expect(201);
    await http
      .get(`/v1/trips/${created.body.id}`)
      .set('authorization', `Bearer ${tokenB}`)
      .expect(404);
  });
});

describe('gear', () => {
  it('refuses to delete kit that has been on dives, and says to retire it', async () => {
    // A wetsuit you no longer own was still on four hundred dives. Deleting it
    // would rewrite them, so the API refuses with something actionable.
    const item = await http
      .post('/v1/gear')
      .set('authorization', `Bearer ${tokenC}`)
      .send({ kind: 'wetsuit', name: `Bare Jacket ${randomUUID()}` })
      .expect(201);

    const dive = await prisma.dive.findFirstOrThrow({
      where: { user: { email: emailC }, deletedAt: null },
      select: { id: true },
    });
    await prisma.diveGear.create({ data: { diveId: dive.id, gearItemId: item.body.id } });

    const refused = await http
      .delete(`/v1/gear/${item.body.id}`)
      .set('authorization', `Bearer ${tokenC}`)
      .expect(409);
    expect(refused.body.errors[0].code).toBe('gear_in_use');

    // Retiring works, and is reversible.
    const retired = await http
      .patch(`/v1/gear/${item.body.id}`)
      .set('authorization', `Bearer ${tokenC}`)
      .send({ retired: true })
      .expect(200);
    expect(retired.body.retiredAt).not.toBeNull();

    const restored = await http
      .patch(`/v1/gear/${item.body.id}`)
      .set('authorization', `Bearer ${tokenC}`)
      .send({ retired: false })
      .expect(200);
    expect(restored.body.retiredAt).toBeNull();
  });

  it('deletes kit that was never on a dive', async () => {
    const item = await http
      .post('/v1/gear')
      .set('authorization', `Bearer ${tokenC}`)
      .send({ kind: 'fins', name: `Unused ${randomUUID()}` })
      .expect(201);
    await http
      .delete(`/v1/gear/${item.body.id}`)
      .set('authorization', `Bearer ${tokenC}`)
      .expect(204);
  });

  it('attaches an accepted suggestion to the dives it was counted from', async () => {
    // The suggestion says "on 3 dives". An item created from it and left on
    // zero makes that count a promise the page then breaks.
    const name = `Full Wet Suit ${randomUUID()}`;
    const dives = await prisma.dive.findMany({
      where: { user: { email: emailC }, deletedAt: null },
      select: { id: true },
      take: 2,
    });
    const source = await prisma.diveSource.create({
      data: {
        id: randomUUID(),
        diveId: dives[0]?.id as string,
        sourceKind: 'spreadsheet',
        recordedAt: new Date(),
      },
    });
    for (const dive of dives) {
      // Composite key: (diveId, fieldPath, sourceId). No id column.
      await prisma.diveFieldProvenance.create({
        data: {
          diveId: dive.id,
          sourceId: source.id,
          fieldPath: 'gear',
          value: `${name}, Boots`,
          isSelected: true,
        },
      });
    }

    const created = await http
      .post('/v1/gear')
      .set('authorization', `Bearer ${tokenC}`)
      .send({ kind: 'wetsuit', name, linkImportedDives: true })
      .expect(201);
    expect(created.body.dives).toBe(2);
  });
});

describe('the OpenAPI document', () => {
  it('is served publicly and describes the routes that exist', async () => {
    const res = await http.get('/v1/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toContain('/dives');
  });
});
