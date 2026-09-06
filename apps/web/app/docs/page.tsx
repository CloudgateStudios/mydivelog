import { currentUser } from '../../lib/api';
import { MarketingShell } from '../../components/MarketingShell';

/**
 * How it works, in enough detail to be checkable.
 *
 * Written for the reader who does not believe the landing page. Every claim
 * here names the mechanism rather than the benefit, because "we merge
 * intelligently" is what every competitor says and the difference is whether
 * you can see the rules.
 */
export const metadata = {
  title: 'How MyDiveLog works — documentation',
  description:
    'How importing, matching and merging work, what makes two records the same dive, which ' +
    'source wins a disagreement, and how to undo any of it.',
};

export default async function Docs() {
  const user = await currentUser();

  return (
    <MarketingShell user={user}>
      <section className="hero">
        <h1>How it works</h1>
        <p className="lede">
          The interesting part of a dive logbook is not storing dives. It is what happens when the
          same dive arrives twice, from two tools that disagree.
        </p>
      </section>

      <section className="section" id="import">
        <h2>Importing, step by step</h2>
        <ol className="steps">
          <li>
            <h3>Upload</h3>
            <p>
              The format is worked out from the content, not the file extension — a{' '}
              <code>.txt</code> holding XML is read as XML, and a <code>.csv</code> that is really
              tab-separated is read as a table. You are told what was detected and why.
            </p>
          </li>
          <li>
            <h3>Read</h3>
            <p>
              Every row becomes an observation: what that source claims, with the original text kept
              alongside. A field the source did not record stays absent — never zero, never an empty
              string, because &ldquo;no reading&rdquo; and &ldquo;a reading of nothing&rdquo; are
              different facts about a dive.
            </p>
          </li>
          <li>
            <h3>Match</h3>
            <p>
              Each observation is compared against the dives you already have. See below for what
              counts as the same dive.
            </p>
          </li>
          <li>
            <h3>Review</h3>
            <p>
              Before anything is written you see what will happen: how many dives are new, how many
              merge into existing ones, and every field where the sources disagreed. Ninety-six
              identical decisions are grouped into one line rather than ninety-six.
            </p>
          </li>
          <li>
            <h3>Commit — or do not</h3>
            <p>
              Nothing touches your logbook until you say so, and re-uploading the same file does not
              import it twice.
            </p>
          </li>
        </ol>
      </section>

      <section className="section" id="matching">
        <h2>What counts as the same dive</h2>
        <p className="lede">
          Time, depth, duration, site and gas each contribute evidence. No single one decides.
        </p>
        <div className="cards">
          <article>
            <h3>Time, compared as a wall clock</h3>
            <p>
              Two records of the same dive agree about what the clock said far more reliably than
              they agree about UTC — one of them usually has the timezone wrong. So the comparison
              prefers local time, and a suspicious offset blocks an automatic merge outright rather
              than lowering a score.
            </p>
          </article>
          <article>
            <h3>Depth and duration, within tolerance</h3>
            <p>
              A watch samples every few seconds; a person writes down 46 feet. Those should agree
              closely, not exactly, and the tolerance is generous enough for rounding but not for a
              different dive.
            </p>
          </article>
          <article>
            <h3>Where you were</h3>
            <p>
              Coordinates within about 50 metres are the same site. Within 250 they are nearby, and
              that is weaker evidence rather than none. Names are compared too, because one source
              usually has a name and the other has a location.
            </p>
          </article>
          <article>
            <h3>What you breathed</h3>
            <p>
              Gas is a quiet tiebreaker: two dives on the same day at the same site with different
              mixes are usually two dives.
            </p>
          </article>
        </div>
        <p className="footnote">
          When the evidence is strong the dives merge. When it is weak they stay separate. When it
          is in between you are asked, once, and told what the evidence was.
        </p>
      </section>

      <section className="section" id="merging">
        <h2>Which source wins</h2>
        <p className="lede">
          Not the newest, and not the last one imported. It depends on the field.
        </p>
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">
              Which kind of source wins each kind of field
            </caption>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Preferred source</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Depth, temperature, gas, profile</th>
                <td>Your dive computer</td>
                <td>It measured them. You remembered them.</td>
              </tr>
              <tr>
                <th scope="row">Site name, notes, buddies, gear, weight</th>
                <td>Your spreadsheet</td>
                <td>
                  A watch has no idea how much lead you wore — one export writes 0.0 for all 96
                  dives — and it certainly does not know the site was called Angel City.
                </td>
              </tr>
              <tr>
                <th scope="row">Coordinates</th>
                <td>Whichever has them</td>
                <td>Usually only one does.</td>
              </tr>
              <tr>
                <th scope="row">Tags and buddies</th>
                <td>Both</td>
                <td>These are sets. Two sources naming different buddies means you had two.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="footnote">
          The value that did not win is kept, not discarded. Open any dive and the provenance panel
          shows every value every source claimed, which one is shown, and why.
        </p>
      </section>

      <section className="section" id="undo">
        <h2>Undoing an import</h2>
        <p className="lede">
          Any import can be reverted, however long ago it ran and however much has merged since.
        </p>
        <p>
          Reverting removes that source and everything it contributed, then recomputes each affected
          dive from the sources that remain — a dive that gained a depth profile from the import
          loses it again, and a field the import won reverts to whatever the other source said. A
          dive that only existed because of that import is removed. Nothing is left behind holding a
          value nobody can now explain.
        </p>
      </section>

      <section className="section" id="units">
        <h2>Units</h2>
        <p>
          Everything is stored in metres, Celsius, kilograms and bar, whatever your file used and
          whatever you read. Conversion happens where a number is shown to you, so switching between
          feet and metres changes the display and never the record. You can mix them — plenty of
          divers log depth in feet and still think in Celsius.
        </p>
      </section>

      <section className="section" id="not">
        <h2>What this is not</h2>
        <p>
          Not a dive computer. No decompression planning, no no-fly timers, no gas planning, no
          in-water guidance of any kind. MyDiveLog records what you did; it never tells you what to
          do. Anything here that looks like advice is a record of a past dive, not a plan for a
          future one.
        </p>
      </section>

      <section className="section cta">
        <h2>The rest is easier to see than to read</h2>
        <p className="lede">
          Bring a file. Nothing is written until you have seen what it proposes.
        </p>
        <a className="button primary" href={user ? '/import' : '/signin'}>
          {user ? 'Import a file' : 'Sign in to begin'}
        </a>
      </section>
    </MarketingShell>
  );
}
