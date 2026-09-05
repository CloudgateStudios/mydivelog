import { db, DIVE_SELECT } from '../../lib/db';
import { dateTime, metres, minutes, offset, shortId } from '../../lib/format';

export const dynamic = 'force-dynamic';

export default async function Dives({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const { user } = await searchParams;

  const dives = await db.dive.findMany({
    where: { deletedAt: null, ...(user ? { userId: user } : {}) },
    orderBy: { startTimeUtc: 'desc' },
    take: 250,
    select: {
      ...DIVE_SELECT,
      site: { select: { id: true, name: true, latitude: true, longitude: true } },
      // Only whether an offset was ever asserted. A spreadsheet records no
      // timezone, so the column holds the schema default and displaying it
      // plainly claims UTC on the diver's behalf.
      provenance: { where: { fieldPath: 'tzOffsetMinutes' }, select: { fieldPath: true } },
      _count: { select: { sources: true, tags: true } },
    },
  });

  return (
    <main>
      <h1>Dives</h1>
      <p className="lede">
        {user ? (
          <>
            Filtered to user <code>{shortId(user)}</code> · <a href="/dives">show all</a>
          </>
        ) : (
          'Newest first, 250 at a time. Notes are never shown here.'
        )}
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Start (local)</th>
              <th>Offset</th>
              <th className="num">Depth</th>
              <th className="num">Duration</th>
              <th>Site</th>
              <th className="num">Sources</th>
              <th>Flags</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            {dives.map((dive) => (
              <tr key={dive.id}>
                <td className="num">
                  <a href={`/dives/${dive.id}`}>{dive.diveNumber}</a>
                </td>
                <td className="mono">{dateTime(dive.startTimeLocal)}</td>
                <td className="mono muted">
                  {offset(dive.tzOffsetMinutes)}
                  {dive.provenance.length === 0 && (
                    <div className="tag warn" style={{ fontSize: 10 }}>
                      assumed
                    </div>
                  )}
                </td>
                <td className="num">{metres(dive.maxDepthM)}</td>
                <td className="num">{minutes(dive.durationS)}</td>
                <td>
                  {dive.site ? (
                    <a href={`/sites#${dive.site.id}`}>{dive.site.name}</a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                  {dive.site && dive.site.latitude === null && (
                    // A site with a name and no coordinates is half-merged: it
                    // is waiting for a computer export to locate it.
                    <span className="muted" style={{ fontSize: 11 }}>
                      {' '}
                      no coords
                    </span>
                  )}
                </td>
                <td className="num">
                  {dive._count.sources > 1 ? (
                    <span className="tag good">{dive._count.sources}</span>
                  ) : (
                    dive._count.sources
                  )}
                </td>
                <td>
                  {dive.hasProfile && <span className="tag">profile</span>}{' '}
                  {dive.hasContestedFields && <span className="tag warn">contested</span>}
                </td>
                <td className="mono muted">{shortId(dive.userId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {dives.length === 0 && <p className="empty">No dives.</p>}
      </div>
    </main>
  );
}
