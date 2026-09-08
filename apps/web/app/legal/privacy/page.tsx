import { currentUser } from '../../../lib/api';
import { MarketingShell } from '../../../components/MarketingShell';
import { LegalNotice } from '../../../components/LegalNotice';

/**
 * The privacy page.
 *
 * Written to describe what the software does today, not what
 * docs/10-security-privacy.md intends it to do. That distinction is the whole
 * point: three things in that document — application-layer encryption of
 * notes, self-serve account deletion, and an export-all endpoint — are not
 * built, and a privacy policy that claimed them would be the most damaging
 * kind of untrue statement this product could make.
 *
 * Planned protections are named as planned, in their own section, so a reader
 * can tell the two apart without taking anyone's word for it.
 */
export const metadata = {
  title: 'Privacy — MyDiveLog',
  description:
    'What MyDiveLog stores, who can see it, what we do not do with it, and which protections ' +
    'are built today versus planned.',
};

export default async function Privacy() {
  const user = await currentUser();

  return (
    <MarketingShell user={user}>
      <section className="hero">
        <h1>Privacy</h1>
        <p className="lede">
          A dive log is a precise record of where you were and when — which means, by implication,
          when you were not at home. We treat it that way.
        </p>
      </section>

      <LegalNotice />

      <article className="prose">
        <h2>What we store</h2>
        <ul>
          <li>
            <strong>Your logbook.</strong> Dives, sites, dates, depths, gases, gear, buddies, notes,
            depth profiles — whatever you import or enter.
          </li>
          <li>
            <strong>The files you upload,</strong> so an import can be explained and undone later.
          </li>
          <li>
            <strong>Your email address and display name,</strong> from whichever sign-in you used.
          </li>
          <li>
            <strong>Your settings,</strong> such as which units you read.
          </li>
        </ul>
        <p>
          There are no passwords, because we do not use them. Sign-in is Google or a single-use
          emailed link, and neither leaves a password with us to lose.
        </p>

        <h2>Who can see it</h2>
        <p>
          <strong>Your logbook is private by default and there is no sharing feature yet</strong> —
          so today, nobody but you and the people described below.
        </p>
        <ul>
          <li>
            <strong>Staff cannot read your dive notes.</strong> The internal support panel omits the
            notes fields entirely, and an automated test scans every page of it on every change and
            fails the build if a page tries to read them.
          </li>
          <li>
            <strong>Staff can see structural data</strong> — dates, depths, sites, and how an import
            resolved — because diagnosing a bad merge is the whole reason the panel exists.
          </li>
          <li>
            <strong>Another account cannot reach your dives.</strong> Ownership is enforced in the
            data layer rather than by each endpoint remembering to check, and a request for somebody
            else&rsquo;s dive is answered as though it does not exist rather than as forbidden —
            which would confirm that it does.
          </li>
        </ul>

        <h2>What we do not do</h2>
        <ul>
          <li>
            We do not sell or share your dive data. Not with dive operators, not with insurers.
          </li>
          <li>We do not use it to train models.</li>
          <li>
            There are no third-party analytics, no advertising trackers, and no social widgets on
            this site. The only cookies are the ones that keep you signed in, which is why you have
            not been asked to consent to anything.
          </li>
          <li>
            We do not send your dive sites to anyone. The map on your sites page is the one place
            another company is involved at all, and only in the ordinary way a map works — see
            below.
          </li>
          <li>We do not email you anything you did not ask for.</li>
        </ul>

        <h2>Where it lives</h2>
        <p>These are the companies that process data on our behalf:</p>
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">Sub-processors and what each one handles</caption>
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">What it handles</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Neon</th>
                <td>The database — your logbook.</td>
              </tr>
              <tr>
                <th scope="row">Cloudflare R2</th>
                <td>Uploaded files and depth profiles.</td>
              </tr>
              <tr>
                <th scope="row">Fly.io</th>
                <td>Runs the application.</td>
              </tr>
              <tr>
                <th scope="row">Cloudflare</th>
                <td>Serves the site and protects the staff panel.</td>
              </tr>
              <tr>
                <th scope="row">Resend</th>
                <td>Sends sign-in links. It sees your email address, not your dives.</td>
              </tr>
              <tr>
                <th scope="row">Google</th>
                <td>Only if you choose to sign in with Google.</td>
              </tr>
              <tr>
                <th scope="row">OpenStreetMap</th>
                <td>
                  Supplies the map images on your sites page. It is sent the squares of the world
                  the map is showing, which is how any map works — never your dives, your account or
                  your name.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>The map on your sites page</h2>
        <p>
          Your dive sites are drawn on a real map, and the map images behind them come from
          OpenStreetMap. That means your browser asks OpenStreetMap for the areas the map is showing
          — so it can tell that somebody at your address looked at a particular part of the world,
          in the same way it can for any site with a map on it.
        </p>
        <p>
          What it is never sent: your coordinates as data, your dive dates, your account, or
          anything identifying you to us. The sites themselves are drawn by your own browser, on top
          of those images.
        </p>
        <p>
          We think that is a fair trade for a map you can actually read, and we would rather say so
          plainly than let you assume otherwise. If you would prefer no map at all, tell us and we
          will make it a setting — it was one until recently and the code for it is still there.
        </p>

        <h2>Getting your data out</h2>
        <p>
          Export everything, in JSON, UDDF or CSV, whenever you like, free and full fidelity. It is
          on <a href="/export">the export page</a> and there is no limit on it. This is a commitment
          rather than a feature: a logbook that can hold your history hostage is not one you should
          trust with a decade of dives.
        </p>

        <h2>What is not built yet</h2>
        <p>
          Stated plainly rather than left to be assumed, because a privacy page that describes
          intentions as though they were protections is worse than no page at all.
        </p>
        <ul>
          <li>
            <strong>Deleting your account is not self-serve yet.</strong> The data model supports it
            and the interface does not. Until it does, ask us and we will do it by hand.
          </li>
          <li>
            <strong>Notes are not encrypted separately from the rest of the database.</strong> They
            are encrypted at rest the way everything in a managed database is, and staff cannot read
            them through the panel — but the additional application-layer encryption we intend is
            not built.
          </li>
          <li>
            <strong>Coordinate fuzzing for shared dives</strong> is designed but not built. It will
            arrive with sharing; neither exists today.
          </li>
          <li>
            <strong>Nothing is deleted on a schedule yet.</strong> We intend to keep your uploaded
            original files for a limited period rather than forever, and to expire logs after thirty
            days. Neither is enforced today: the files you upload are still there.
          </li>
        </ul>

        <h2>Changes</h2>
        <p>
          If this page changes in a way that affects what we do with your data, we will say so
          rather than quietly editing it.
        </p>
      </article>
    </MarketingShell>
  );
}
