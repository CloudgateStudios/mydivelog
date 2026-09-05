import { currentUser } from '../lib/api';
import { MarketingShell } from '../components/MarketingShell';

/**
 * The landing page.
 *
 * Written from docs/01-product-brief.md and the seed-data analysis. Every
 * number on it is one this project has actually produced — no invented users,
 * no testimonials, no pricing, because none of those exist yet and a landing
 * page that invents them is the first thing a careful reader stops trusting.
 *
 * The supported-formats section is the conversion driver: consolidators arrive
 * searching "import Shearwater to", so the formats are named in text rather
 * than shown as logos.
 */
export const metadata = {
  title: 'MyDiveLog — every dive you have logged, in one place',
  description:
    'Import your spreadsheet and your dive computer exports. Dives recorded in both become ' +
    'one dive holding both, never a duplicate. Full-fidelity export, always.',
};

export default async function Landing() {
  const user = await currentUser();

  return (
    <MarketingShell user={user}>
      <section className="hero">
        <h1>Every dive you have logged, in one place.</h1>
        <p className="lede">
          Your dives are in a spreadsheet, a dive computer app, a second app because you changed
          computers, and a paper logbook for the early ones. None of them talk to each other, and
          none of them is complete.
        </p>
        <div className="actions">
          <a className="button primary" href={user ? '/logbook' : '/signin'}>
            {user ? 'Open your logbook' : 'Start with your spreadsheet'}
          </a>
          <a className="button" href="/docs">
            See how the merge works
          </a>
        </div>
      </section>

      <section id="how" className="section">
        <h2>The same dive, from two sources, becomes one dive</h2>
        <p className="lede">
          This is the part other logbooks get wrong. Import a spreadsheet and a computer export
          covering the same trip and most tools give you every dive twice.
        </p>

        <div className="merge">
          <div className="merge-col">
            <h3>Your spreadsheet</h3>
            <dl>
              <dt>Site</dt>
              <dd>Angel City</dd>
              <dt>Max depth</dt>
              <dd>46 ft</dd>
              <dt>Gas</dt>
              <dd>EAN 32</dd>
              <dt>Notes, gear, weight</dt>
              <dd>yes</dd>
              <dt>Depth profile</dt>
              <dd className="absent">none</dd>
              <dt>Coordinates</dt>
              <dd className="absent">none</dd>
            </dl>
          </div>

          <div className="merge-col">
            <h3>Your dive computer</h3>
            <dl>
              <dt>Site</dt>
              <dd className="absent">site_69ab7a96…</dd>
              <dt>Max depth</dt>
              <dd>14.099 m</dd>
              <dt>Gas</dt>
              <dd>33% oxygen, measured</dd>
              <dt>Notes, gear, weight</dt>
              <dd className="absent">none</dd>
              <dt>Depth profile</dt>
              <dd>208 samples</dd>
              <dt>Coordinates</dt>
              <dd>12.10°N 68.29°W</dd>
            </dl>
          </div>

          <div className="merge-col result">
            <h3>One dive in MyDiveLog</h3>
            <dl>
              <dt>Site</dt>
              <dd>Angel City, located</dd>
              <dt>Max depth</dt>
              <dd>14.099 m</dd>
              <dt>Gas</dt>
              <dd>33%, with your 32% kept</dd>
              <dt>Notes, gear, weight</dt>
              <dd>yours</dd>
              <dt>Depth profile</dt>
              <dd>208 samples</dd>
              <dt>Coordinates</dt>
              <dd>12.10°N 68.29°W</dd>
            </dl>
          </div>
        </div>

        <p className="footnote">
          Every field records which source it came from, and the value that did not win is kept
          rather than discarded. Any import can be undone, however long ago it ran.
        </p>
      </section>

      <section id="formats" className="section">
        <h2>Bring what you have</h2>
        <div className="cards">
          <article>
            <h3>Dive computer exports</h3>
            <p>
              UDDF from Oceanic+, Suunto, Mares and anything else that writes the open standard —
              which includes Subsurface, Shearwater Cloud and Garmin Connect, all of which can
              export it. <a href="/formats">What works, exactly.</a>
            </p>
          </article>
          <article>
            <h3>Spreadsheets</h3>
            <p>
              CSV or a workbook, in whatever shape you built years ago. Columns are mapped once and
              the mapping is saved. Dates as serials, times as fractions, `N/A` for null — all of it
              expected.
            </p>
          </article>
          <article>
            <h3>Files with mistakes in them</h3>
            <p>
              Real exports contain bugs. One we handle writes timezone offsets as{' '}
              <code>-00:04</code> when it means −04:00, putting every dive four hours out. We detect
              it, correct it against the site&rsquo;s coordinates, and show you what changed.
            </p>
          </article>
        </div>
        <p className="footnote">
          Reading Subsurface&rsquo;s own XML, Garmin FIT and direct vendor integrations come after
          launch; today those tools reach us through UDDF. If a format is not listed, the generic
          spreadsheet importer usually still gets it in.
        </p>
      </section>

      <section id="trust" className="section">
        <h2>It stays yours</h2>
        <div className="cards">
          <article>
            <h3>Export everything, always</h3>
            <p>
              Full-fidelity JSON, UDDF, or CSV, whenever you want, with no paid gate on your own
              data. If you leave, you leave with all of it.
            </p>
          </article>
          <article>
            <h3>Nothing is invented</h3>
            <p>
              A field your source did not record stays empty. A value we changed is shown to you
              with the reason. Nothing is silently overwritten.
            </p>
          </article>
          <article>
            <h3>Not a dive computer</h3>
            <p>
              No decompression planning, no no-fly timers, no in-water guidance of any kind. This is
              a records product and it stays one.
            </p>
          </article>
        </div>
      </section>

      <section className="section cta">
        <h2>Start with the messiest file you have</h2>
        <p className="lede">
          That is the one worth trying. Nothing is written to your logbook until you have seen what
          the import proposes.
        </p>
        <a className="button primary" href={user ? '/logbook' : '/signin'}>
          {user ? 'Open your logbook' : 'Sign in to begin'}
        </a>
      </section>
    </MarketingShell>
  );
}
