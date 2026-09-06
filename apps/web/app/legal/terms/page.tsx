import { currentUser } from '../../../lib/api';
import { MarketingShell } from '../../../components/MarketingShell';
import { LegalNotice } from '../../../components/LegalNotice';

/**
 * Terms of service.
 *
 * The section that matters most here is the liability boundary, and it is not
 * boilerplate: docs/10-security-privacy.md draws it deliberately because the
 * moment this product tells a diver what is safe, it becomes a different
 * product with a different legal and testing burden. It is stated in the UI
 * too, in the footer of every page.
 */
export const metadata = {
  title: 'Terms — MyDiveLog',
  description:
    'What MyDiveLog is, what it is not, and what you can expect from it. A record-keeping ' +
    'product with no dive planning and no safety guidance of any kind.',
};

export default async function Terms() {
  const user = await currentUser();

  return (
    <MarketingShell user={user}>
      <section className="hero">
        <h1>Terms</h1>
        <p className="lede">
          The short version: it is your logbook, you can leave with it whenever you like, and it
          will never tell you whether a dive is safe.
        </p>
      </section>

      <LegalNotice />

      <article className="prose">
        <h2 id="not-a-dive-computer">MyDiveLog is not a dive computer</h2>
        <p>This is the most important thing on this page, so it is first.</p>
        <p>
          <strong>
            MyDiveLog is a record-keeping product. It provides no dive planning, no decompression
            calculation, and no safety guidance of any kind.
          </strong>{' '}
          There are no no-fly timers, no repetitive-dive planning, and no gas-limit warnings.
        </p>
        <p>
          Numbers derived from your logbook — surface intervals, gas consumption, ascent rates — are{' '}
          <em>historical observations about dives you already did</em>. They are not recommendations
          about a dive you are about to do, and they must not be used as one. Plan your dives with a
          dive computer, appropriate training, and the tables or software your agency taught you.
        </p>
        <p>
          It is not a medical product. Anything you write in your notes about your own health is
          stored as your own text and nothing else.
        </p>

        <h2>Your data is yours</h2>
        <ul>
          <li>You keep ownership of everything you put in. We do not claim rights over it.</li>
          <li>
            You can export all of it, in full fidelity, at any time, free. This does not change when
            there is a paid tier.
          </li>
          <li>
            If you stop paying for something in the future, you will never be locked out of your own
            history. The worst case we will build is read-only, with export intact.
          </li>
        </ul>

        <h2>Accuracy is a shared job</h2>
        <p>
          Imported data can be wrong, because the file it came from can be wrong. MyDiveLog tries
          hard here — it corrects known export bugs, marks values it changed, and shows you which
          source each number came from — but it cannot know what actually happened on your dive. You
          are responsible for checking your own records, particularly after an import. The
          provenance panel exists so you can.
        </p>
        <p>
          If your logbook matters for a certification, an insurance claim or professional hours,
          keep your own copy. The export button is right there.
        </p>

        <h2>Using the service</h2>
        <ul>
          <li>Log your own dives. Do not use someone else&rsquo;s account.</li>
          <li>
            You must be at least 13, or 16 in the EU. Junior divers exist and are welcome with a
            parent or guardian&rsquo;s involvement; we do not target anyone under those ages.
          </li>
          <li>
            Do not upload anything you do not have the right to upload, and do not try to break,
            overload or extract other people&rsquo;s data from the service.
          </li>
          <li>
            We may suspend an account that is being used to attack the service or to harm someone.
            We will not delete your data to do it.
          </li>
        </ul>

        <h2>What we promise, and what we do not</h2>
        <p>
          MyDiveLog has not launched and is free while we build it. It is provided as it is: we make
          no guarantee that it will be available, that an import will read every file, or that it
          will never lose data — which is exactly why export is free, unlimited, and something we
          would like you to actually use.
        </p>
        <p>
          To the extent the law allows, we are not liable for losses arising from using the service.
          Nothing here limits liability that cannot be limited, and nothing here affects consumer
          rights you have under the law where you live.
        </p>

        <h2>Ending it</h2>
        <p>
          You can stop using MyDiveLog whenever you like. Export first — it takes a moment and it is
          free. Self-serve account deletion is not built yet; until it is, ask us and we will do it
          by hand, and <a href="/legal/privacy">the privacy page</a> says what that means for your
          data.
        </p>

        <h2>Changes</h2>
        <p>
          These terms will be replaced by a reviewed version before there is anything to pay for. If
          they change in a way that affects you, we will say so rather than quietly editing the
          page.
        </p>
      </article>
    </MarketingShell>
  );
}
