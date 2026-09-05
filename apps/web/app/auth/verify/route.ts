import { NextResponse, type NextRequest } from 'next/server';
import { API_URL } from '../../../lib/api';
import { storeSession, type TokenPair } from '../../../lib/session';

/**
 * Where a sign-in email lands.
 *
 * A Route Handler for the same reason as the OAuth callback: a page render
 * cannot set cookies.
 *
 * The link is single-use, so opening it twice fails — including when a mail
 * client prefetches it, which is a real thing that happens. The sign-in page
 * says so rather than blaming the person.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');
  const home = (path: string): NextResponse =>
    NextResponse.redirect(new URL(path, request.nextUrl.origin));

  if (!token) return home('/signin?error=incomplete');

  const response = await fetch(`${API_URL}/v1/auth/email/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
    cache: 'no-store',
  });

  if (!response.ok) return home('/signin?error=link');

  await storeSession((await response.json()) as TokenPair);
  return home('/logbook');
}
