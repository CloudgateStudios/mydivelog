import { redirect } from 'next/navigation';
import { apiJson, currentUser } from '../../lib/api';
import { clearSession } from '../../lib/session';

export const dynamic = 'force-dynamic';

type Dive = {
  id: string;
  diveNumber: number;
  startTimeLocal: string;
  maxDepthM: number | null;
  durationS: number | null;
};

/**
 * The first authenticated page: proof that a session works end to end.
 *
 * The log list, filters and dive detail land next; this exists so sign-in has
 * somewhere to arrive that reads real data rather than a placeholder claiming
 * it worked.
 */
export default async function Logbook() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const page = await apiJson<{ data: Dive[]; total?: number }>('/v1/dives?limit=25').catch(() => ({
    data: [] as Dive[],
  }));

  async function signOut(): Promise<void> {
    'use server';
    await clearSession();
    redirect('/signin');
  }

  return (
    <main className="app">
      <header>
        <strong>MyDiveLog</strong>
        <span className="muted">{user.displayName ?? user.email}</span>
        <form action={signOut}>
          <button className="link" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <h1>Your logbook</h1>
      {page.data.length === 0 ? (
        <p className="muted">
          No dives yet. Importing is how most people start — a spreadsheet or a dive computer
          export, and the merge takes it from there.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th className="num">Depth</th>
              <th className="num">Duration</th>
            </tr>
          </thead>
          <tbody>
            {page.data.map((dive) => (
              <tr key={dive.id}>
                <td>{dive.diveNumber}</td>
                <td>{dive.startTimeLocal.slice(0, 10)}</td>
                <td className="num">
                  {dive.maxDepthM === null ? '—' : `${dive.maxDepthM.toFixed(1)} m`}
                </td>
                <td className="num">
                  {dive.durationS === null ? '—' : `${Math.round(dive.durationS / 60)} min`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
