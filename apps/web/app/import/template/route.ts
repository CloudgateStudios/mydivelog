import { type NextRequest } from 'next/server';
import { templateCsv, templateXlsx } from '@mydivelog/importers';
import { redirectTo } from '../../../lib/redirect';
import { currentUser } from '../../../lib/api';
import { loadUnits } from '../../../lib/units';

/**
 * The blank spreadsheet to start from.
 *
 * Generated per request rather than served as a static file, for one reason
 * that matters: it is built from the importer's own column list, so it cannot
 * drift into being a file this product hands out and then cannot read. A
 * static asset would need remembering every time a column changed.
 *
 * The other reason is smaller but real — the columns arrive in the diver's own
 * units, so a template is never a conversion exercise before it is a logbook.
 */
export async function GET(request: NextRequest): Promise<Response> {
  // Signed in, because the units come from their preferences. A relative
  // Location, never one built from the request's own origin — see lib/redirect.
  const user = await currentUser();
  if (!user) return redirectTo('/signin');

  const wants = request.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const { unitSystem } = await loadUnits();
  const units = unitSystem === 'imperial' ? 'imperial' : 'metric';

  const name = `mydivelog-template-${units}.${wants}`;
  const body: BodyInit =
    wants === 'csv'
      ? templateCsv(units)
      : // A fresh copy, because Response takes ownership of the buffer.
        new Uint8Array(templateXlsx(units));

  return new Response(body, {
    status: 200,
    headers: {
      'content-type':
        wants === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${name}"`,
      // Units are per diver, so a shared cache must not hand one diver's
      // template to another.
      'cache-control': 'private, no-store',
    },
  });
}
