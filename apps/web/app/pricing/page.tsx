import { currentUser } from '../../lib/api';
import { MarketingShell } from '../../components/MarketingShell';

/**
 * Pricing.
 *
 * No number, deliberately. Billing does not exist yet — there is no Stripe
 * integration, no checkout, nothing to charge with — and a price printed
 * before any of that is a promise made by a page rather than by a product.
 * What *is* decided is the shape, and the shape is the part a reader actually
 * needs: what stays free forever, and what the paid tier will and will not be
 * allowed to take away.
 *
 * The free column is checked against what ships today. Nothing in it is
 * aspirational.
 */
export const metadata = {
  title: 'Pricing — MyDiveLog',
  description:
    'Everything MyDiveLog does today is free, including unlimited dives, unlimited imports ' +
    'and full-fidelity export. Paid features are coming; access to your own data never will be.',
};

type Line = { feature: string; free: string; pro: string };

const LINES: Line[] = [
  { feature: 'Dives', free: 'Unlimited', pro: 'Unlimited' },
  { feature: 'Import and merge', free: 'Unlimited', pro: 'Unlimited' },
  { feature: 'Export, all formats, full fidelity', free: 'Yes, always', pro: 'Yes, always' },
  { feature: 'Undo any import', free: 'Yes', pro: 'Yes' },
  { feature: 'Depth profiles and provenance', free: 'Yes', pro: 'Yes' },
  { feature: 'Stats and charts', free: 'Planned', pro: 'Planned' },
  { feature: 'Advanced analytics, gas consumption trends', free: '—', pro: 'Planned' },
  { feature: 'Printable PDF logbook', free: 'Planned, limited', pro: 'Planned, unlimited' },
  { feature: 'Photo storage', free: 'Planned, small', pro: 'Planned, generous' },
  { feature: 'Continuous sync with dive services', free: '—', pro: 'Planned' },
  // The cost model says 90 days on free, and nothing deletes anything today.
  // Writing the intended limit here would be describing a retention policy
  // that is not enforced, which is the one kind of claim on this page that
  // could actually cost somebody a file.
  { feature: 'Original file retention', free: 'Kept; limits planned', pro: 'Planned, forever' },
];

export default async function Pricing() {
  const user = await currentUser();

  return (
    <MarketingShell user={user}>
      <section className="hero">
        <h1>Free while we build it.</h1>
        <p className="lede">
          There is no paid tier yet, and no price to quote — we would rather say that than print a
          number we have not committed to. Everything below marked free is free today.
        </p>
      </section>

      <section className="section">
        <h2>The line we will not move</h2>
        <div className="cards">
          <article>
            <h3>Export is free forever</h3>
            <p>
              Full-fidelity, every format, no limit, no paid gate. That is not a launch offer. A
              logbook that can hold your history hostage is a logbook you should not put a decade of
              dives into, and we would like you to put a decade of dives into this one.
            </p>
          </article>
          <article>
            <h3>Your dives are never the product</h3>
            <p>
              No selling or sharing of your data, no ads, no third-party analytics following you
              around the site. See <a href="/legal/privacy">the privacy page</a> for specifics.
            </p>
          </article>
          <article>
            <h3>Paid buys convenience, not access</h3>
            <p>
              When there is a paid tier it will sell analysis, storage and integrations — things
              that cost us money to run. It will never sell you back what you put in.
            </p>
          </article>
        </div>
      </section>

      <section className="section">
        <h2>What is free today, and what is planned</h2>
        <div className="table-scroll">
          <table className="pricing">
            <caption className="visually-hidden">
              Free and planned paid features. Rows marked planned do not exist yet.
            </caption>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col">Free</th>
                <th scope="col">Paid, when it exists</th>
              </tr>
            </thead>
            <tbody>
              {LINES.map((line) => (
                <tr key={line.feature}>
                  <th scope="row">{line.feature}</th>
                  <td>{line.free}</td>
                  <td>{line.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          &ldquo;Planned&rdquo; means exactly that: it is not built, and nothing on this page is a
          commitment to a date. Anything not marked planned works now.
        </p>
      </section>

      <section className="section cta">
        <h2>Nothing to decide yet</h2>
        <p className="lede">
          Bring a spreadsheet and see whether the merge does what it says. That is the only thing
          worth judging this on.
        </p>
        <a className="button primary" href={user ? '/logbook' : '/signin'}>
          {user ? 'Open your logbook' : 'Start with your spreadsheet'}
        </a>
      </section>
    </MarketingShell>
  );
}
