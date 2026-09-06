import { NextResponse } from 'next/server';

/**
 * A redirect to a path on this site.
 *
 * The Location is deliberately *relative*.
 *
 * `NextResponse.redirect()` needs an absolute URL, and the only origin a Route
 * Handler can see is the one the server is bound to. In a container that is
 * `0.0.0.0:8080` — so after signing in with Google, people were sent to
 * `https://0.0.0.0:8080/logbook`. Nothing about the request tells the app what
 * it is publicly called, and `x-forwarded-host` is a header any client can
 * send, so trusting it would be worse than not knowing.
 *
 * The browser already knows the real URL: it is the one it just asked for. A
 * relative Location lets it resolve against that, which is correct behind any
 * proxy, in any environment, with nothing to configure.
 *
 * 303 rather than 307: the sign-in is finished, and what the browser should do
 * now is GET the page this points at, not repeat the request that got here.
 */
export function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}
