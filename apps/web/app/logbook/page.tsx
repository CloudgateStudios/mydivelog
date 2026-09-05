import { redirect } from 'next/navigation';
import { apiJson, currentUser } from '../../lib/api';
import { AppHeader } from '../../components/AppHeader';
import { withUnits } from '../../lib/units';

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

  const u = await withUnits();
  const page = await apiJson<{ data: Dive[]; total?: number }>('/v1/dives?limit=25').catch(() => ({
    data: [] as Dive[],
  }));

  return (
    <>
      <AppHeader user={user} />
      <main className="app">
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
                  <td>
                    <a href={`/dives/${dive.id}`}>{dive.diveNumber}</a>
                  </td>
                  <td>{dive.startTimeLocal.slice(0, 10)}</td>
                  <td className="num">{u.depth(dive.maxDepthM)}</td>
                  <td className="num">{u.duration(dive.durationS)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
