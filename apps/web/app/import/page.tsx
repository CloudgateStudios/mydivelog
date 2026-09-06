import { redirect } from 'next/navigation';
import { MAX_UPLOAD_BYTES } from '@mydivelog/contracts';
import { currentUser } from '../../lib/api';
import { listImports, uploadImport } from '../../lib/imports';
import { AppHeader } from '../../components/AppHeader';
import { DropZone } from '../../components/DropZone';

export const dynamic = 'force-dynamic';

export default async function Import({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const { error } = await searchParams;
  const { data: history } = await listImports().catch(() => ({ data: [] }));

  async function upload(formData: FormData): Promise<void> {
    'use server';
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      redirect('/import?error=no-file');
    }

    let batch;
    try {
      batch = await uploadImport(file);
    } catch (err) {
      redirect(
        `/import?error=${encodeURIComponent(String(err instanceof Error ? err.message : err))}`,
      );
    }
    // Straight to review. Nothing has been written to the logbook yet.
    redirect(`/import/${batch.id}`);
  }

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <h1>Import dives</h1>
        <p className="lede">
          A spreadsheet, a dive computer export, or a MyDiveLog backup. Nothing is added to your
          logbook until you have seen what it proposes.
        </p>

        {error && (
          <p className="notice bad">{error === 'no-file' ? 'Choose a file first.' : error}</p>
        )}

        <DropZone action={upload} />

        <p className="muted small">
          CSV and spreadsheets, UDDF from most dive computers, and MyDiveLog exports, up to{' '}
          {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB. If a file is not recognised, the import
          says so rather than guessing. <a href="/formats">What works, exactly.</a>
        </p>

        {history.length > 0 && (
          <>
            <h2>Previous imports</h2>
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>When</th>
                  <th>Outcome</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((batch) => (
                  <tr key={batch.id}>
                    <td>{batch.originalFileName}</td>
                    <td className="muted">{batch.createdAt.slice(0, 10)}</td>
                    <td>{outcome(batch)}</td>
                    <td>
                      <a href={`/import/${batch.id}`}>
                        {batch.status === 'review' ? 'Continue' : 'View'}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              An import can be undone at any time, however long ago it ran.
            </p>
          </>
        )}
      </main>
    </>
  );
}

function outcome(batch: {
  status: string;
  stats: Record<string, number> | null;
  error: string | null;
}) {
  if (batch.status === 'failed') {
    return <span className="muted">Could not be read — {batch.error}</span>;
  }
  if (batch.status === 'reverted') return <span className="muted">Undone</span>;
  if (batch.status === 'review') return <span>Waiting for you</span>;

  const stats = batch.stats;
  if (batch.status === 'committed' && stats) {
    const parts = [
      stats['create'] ? `${stats['create']} added` : '',
      stats['merge'] ? `${stats['merge']} merged` : '',
    ].filter(Boolean);
    return <span>{parts.join(', ') || 'Nothing changed'}</span>;
  }
  return <span className="muted">{batch.status}</span>;
}
