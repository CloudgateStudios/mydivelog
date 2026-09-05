import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/api';
import { loadUnits } from '../../lib/units';
import { AppHeader } from '../../components/AppHeader';

export const dynamic = 'force-dynamic';

/**
 * Export.
 *
 * The landing page promises "full-fidelity export at any time, no paid gate on
 * your own data". Until this existed the API could do it and a diver could
 * not, which makes the promise a claim rather than a feature.
 *
 * The download itself goes through a route handler that streams from the API
 * with the session attached, so the browser never needs a token.
 */
export default async function Export() {
  const user = await currentUser();
  if (!user) redirect('/signin');
  const prefs = await loadUnits();

  return (
    <>
      <AppHeader user={user} />
      <main className="app">
        <h1>Export your logbook</h1>
        <p className="lede">
          Everything you have, whenever you want it. If you ever leave, you leave with all of it.
        </p>

        <div className="cards">
          <article>
            <h3>MyDiveLog JSON</h3>
            <p>
              Every field, every source, every profile. This is the one to keep as a backup — it is
              the only format that can be re-imported without losing anything.
            </p>
            <a className="button" href="/export/download?format=mydivelog">
              Download JSON
            </a>
          </article>

          <article>
            <h3>UDDF</h3>
            <p>
              The open standard most dive software reads, including depth profiles, sites and gases.
              Use this to move to another tool.
            </p>
            <a className="button" href="/export/download?format=uddf">
              Download UDDF
            </a>
          </article>

          <article>
            <h3>Spreadsheet</h3>
            <p>
              One row per dive, in{' '}
              {prefs.unitSystem === 'imperial' ? 'feet and °F' : 'metres and °C'} to match your
              settings. No profiles — a spreadsheet has nowhere to put them.
            </p>
            <a className="button" href={`/export/download?format=csv&units=${prefs.unitSystem}`}>
              Download CSV
            </a>
          </article>
        </div>

        <p className="muted small">
          Exports are generated when you ask for them and are never cached, so what you download is
          your logbook as it is right now.
        </p>
      </main>
    </>
  );
}
