import { NextResponse, type NextRequest } from 'next/server';
import { verifyAccess } from './lib/access';

/**
 * Every request, including the health check.
 *
 * Runs before any page renders, so a request that did not come through
 * Cloudflare Access never reaches a database query. Applied as middleware
 * rather than per page because the failure mode of forgetting one page is the
 * whole point of the panel being private.
 */
export async function middleware(request: NextRequest) {
  const result = await verifyAccess(request.headers);
  if (result.ok) return NextResponse.next();

  // Deliberately terse. A person who should be here arrives through Access and
  // never sees this; a person who should not gains nothing from the detail,
  // which goes to the logs instead.
  console.warn(`admin request refused: ${result.reason}`);
  return new NextResponse('Not authorised.\n', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export const config = {
  // `/api/health` is excluded because Fly's own health check calls it from
  // inside the network, with no Access token and no way to obtain one. Left
  // covered, every machine reports unhealthy and the deploy rolls back — which
  // is what happened the first time this middleware was tried.
  //
  // It is safe to leave open: the response is a status, a service name, a
  // version and an uptime. No data, and nothing that identifies a person.
  // Cloudflare still challenges it on the public hostname.
  //
  // Static assets are excluded too, which keeps the JWKS fetch off every image
  // request. Everything that reads data is covered.
  matcher: ['/((?!api/health|_next/static|_next/image|favicon.ico).*)'],
};
