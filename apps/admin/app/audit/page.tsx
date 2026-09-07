import { db } from '../../lib/db';
import { dateTime, shortId } from '../../lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 200;

/**
 * Every staff action, in order.
 *
 * `docs/11-roadmap.md` makes "every staff action appears in the audit log" an
 * acceptance criterion, and this page is where that criterion is either
 * obviously true or obviously not. It reads the table directly, like every
 * other page here — writing is what goes through the API.
 *
 * The log is append-only and there is deliberately no way to edit or delete a
 * row from anywhere in this application. An accountability record a staff
 * member can tidy is not one.
 */
export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<{ entityType?: string; entityId?: string; actorId?: string }>;
}) {
  const filters = await searchParams;

  const events = await db.auditEvent.findMany({
    where: {
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: PAGE_SIZE,
  });

  // Resolved in one query rather than a join per row: the log is read far more
  // often than it is written, and an actor id alone makes it unreadable.
  const actorIds = [...new Set(events.map((e) => e.actorId).filter((id) => id !== null))];
  const actors = await db.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, email: true },
  });
  const emailById = new Map(actors.map((a) => [a.id, a.email]));

  const filtered = Boolean(filters.entityType ?? filters.entityId ?? filters.actorId);

  return (
    <main>
      <h1>Audit log</h1>
      <p className="lede">
        Every staff change, newest first. The row and the change it records are written by the same
        transaction, so this is not a summary of what happened — it is part of what happened.
        Nothing in this panel can edit or remove a row here.
        {filtered && (
          <>
            {' '}
            · <a href="/audit">Show everything</a>
          </>
        )}
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>On</th>
              <th>Why, and what changed</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const metadata = (event.metadata ?? {}) as Record<string, unknown>;
              const { reason, changed, ...rest } = metadata;
              return (
                <tr key={event.id}>
                  <td className="mono muted">{dateTime(event.createdAt)}</td>
                  <td className="muted">
                    {event.actorId === null ? (
                      <span className="tag">{event.actorKind}</span>
                    ) : (
                      <a href={`/audit?actorId=${event.actorId}`}>
                        {emailById.get(event.actorId) ?? shortId(event.actorId)}
                      </a>
                    )}
                  </td>
                  <td>
                    <span className={`tag ${tone(event.action)}`}>{event.action}</span>
                  </td>
                  <td className="mono">
                    {event.entityId ? (
                      <a href={linkTo(event.entityType, event.entityId)}>
                        {shortId(event.entityId)}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {event.entityType}
                    </div>
                  </td>
                  <td style={{ maxWidth: '34rem' }}>
                    {typeof reason === 'string' && <div>{reason}</div>}
                    <Changed changed={changed} rest={rest} />
                  </td>
                  <td className="mono muted">{event.ip ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {events.length === 0 && (
          <p className="empty">
            {filtered
              ? 'No staff action has touched this.'
              : 'Nothing yet. No staff change has been made in this environment.'}
          </p>
        )}
      </div>

      {events.length === PAGE_SIZE && (
        <p className="muted" style={{ fontSize: 12 }}>
          Showing the most recent {PAGE_SIZE}. Filter by entity to see further back.
        </p>
      )}
    </main>
  );
}

/**
 * The diff, as sentences.
 *
 * `{ name: ['Thousand Steps', '1,000 Steps'] }` is what the repository stores;
 * rendering it as JSON would make the most useful column the least readable.
 */
function Changed({ changed, rest }: { changed: unknown; rest: Record<string, unknown> }) {
  const pairs =
    changed && typeof changed === 'object'
      ? Object.entries(changed as Record<string, unknown>)
      : [];
  const extras = Object.entries(rest).filter(([, value]) => value !== undefined);

  if (pairs.length === 0 && extras.length === 0) return null;

  return (
    <div className="muted" style={{ fontSize: 11 }}>
      {pairs.map(([field, value]) => {
        const [before, after] = Array.isArray(value) ? value : [undefined, value];
        return (
          <div key={field} className="mono">
            {field}: {show(before)} → {show(after)}
          </div>
        );
      })}
      {extras.map(([key, value]) => (
        <div key={key} className="mono">
          {key}: {show(value)}
        </div>
      ))}
    </div>
  );
}

const show = (value: unknown): string => {
  if (value === null) return '—';
  if (value === undefined) return '?';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};

/** Deletions read differently from edits, and should look it. */
const tone = (action: string): string =>
  action.endsWith('.delete') || action.endsWith('.remove') || action === 'import.revert'
    ? 'bad'
    : action === 'site.merge' || action.startsWith('user.')
      ? 'warn'
      : '';

const linkTo = (entityType: string, entityId: string): string => {
  switch (entityType) {
    case 'site':
      return `/sites/${entityId}`;
    case 'dive':
      return `/dives/${entityId}`;
    case 'import_batch':
      return `/imports/${entityId}`;
    case 'user':
      return `/dives?user=${entityId}`;
    default:
      return `/audit?entityType=${entityType}&entityId=${entityId}`;
  }
};
