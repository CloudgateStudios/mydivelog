import { cookies } from 'next/headers';

/**
 * Session handling.
 *
 * Tokens live in httpOnly cookies and every API call is made from the server,
 * so the browser never holds one. A token in `localStorage` is readable by any
 * script that gets onto the page, and the thing it unlocks is a decade of
 * somebody's dive history.
 *
 * The cost is that authenticated pages cannot be static. That is the right
 * trade for a logbook.
 */

const ACCESS_COOKIE = 'mdl_at';
const REFRESH_COOKIE = 'mdl_rt';

/** Matches the API's refresh token lifetime. */
const REFRESH_MAX_AGE_S = 60 * 60 * 24 * 60;

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
  isStaff: boolean;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
};

const secure = process.env.NODE_ENV === 'production';

export async function storeSession(tokens: TokenPair): Promise<void> {
  const jar = await cookies();
  const common = {
    httpOnly: true,
    secure,
    // `lax` rather than `strict`: the OAuth flow returns from Google, and a
    // strict cookie is not sent on that navigation, so the session would look
    // empty on the very page that just created it.
    sameSite: 'lax' as const,
    path: '/',
  };

  jar.set(ACCESS_COOKIE, tokens.accessToken, {
    ...common,
    // A little short of the token's own lifetime, so a request never arrives
    // with a cookie the API has already stopped accepting.
    maxAge: Math.max(30, tokens.expiresIn - 30),
  });
  jar.set(REFRESH_COOKIE, tokens.refreshToken, { ...common, maxAge: REFRESH_MAX_AGE_S });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

export async function readAccessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

export async function readRefreshToken(): Promise<string | undefined> {
  return (await cookies()).get(REFRESH_COOKIE)?.value;
}
