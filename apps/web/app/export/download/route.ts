import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '../../../lib/api';

/**
 * Streams an export from the API with the session attached.
 *
 * A route handler rather than a link straight to the API, because the access
 * token lives in an httpOnly cookie this origin holds and the API is on a
 * different one. The browser never sees a token, and the file still arrives as
 * a normal download.
 */
export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const format = request.nextUrl.searchParams.get('format') ?? 'mydivelog';
  const units = request.nextUrl.searchParams.get('units') ?? 'metric';

  const response = await apiFetch(
    `/v1/exports?format=${encodeURIComponent(format)}&units=${encodeURIComponent(units)}`,
  );

  if (!response.ok) {
    return NextResponse.redirect(new URL('/export?error=1', request.nextUrl.origin));
  }

  // Content-disposition is carried through from the API, which already names
  // the file by format and date.
  return new Response(response.body, {
    status: 200,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        response.headers.get('content-disposition') ?? 'attachment; filename="mydivelog-export"',
      'cache-control': 'no-store',
    },
  });
}
