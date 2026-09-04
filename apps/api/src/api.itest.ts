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
let tokenA = '';
let tokenB = '';

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
}, 60_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
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
    const first = await http.post('/v1/auth/dev/login').send({ email: emailA }).expect(201);
    const original = first.body.refreshToken as string;

    const rotated = await http
      .post('/v1/auth/refresh')
      .send({ refreshToken: original })
      .expect(201);
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
    await http.post(`/v1/dives/${id}/restore`).set('authorization', `Bearer ${tokenA}`).expect(201);
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

describe('the OpenAPI document', () => {
  it('is served publicly and describes the routes that exist', async () => {
    const res = await http.get('/v1/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toContain('/dives');
  });
});
