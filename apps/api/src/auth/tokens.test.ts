import { describe, expect, it } from 'vitest';
import { generateOpaqueToken, hashToken, signAccessToken, verifyAccessToken } from './tokens.ts';

const SECRET = 'test-secret-value-at-least-32-characters-long';
const claims = { sub: '0192f000-0000-7000-8000-000000000000', email: 'a@b.invalid', staff: false };

describe('access tokens', () => {
  it('round-trips claims', () => {
    const t = signAccessToken(claims, SECRET, 900);
    const v = verifyAccessToken(t, SECRET);
    expect(v?.sub).toBe(claims.sub);
    expect(v?.staff).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const t = signAccessToken(claims, SECRET, 900);
    expect(verifyAccessToken(t, `${SECRET}-other`)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const t = signAccessToken(claims, SECRET, 900);
    const [h, , s] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...claims, staff: true, iat: 1, exp: 9e9 }),
    ).toString('base64url');
    expect(verifyAccessToken(`${h}.${forged}.${s}`, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const t = signAccessToken(claims, SECRET, 900, Date.now() - 1_000_000);
    expect(verifyAccessToken(t, SECRET)).toBeNull();
  });

  it('rejects malformed input rather than throwing', () => {
    for (const bad of ['', 'a', 'a.b', 'a.b.c.d', 'not-a-token']) {
      expect(verifyAccessToken(bad, SECRET)).toBeNull();
    }
  });

  it('rejects the alg=none forgery', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...claims, iat: 1, exp: 9e9 })).toString('base64url');
    expect(verifyAccessToken(`${header}.${body}.`, SECRET)).toBeNull();
  });
});

describe('opaque tokens', () => {
  it('are unpredictable and distinct', () => {
    const set = new Set(Array.from({ length: 500 }, generateOpaqueToken));
    expect(set.size).toBe(500);
    expect(generateOpaqueToken().length).toBeGreaterThanOrEqual(43);
  });

  it('hash deterministically, and the hash does not contain the token', () => {
    const t = generateOpaqueToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).toHaveLength(64);
  });
});
