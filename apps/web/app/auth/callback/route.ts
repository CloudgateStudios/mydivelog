import { NextResponse, type NextRequest } from 'next/server';
import { API_URL } from '../../../lib/api';
import { storeSession, type TokenPair } from '../../../lib/session';

/**
 * Where Google sends the browser, after the API forwards it here.
 *
 * A Route Handler rather than a page, because Next refuses `cookies().set()`
 * during a page render — only a Server Action or a Route Handler may modify
 * them. Written as a page first, this threw at exactly the moment a session
 * was created, which would have broken the flow it exists to complete.
 *
 * The code is exchanged server-side, so it never reaches client JavaScript and
 * the tokens go straight into httpOnly cookies.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const home = (path: string): NextResponse =>
    NextResponse.redirect(new URL(path, request.nextUrl.origin));

  const error = params.get('error');
  if (error) return home(`/signin?error=${error === 'access_denied' ? 'cancelled' : 'google'}`);

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return home('/signin?error=incomplete');

  const response = await fetch(`${API_URL}/v1/auth/oauth/google/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, state }),
    cache: 'no-store',
  });

  if (!response.ok) return home('/signin?error=google-failed');

  await storeSession((await response.json()) as TokenPair);
  return home('/logbook');
}
