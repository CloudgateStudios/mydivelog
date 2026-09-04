import { describe, expect, it } from 'vitest';
import { CreateDive, ListDivesQuery, MAX_DEPTH_M, UpdateDive } from './dives.ts';
import { ProblemDetails } from './common.ts';
import { buildOpenApiDocument } from './openapi.ts';

const valid = {
  startTimeUtc: '2026-03-06T23:07:42.000Z',
  startTimeLocal: '2026-03-06T19:07:42',
  tzOffsetMinutes: -240,
};

describe('CreateDive', () => {
  it('accepts the shape the sample data produces', () => {
    const parsed = CreateDive.parse({
      ...valid,
      maxDepthM: 14.099043,
      durationS: 2776,
      waterTempMinC: 26.49,
      weightKg: 10.886,
      waterType: 'salt',
      notes: 'Angel City',
    });
    expect(parsed.maxDepthM).toBeCloseTo(14.099043, 6);
  });

  it('requires all three time fields, because a source offset can be wrong', () => {
    expect(CreateDive.safeParse({ startTimeUtc: valid.startTimeUtc }).success).toBe(false);
    expect(CreateDive.safeParse({ ...valid, tzOffsetMinutes: undefined }).success).toBe(false);
  });

  it('accepts the malformed-looking offsets a repaired import produces', () => {
    // -00:04 in the source is repaired to -04:00 before it reaches the API.
    expect(CreateDive.safeParse({ ...valid, tzOffsetMinutes: -240 }).success).toBe(true);
    expect(CreateDive.safeParse({ ...valid, tzOffsetMinutes: -4 }).success).toBe(true);
  });

  it('rejects depths beyond any plausible dive', () => {
    expect(CreateDive.safeParse({ ...valid, maxDepthM: MAX_DEPTH_M + 1 }).success).toBe(false);
    expect(CreateDive.safeParse({ ...valid, maxDepthM: -1 }).success).toBe(false);
  });

  it('rejects an average depth deeper than the maximum', () => {
    const r = CreateDive.safeParse({ ...valid, maxDepthM: 10, avgDepthM: 20 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['avgDepthM']);
  });

  it('does not accept a caller-supplied id', () => {
    const parsed = CreateDive.parse({ ...valid, id: 'nope' } as never);
    expect('id' in parsed).toBe(false);
  });
});

describe('UpdateDive', () => {
  it('distinguishes an omitted field from an explicit null', () => {
    expect(UpdateDive.parse({})).toEqual({});
    const cleared = UpdateDive.parse({ notes: null });
    expect('notes' in cleared).toBe(true);
    expect(cleared.notes).toBeNull();
  });
});

describe('ListDivesQuery', () => {
  it('coerces query strings and applies a default page size', () => {
    const q = ListDivesQuery.parse({ limit: '25', minDepthM: '10' });
    expect(q.limit).toBe(25);
    expect(q.minDepthM).toBe(10);
    expect(ListDivesQuery.parse({}).limit).toBe(50);
  });

  it('caps the page size so one request cannot pull an entire logbook', () => {
    expect(ListDivesQuery.safeParse({ limit: '5000' }).success).toBe(false);
  });
});

describe('ProblemDetails', () => {
  it('carries machine-readable codes, not just prose', () => {
    const p = ProblemDetails.parse({
      type: 'https://mydivelog.app/errors/validation-failed',
      title: 'Validation failed',
      status: 422,
      errors: [{ field: 'maxDepthM', code: 'out_of_range' }],
    });
    expect(p.errors?.[0]?.code).toBe('out_of_range');
  });
});

describe('the OpenAPI document', () => {
  const doc = buildOpenApiDocument('1.2.3');

  it('describes every route the API serves', () => {
    for (const p of [
      '/dives',
      '/dives/{id}',
      '/dives/renumber',
      '/auth/session',
      '/stats/summary',
    ]) {
      expect(Object.keys(doc.paths)).toContain(p);
    }
  });

  it('marks user-owned routes as requiring a bearer token', () => {
    expect(doc.paths['/dives'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/auth/refresh'].post.security).toEqual([]);
  });

  it("documents 404 rather than 403 for another user's dive", () => {
    const responses = doc.paths['/dives/{id}'].get.responses;
    expect(Object.keys(responses)).toContain('404');
    expect(Object.keys(responses)).not.toContain('403');
  });

  it('offers an idempotency key on every unsafe method', () => {
    const unsafe = [
      doc.paths['/dives'].post,
      doc.paths['/dives/{id}'].patch,
      doc.paths['/dives/{id}'].delete,
      doc.paths['/dives/renumber'].post,
    ];
    for (const op of unsafe) {
      const names = (op.parameters ?? []).map((p) => p.name);
      expect(names, `${op.operationId} has no Idempotency-Key`).toContain('Idempotency-Key');
    }
  });

  it('returns 204 from the magic link request, so accounts cannot be enumerated', () => {
    const responses = doc.paths['/auth/email/request'].post.responses;
    expect(Object.keys(responses)).toContain('204');
    expect(Object.keys(responses)).not.toContain('404');
  });

  it('is serializable, since it is emitted as JSON', () => {
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(JSON.parse(JSON.stringify(doc)).info.version).toBe('1.2.3');
  });
});
