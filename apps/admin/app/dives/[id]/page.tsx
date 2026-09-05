import { notFound } from 'next/navigation';
import { decodeProfile } from '@mydivelog/domain';
import { ProfileChart } from '../../../components/ProfileChart';
import { readProfileBlob, storageConfigured } from '../../../lib/storage';
import { db, DIVE_SELECT, redactProvenanceValue, WITHHELD_FIELD_PATHS } from '../../../lib/db';
import {
  celsius,
  coordinates,
  dateTime,
  kilograms,
  metres,
  minutes,
  offset,
  provenanceValue,
  shortId,
} from '../../../lib/format';

export const dynamic = 'force-dynamic';

/**
 * A dive, and every source that had an opinion about it.
 *
 * The provenance table is the point. It is where "the spreadsheet said 46 ft
 * and the computer said 14.099 m, and here is which one won and why" becomes
 * a thing you can look at rather than a claim in a commit message.
 */
export default async function DiveDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const dive = await db.dive.findUnique({
    where: { id },
    select: {
      ...DIVE_SELECT,
      site: true,
      profile: true,
      tags: { include: { tag: true } },
      sources: { orderBy: { recordedAt: 'asc' } },
      provenance: true,
    },
  });
  if (!dive) notFound();

  const sourceById = new Map(dive.sources.map((s) => [s.id, s]));

  // Grouped by field so the competing assertions sit next to each other, which
  // is the only arrangement that answers "why does it say that".
  const byField = new Map<string, typeof dive.provenance>();
  for (const row of dive.provenance) {
    byField.set(row.fieldPath, [...(byField.get(row.fieldPath) ?? []), row]);
  }
  const fields = [...byField.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <main>
      <h1>
        Dive #{dive.diveNumber} <span className="muted mono">{shortId(dive.id)}</span>
      </h1>
      <p className="lede">
        user{' '}
        <a href={`/dives?user=${dive.userId}`} className="mono">
          {shortId(dive.userId)}
        </a>{' '}
        · {dive.sources.length} source{dive.sources.length === 1 ? '' : 's'}
        {dive.hasContestedFields && (
          <>
            {' '}
            · <span className="tag warn">contested fields</span>
          </>
        )}
      </p>

      <h2>Values</h2>
      <div className="panel">
        <table>
          <tbody>
            <Field label="Start (local)" value={dateTime(dive.startTimeLocal)} />
            <Field label="Start (UTC)" value={dateTime(dive.startTimeUtc)} />
            <Field
              label="Offset"
              value={
                // A spreadsheet records no timezone, so the column holds the
                // schema's default rather than something a source said. Showing
                // "+00:00" as if it were a fact is the kind of quiet claim this
                // panel exists to catch.
                dive.provenance.some((p) => p.fieldPath === 'tzOffsetMinutes') ? (
                  offset(dive.tzOffsetMinutes)
                ) : (
                  <>
                    {offset(dive.tzOffsetMinutes)}{' '}
                    <span className="tag warn">assumed — no source recorded one</span>
                  </>
                )
              }
            />
            <Field label="Max depth" value={metres(dive.maxDepthM)} />
            <Field label="Avg depth" value={metres(dive.avgDepthM)} />
            <Field label="Duration" value={minutes(dive.durationS)} />
            <Field label="Water temp (min)" value={celsius(dive.waterTempMinC)} />
            <Field label="Air temp" value={celsius(dive.airTempC)} />
            <Field label="Visibility" value={metres(dive.visibilityM)} />
            <Field label="Weight" value={kilograms(dive.weightKg)} />
            <Field label="Water type" value={dive.waterType ?? '—'} />
            <Field label="Rating" value={dive.rating === null ? '—' : `${dive.rating}/5`} />
            <Field
              label="Tags"
              value={dive.tags.length === 0 ? '—' : dive.tags.map((t) => t.tag.label).join(', ')}
            />
            <Field label="Notes" value={<span className="withheld">withheld from staff</span>} />
          </tbody>
        </table>
      </div>

      {dive.site && (
        <>
          <h2>Site</h2>
          <div className="panel">
            <table>
              <tbody>
                <Field label="Name" value={dive.site.name} />
                <Field
                  label="Coordinates"
                  value={coordinates(dive.site.latitude, dive.site.longitude)}
                />
                <Field
                  label="Visibility"
                  value={dive.site.isPublic ? 'public' : 'private to this diver'}
                />
              </tbody>
            </table>
          </div>
        </>
      )}

      {dive.profile && (
        <>
          <h2>Profile</h2>
          {/* Fetched and decoded here rather than trusted. The summary columns
              are denormalized at import; drawing the blob is the only way to
              confirm the samples themselves survived. */}
          <ProfilePanel storageKey={dive.profile.storageKey} />
          <div className="panel">
            <table>
              <tbody>
                <Field label="Samples" value={String(dive.profile.sampleCount)} />
                <Field label="Format" value={dive.profile.format} />
                <Field label="Size" value={`${dive.profile.byteSize} B`} />
                <Field label="Channels" value={dive.profile.channels.join(', ')} />
                <Field label="Max depth" value={metres(dive.profile.maxDepthM)} />
                <Field label="Storage key" value={<code>{dive.profile.storageKey}</code>} />
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Sources</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Kind</th>
              <th>Source ref</th>
              <th>Recorded</th>
              <th>Batch</th>
            </tr>
          </thead>
          <tbody>
            {dive.sources.map((source) => (
              <tr key={source.id}>
                <td className="mono">{shortId(source.id)}</td>
                <td>
                  <span className="tag">{source.sourceKind}</span>
                </td>
                <td className="mono muted">{source.sourceRef ?? '—'}</td>
                <td className="muted">{dateTime(source.recordedAt)}</td>
                <td>
                  {source.importBatchId ? (
                    <a href={`/imports/${source.importBatchId}`} className="mono">
                      {shortId(source.importBatchId)}
                    </a>
                  ) : (
                    <span className="muted">manual</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Field provenance</h2>
      <p className="lede">
        Every assertion any source made, and which one the dive currently shows. A field with two
        rows is a disagreement that precedence settled; the losing value is kept, which is what
        makes a revert able to restore it.
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
              <th>From</th>
              <th>Shown</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(([fieldPath, rows]) =>
              rows.map((row, i) => (
                <tr key={`${fieldPath}:${row.sourceId}`}>
                  <td className="mono">{i === 0 ? fieldPath : ''}</td>
                  <td className="mono" style={{ maxWidth: '32rem', wordBreak: 'break-word' }}>
                    {WITHHELD_FIELD_PATHS.has(fieldPath) ? (
                      <span className="withheld">withheld from staff</span>
                    ) : (
                      provenanceValue(redactProvenanceValue(fieldPath, row.value))
                    )}
                  </td>
                  <td>
                    <span className="tag">
                      {sourceById.get(row.sourceId)?.sourceKind ?? shortId(row.sourceId)}
                    </span>
                  </td>
                  <td>{row.isSelected ? <span className="tag good">shown</span> : ''}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        {fields.length === 0 && <p className="empty">No provenance recorded.</p>}
      </div>
    </main>
  );
}

async function ProfilePanel({ storageKey }: { storageKey: string }) {
  if (!storageConfigured) {
    return (
      <p className="empty">
        Object storage is not configured here, so the samples cannot be fetched. The summary below
        is what was denormalized at import.
      </p>
    );
  }

  const blob = await readProfileBlob(storageKey);
  if (!blob) {
    return (
      <p className="empty">
        <span className="tag bad">missing</span> No blob at <code>{storageKey}</code>. The dive
        claims a profile that object storage does not have.
      </p>
    );
  }

  try {
    return <ProfileChart series={decodeProfile(blob)} />;
  } catch (err) {
    // A blob that will not decode is exactly what this page exists to surface.
    return (
      <p className="empty">
        <span className="tag bad">undecodable</span> {String(err)}
      </p>
    );
  }
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr>
      <th style={{ width: '12rem' }}>{label}</th>
      <td>{value}</td>
    </tr>
  );
}
