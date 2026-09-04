import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Access tokens are short-lived signed JWTs; refresh tokens are opaque random
 * strings, stored only as a hash so a database read yields nothing usable.
 *
 * HMAC rather than RSA for now: there is one issuer and one verifier. Moving to
 * asymmetric keys matters when something outside this service needs to verify a
 * token without being able to mint one.
 */

export type AccessTokenClaims = {
  sub: string;
  email: string;
  staff: boolean;
  iat: number;
  exp: number;
};

const b64url = (b: Buffer) => b.toString('base64url');
const fromB64url = (s: string) => Buffer.from(s, 'base64url');

export function signAccessToken(
  claims: Omit<AccessTokenClaims, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const payload: AccessTokenClaims = { ...claims, iat, exp: iat + ttlSeconds };
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyAccessToken(
  token: string,
  secret: string,
  now = Date.now(),
): AccessTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];

  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const actual = fromB64url(signature);
  // Constant-time: a length-varying or short-circuiting compare leaks the
  // signature a byte at a time.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const claims = JSON.parse(fromB64url(body).toString('utf8')) as AccessTokenClaims;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null;
    if (typeof claims.sub !== 'string' || !claims.sub) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Opaque, 256 bits. Returned once; only the hash is persisted. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
