import { type NextRequest } from 'next/server';
import { redirectTo } from '../../../lib/redirect';
import { apiFetch } from '../../../lib/api';

/**
 * The blank spreadsheet to start from.
 *
 * A proxy, not a generator. The template is built from the importer's own
 * column list, and that list lives with the parser — so the API serves it, the
 * same way it serves an export. Building it here instead would put a second
 * copy of "which columns do we accept" in a second place, which is the one
 * thing a template must never have, and would pull an XML parser into an image
 * that has no other use for one.
 *
 * A route handler rather than a link straight to the API, for the same reason
 * `export/download` is one: the access token lives in an httpOnly cookie this
 * origin holds, and the API is on another.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const format = request.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const response = await apiFetch(`/v1/imports/template?format=${format}`);

  // A relative Location, never one built from this request's own origin — the
  // container knows itself as 0.0.0.0. See lib/redirect.
  if (response.status === 401) return redirectTo('/signin');
  if (!response.ok) return redirectTo('/import?error=template');

  // Carried through from the API, which names the file by format and units.
  return new Response(response.body, {
    status: 200,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        response.headers.get('content-disposition') ?? 'attachment; filename="mydivelog-template"',
      // Units are per diver, so a shared cache must not hand one diver's
      // template to another.
      'cache-control': 'private, no-store',
    },
  });
}
