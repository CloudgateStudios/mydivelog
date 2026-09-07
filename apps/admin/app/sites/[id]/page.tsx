import { notFound, redirect } from 'next/navigation';
import { db } from '../../../lib/db';
import { apiSend, withDone, withError } from '../../../lib/api';
import { Notice, SubmitButton } from '../../../components/StaffForm';
import { coordinates, dateTime, shortId } from '../../../lib/format';

export const dynamic = 'force-dynamic';

/**
 * One site, and everything staff can do to it.
 *
 * Sites are the most import-polluted table there is — a computer export gives
 * coordinates and an opaque id, a spreadsheet gives a name and nothing else,
 * and the same reef ends up in the database three times under three spellings.
 * This page is where that gets fixed, so the actions here are the moderation
 * queue rather than a generic record editor.
 *
 * Every action posts to `/v1/admin`, never to the database directly: the audit
 * row is written by the same transaction as the change, and only the API is on
 * that side of the boundary.
 */
export default async function SiteDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { id } = await params;
  const { error, done } = await searchParams;

  const site = await db.site.findUnique({
    where: { id },
    include: {
      aliases: { orderBy: { name: 'asc' } },
      region: { select: { name: true } },
      _count: { select: { dives: true } },
    },
  });
  if (!site) notFound();

  const dives = await db.dive.count({ where: { siteId: id, deletedAt: null } });

  /** Candidates to merge into. Same owner or public, and not this one. */
  const others = await db.site.findMany({
    where: {
      deletedAt: null,
      NOT: { id },
      OR: [
        { ownerUserId: site.ownerUserId },
        { isPublic: true },
        ...(site.name === 'Unnamed site' ? [] : [{ name: { contains: site.name.slice(0, 6) } }]),
      ],
    },
    select: { id: true, name: true, latitude: true },
    orderBy: { name: 'asc' },
    take: 200,
  });

  const here = `/sites/${id}`;

  async function update(formData: FormData): Promise<void> {
    'use server';
    const lat = num(formData.get('latitude'));
    const lon = num(formData.get('longitude'));
    const result = await apiSend(`/v1/admin/sites/${id}`, {
      method: 'PATCH',
      body: {
        name: String(formData.get('name') ?? '').trim(),
        // Cleared together or set together — the contract refuses half a
        // coordinate, because half a coordinate is not a location.
        latitude: lat,
        longitude: lon,
        description: text(formData.get('description')),
        typicalEntry: text(formData.get('typicalEntry')),
        isPublic: formData.get('isPublic') === 'on',
        reason: text(formData.get('reason')) ?? undefined,
      },
    });
    redirect(result.ok ? withDone(here, 'Saved.') : withError(here, result.detail));
  }

  async function addAlias(formData: FormData): Promise<void> {
    'use server';
    const result = await apiSend(`/v1/admin/sites/${id}/aliases`, {
      method: 'POST',
      body: { name: String(formData.get('name') ?? '').trim() },
    });
    redirect(result.ok ? withDone(here, 'Alias added.') : withError(here, result.detail));
  }

  async function removeAlias(formData: FormData): Promise<void> {
    'use server';
    const aliasId = String(formData.get('aliasId'));
    const result = await apiSend(`/v1/admin/sites/${id}/aliases/${aliasId}`, { method: 'DELETE' });
    redirect(result.ok ? withDone(here, 'Alias removed.') : withError(here, result.detail));
  }

  async function merge(formData: FormData): Promise<void> {
    'use server';
    const targetId = String(formData.get('targetId') ?? '');
    const result = await apiSend<{ divesMoved: number; targetName: string }>(
      '/v1/admin/sites/merge',
      {
        method: 'POST',
        body: { sourceId: id, targetId, reason: String(formData.get('reason') ?? '') },
      },
    );
    if (!result.ok) redirect(withError(here, result.detail));
    // To the target, not back here: this site no longer exists as a place, and
    // leaving the operator on its tombstone is a page about nothing.
    redirect(
      withDone(
        `/sites/${targetId}`,
        `Merged into ${result.data.targetName}. ${result.data.divesMoved} ${
          result.data.divesMoved === 1 ? 'dive' : 'dives'
        } moved.`,
      ),
    );
  }

  async function remove(formData: FormData): Promise<void> {
    'use server';
    const result = await apiSend(`/v1/admin/sites/${id}`, {
      method: 'DELETE',
      body: { reason: String(formData.get('reason') ?? '') },
    });
    redirect(result.ok ? withDone('/sites', 'Site deleted.') : withError(here, result.detail));
  }

  return (
    <main>
      <h1>
        {site.name} <span className="muted mono">{shortId(site.id)}</span>
      </h1>
      <p className="lede">
        <a href="/sites">All sites</a> · {dives} live {dives === 1 ? 'dive' : 'dives'} ·{' '}
        {site.isPublic ? 'shared' : 'private to one diver'} · created {dateTime(site.createdAt)}
        {site.deletedAt && (
          <>
            {' '}
            · <span className="tag bad">deleted {dateTime(site.deletedAt)}</span>
          </>
        )}
      </p>

      <Notice {...(error ? { error } : {})} {...(done ? { done } : {})} />

      <h2>Details</h2>
      <div className="panel">
        <form action={update} className="stack">
          <label>
            <span>Name</span>
            <input name="name" defaultValue={site.name} required maxLength={160} />
          </label>

          <div className="row">
            <label>
              <span>Latitude</span>
              <input
                name="latitude"
                type="number"
                step="any"
                min={-90}
                max={90}
                defaultValue={site.latitude ?? ''}
              />
            </label>
            <label>
              <span>Longitude</span>
              <input
                name="longitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                defaultValue={site.longitude ?? ''}
              />
            </label>
          </div>
          <p className="hint">
            Both or neither. A site carrying one coordinate is not a location — it plots at 0°, 0°,
            off the coast of Ghana, along with everything else that was half-filled.
          </p>

          <label>
            <span>Typical entry</span>
            <select name="typicalEntry" defaultValue={site.typicalEntry ?? ''}>
              <option value="">—</option>
              <option value="shore">shore</option>
              <option value="boat">boat</option>
              <option value="dock">dock</option>
            </select>
          </label>

          <label>
            <span>Description</span>
            <textarea name="description" rows={3} defaultValue={site.description ?? ''} />
          </label>

          <label className="check">
            <input type="checkbox" name="isPublic" defaultChecked={site.isPublic} />
            <span>
              Shared with everyone. Promoting a site puts its name in front of every diver, so it
              wants a real name and a real location first.
            </span>
          </label>

          <label>
            <span>Reason (optional)</span>
            <input name="reason" maxLength={200} placeholder="the name on the sign" />
          </label>

          <div className="actions">
            <SubmitButton>Save</SubmitButton>
          </div>
        </form>
      </div>

      <h2>Other names</h2>
      <p className="lede">
        What other sources call this place. Aliases are why &ldquo;1,000 Steps&rdquo; and
        &ldquo;Thousand Steps&rdquo; stop being two sites — the importer matches on them, so adding
        one here changes what future imports do.
      </p>
      <div className="panel">
        <table>
          <tbody>
            {site.aliases.map((alias) => (
              <tr key={alias.id}>
                <td>{alias.name}</td>
                <td>
                  <span className="tag">{alias.source}</span>
                </td>
                <td className="num">
                  <form action={removeAlias}>
                    <input type="hidden" name="aliasId" value={alias.id} />
                    <SubmitButton danger>Remove</SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {site.aliases.length === 0 && <p className="empty">No other names recorded.</p>}

        <form action={addAlias} className="inline">
          <label>
            <span className="visually-hidden">New alias</span>
            <input name="name" placeholder="Another name for this place" required maxLength={160} />
          </label>
          <SubmitButton>Add alias</SubmitButton>
        </form>
      </div>

      <h2>Merge into another site</h2>
      <p className="lede">
        Every dive moves, both sets of aliases move, and this site&rsquo;s name is kept as an alias
        of the target — so a diver who typed it still finds the place. Coordinates fill in only
        where the target has none. This is the tool for a duplicate; deleting is not.
      </p>
      <div className="panel">
        <form action={merge} className="stack">
          <label>
            <span>Merge into</span>
            <select name="targetId" required defaultValue="">
              <option value="" disabled>
                Choose the site to keep…
              </option>
              {others.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                  {other.latitude === null ? ' (no coordinates)' : ''} — {shortId(other.id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Reason</span>
            <input
              name="reason"
              required
              minLength={3}
              maxLength={200}
              placeholder="same place, two spellings"
            />
          </label>
          <div className="actions">
            <SubmitButton>Merge</SubmitButton>
          </div>
        </form>
        {others.length === 0 && <p className="empty">No other site to merge into.</p>}
      </div>

      <h2>Delete</h2>
      <div className="panel">
        {dives > 0 ? (
          <p className="empty">
            {dives} {dives === 1 ? 'dive is' : 'dives are'} logged here, so this cannot be deleted.
            Somebody was at this place; merge it into the right site instead, which keeps those
            dives and their history.
          </p>
        ) : (
          <form action={remove} className="stack">
            <label>
              <span>Reason</span>
              <input
                name="reason"
                required
                minLength={3}
                maxLength={200}
                placeholder="created in error by a bad import"
              />
            </label>
            <div className="actions">
              <SubmitButton danger>Delete this site</SubmitButton>
            </div>
          </form>
        )}
      </div>

      <h2>Where this site came from</h2>
      <div className="panel">
        <table>
          <tbody>
            <tr>
              <th style={{ width: '12rem' }}>Owner</th>
              <td className="mono">
                {site.ownerUserId ? (
                  <a href={`/dives?user=${site.ownerUserId}`}>{shortId(site.ownerUserId)}</a>
                ) : (
                  'system'
                )}
              </td>
            </tr>
            <tr>
              <th>Region</th>
              <td>{site.region?.name ?? '—'}</td>
            </tr>
            <tr>
              <th>Coordinates</th>
              <td className="mono">{coordinates(site.latitude, site.longitude)}</td>
            </tr>
            <tr>
              <th>History</th>
              <td>
                <a href={`/audit?entityType=site&entityId=${site.id}`}>
                  Every staff change to this site
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}

/** An empty number input means "no value", not zero. */
const num = (value: FormDataEntryValue | null): number | null => {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value: FormDataEntryValue | null): string | null => {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};
