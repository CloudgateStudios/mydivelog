import { notFound, redirect } from 'next/navigation';
import { SubmitButton } from '../../../components/SubmitButton';
import { apiFetch, currentUser } from '../../../lib/api';
import { getImport, type ImportBatch, type ImportRow } from '../../../lib/imports';
import { AppHeader } from '../../../components/AppHeader';

export const dynamic = 'force-dynamic';

/**
 * The review screen.
 *
 * Two rules from docs/08-clients.md, and both are about respect for the
 * reader's time:
 *
 * Never show identical decisions one per row. A wall of 197 rows reads as
 * work; a summary with three exceptions reads as competence. Everything is
 * grouped and collapsed, except the rows that actually need a person.
 *
 * Always explain, never assert. "Start times are within 1 min, max depths
 * agree within 0.08 m" beats a confidence score. A diver learns to trust the
 * matcher by watching it be right, and it has to show its work to be watched.
 */
export default async function Review({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const { id } = await params;
  const batch = await getImport(id).catch(() => undefined);
  if (!batch) notFound();

  if (batch.status === 'failed') return <Failed user={user} batch={batch} />;
  if (batch.status === 'committed' || batch.status === 'reverted') {
    return <Done user={user} batch={batch} />;
  }

  const merging = batch.rows.filter((r) => r.decision === 'merge');
  const creating = batch.rows.filter((r) => r.decision === 'create');
  const undecided = batch.rows.filter((r) => r.decision === 'pending');
  const skipping = batch.rows.filter((r) => r.decision === 'skip');
  const normalizations = batch.rows.flatMap((r) => r.normalizations);
  const problems = batch.rows.flatMap((r) => r.issues.filter((i) => i.severity !== 'info'));

  async function commit(): Promise<void> {
    'use server';
    const response = await apiFetch(`/v1/imports/${id}/commit`, { method: 'POST' });
    if (!response.ok) redirect(`/import/${id}?error=commit`);
    redirect(`/import/${id}`);
  }

  async function decide(formData: FormData): Promise<void> {
    'use server';
    const rowIndex = Number(formData.get('rowIndex'));
    const decision = String(formData.get('decision'));
    const matchDiveId = formData.get('matchDiveId');

    await apiFetch(`/v1/imports/${id}/rows/${rowIndex}`, {
      method: 'POST',
      body: JSON.stringify({
        decision,
        ...(decision === 'merge' && matchDiveId ? { matchDiveId: String(matchDiveId) } : {}),
      }),
    });
    redirect(`/import/${id}`);
  }

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <p className="crumb">
          <a href="/import">← Imports</a>
        </p>
        <h1>Review {batch.originalFileName}</h1>
        <p className="lede">
          Read as {formatName(batch.sourceKind)}. Nothing here has been added to your logbook yet.
        </p>

        {undecided.length > 0 && (
          <Group
            tone="warn"
            title={`${undecided.length} need${undecided.length === 1 ? 's' : ''} your decision`}
            subtitle="The matcher was not confident enough to decide these on its own."
            open
          >
            {undecided.map((row) => (
              <Undecided key={row.rowIndex} row={row} decide={decide} />
            ))}
          </Group>
        )}

        {merging.length > 0 && (
          <Group
            tone="good"
            title={`${merging.length} will merge into dives you already have`}
            subtitle="These are dives recorded twice. Each will gain what the other source knows."
          >
            {merging.map((row) => (
              <Row key={row.rowIndex} row={row} showReasons />
            ))}
          </Group>
        )}

        {creating.length > 0 && (
          <Group
            tone=""
            title={`${creating.length} will be added as new dives`}
            subtitle="Nothing in your logbook looks like these."
          >
            {creating.map((row) => (
              <Row key={row.rowIndex} row={row} />
            ))}
          </Group>
        )}

        {skipping.length > 0 && (
          <Group
            tone=""
            title={`${skipping.length} will be skipped`}
            subtitle="You chose to leave these out."
          >
            {skipping.map((row) => (
              <Row key={row.rowIndex} row={row} />
            ))}
          </Group>
        )}

        {normalizations.length > 0 && (
          <Group
            tone=""
            title={`${normalizations.length} value${normalizations.length === 1 ? ' was' : 's were'} corrected`}
            subtitle="Files contain mistakes. Here is every change, and why."
          >
            <ul className="explain">
              {summarize(normalizations).map((entry) => (
                <li key={entry.reason}>
                  <strong>{entry.count > 1 ? `${entry.count} dives: ` : ''}</strong>
                  {entry.reason}
                </li>
              ))}
            </ul>
          </Group>
        )}

        {problems.length > 0 && (
          <Group
            tone="warn"
            title={`${problems.length} row${problems.length === 1 ? '' : 's'} had a problem`}
            subtitle="These are imported anyway, minus the field that could not be read."
          >
            <ul className="explain">
              {summarize(problems.map((p) => ({ reason: p.message }))).map((entry) => (
                <li key={entry.reason}>
                  <strong>{entry.count > 1 ? `${entry.count} rows: ` : ''}</strong>
                  {entry.reason}
                </li>
              ))}
            </ul>
          </Group>
        )}

        <form action={commit} className="commit">
          <SubmitButton
            disabled={undecided.length > 0}
            pendingLabel={`Adding ${creating.length + merging.length} dives…`}
          >
            {undecided.length > 0
              ? `${undecided.length} still to decide`
              : commitLabel(creating.length, merging.length)}
          </SubmitButton>
          <p className="muted small">You can undo this afterwards, at any time.</p>
        </form>
      </main>
    </>
  );
}

/** Collapsed by default. The count is the message; the rows are the evidence. */
function Group({
  title,
  subtitle,
  tone,
  open,
  children,
}: {
  title: string;
  subtitle: string;
  tone: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className={`group ${tone}`} open={open}>
      <summary>
        <strong>{title}</strong>
        <span className="muted"> — {subtitle}</span>
      </summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

function Row({ row, showReasons }: { row: ImportRow; showReasons?: boolean }) {
  return (
    <div className="import-row">
      <div>
        <span className="mono">{when(row)}</span>
        <span className="muted">
          {row.preview.maxDepthM !== null && ` · ${row.preview.maxDepthM.toFixed(1)} m`}
          {row.preview.durationS !== null && ` · ${Math.round(row.preview.durationS / 60)} min`}
          {row.preview.siteName && ` · ${row.preview.siteName}`}
          {row.preview.hasProfile && ' · has a depth profile'}
        </span>
      </div>
      {showReasons && row.matchReasons.length > 0 && (
        // The evidence, in words. A percentage tells a diver nothing they can
        // check; "start times are within 1 min" they can check.
        <p className="muted small reasons">{row.matchReasons.map((r) => r.detail).join(' ')}</p>
      )}
    </div>
  );
}

function Undecided({ row, decide }: { row: ImportRow; decide: (formData: FormData) => void }) {
  return (
    <div className="import-row undecided">
      <div>
        <span className="mono">{when(row)}</span>
        <span className="muted">
          {row.preview.maxDepthM !== null && ` · ${row.preview.maxDepthM.toFixed(1)} m`}
          {row.preview.siteName && ` · ${row.preview.siteName}`}
        </span>
        {row.matchReasons.length > 0 && (
          <p className="muted small reasons">{row.matchReasons.map((r) => r.detail).join(' ')}</p>
        )}
        {row.issues.map((issue, i) => (
          <p key={i} className="muted small reasons">
            {issue.message}
          </p>
        ))}
      </div>
      <div className="choices">
        {row.matchDiveId && (
          <form action={decide}>
            <input type="hidden" name="rowIndex" value={row.rowIndex} />
            <input type="hidden" name="decision" value="merge" />
            <input type="hidden" name="matchDiveId" value={row.matchDiveId} />
            <button className="button small" type="submit">
              Merge
            </button>
          </form>
        )}
        <form action={decide}>
          <input type="hidden" name="rowIndex" value={row.rowIndex} />
          <input type="hidden" name="decision" value="create" />
          <button className="button small" type="submit">
            Add as new
          </button>
        </form>
        <form action={decide}>
          <input type="hidden" name="rowIndex" value={row.rowIndex} />
          <input type="hidden" name="decision" value="skip" />
          <button className="button small" type="submit">
            Skip
          </button>
        </form>
      </div>
    </div>
  );
}

async function Done({
  user,
  batch,
}: {
  user: { email: string; displayName: string | null };
  batch: ImportBatch;
}) {
  const stats = batch.stats ?? {};
  const profiles = batch.rows.filter((r) => r.preview.hasProfile && r.decision === 'merge').length;

  async function revert(): Promise<void> {
    'use server';
    await apiFetch(`/v1/imports/${batch.id}/revert`, { method: 'POST' });
    redirect('/import');
  }

  const reverted = batch.status === 'reverted';

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <p className="crumb">
          <a href="/import">← Imports</a>
        </p>
        <h1>{reverted ? 'This import was undone' : 'Imported'}</h1>

        {reverted ? (
          <p className="lede">
            Everything it added was removed, and every dive it changed went back to how it was.
          </p>
        ) : (
          <>
            <p className="lede">
              {stats['create'] ?? 0} dives added and {stats['merge'] ?? 0} merged into dives you
              already had.
              {profiles > 0 && ` ${profiles} gained a depth profile.`} Nothing was duplicated.
            </p>
            <div className="actions">
              <a className="button primary" href="/logbook">
                See your logbook
              </a>
              <form action={revert}>
                <SubmitButton className="button" pendingLabel="Undoing…">
                  Undo this import
                </SubmitButton>
              </form>
            </div>
            <p className="muted small">
              Undo stays available forever. Dives this import created are removed; dives it only
              added to go back to exactly what they were.
            </p>
          </>
        )}
      </main>
    </>
  );
}

function Failed({
  user,
  batch,
}: {
  user: { email: string; displayName: string | null };
  batch: ImportBatch;
}) {
  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <p className="crumb">
          <a href="/import">← Imports</a>
        </p>
        <h1>That file could not be read</h1>
        <p className="lede">{batch.error}</p>
        <p className="muted">
          Nothing was added to your logbook. If you think this file should work, it is worth telling
          us — a format we cannot read yet is a gap on our side.
        </p>
        <a className="button" href="/import">
          Try another file
        </a>
      </main>
    </>
  );
}

/**
 * What the button will actually do.
 *
 * "Add 6 dives to my logbook" was wrong for a file whose six dives all merge —
 * nothing is added, six existing dives gain what the computer knew. Promising
 * the wrong thing on the button that does it is the worst place to be vague.
 */
function commitLabel(creating: number, merging: number): string {
  if (creating === 0 && merging === 0) return 'Nothing to import';
  if (creating === 0) {
    return `Merge into ${merging} dive${merging === 1 ? '' : 's'} I already have`;
  }
  if (merging === 0) return `Add ${creating} dive${creating === 1 ? '' : 's'} to my logbook`;
  return `Add ${creating} and merge ${merging}`;
}

/** Identical explanations collapse into one line with a count. */
function summarize<T extends { reason: string }>(
  entries: T[],
): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

const when = (row: ImportRow): string =>
  row.preview.startTimeLocal
    ? row.preview.startTimeLocal.replace('T', ' ').slice(0, 16)
    : 'no date';

const FORMAT_NAMES: Record<string, string> = {
  uddf: 'a dive computer export',
  spreadsheet: 'a spreadsheet',
  mydivelog: 'a MyDiveLog export',
  subsurface: 'a Subsurface logbook',
};
const formatName = (kind: string): string => FORMAT_NAMES[kind] ?? kind;
