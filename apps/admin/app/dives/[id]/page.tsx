import { notFound, redirect } from 'next/navigation';
import { decodeProfile } from '@mydivelog/domain';
import { ProfileChart } from '../../../components/ProfileChart';
import { readProfileBlob, storageConfigured } from '../../../lib/storage';
import { db, DIVE_SELECT, redactProvenanceValue, WITHHELD_FIELD_PATHS } from '../../../lib/db';
import { apiSend, withDone, withError } from '../../../lib/api';
import { Notice, SubmitButton } from '../../../components/StaffForm';
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
export default async function DiveDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { id } = await params;
  const { error, done } = await searchParams;

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

  const here = `/dives/${id}`;

  async function correct(formData: FormData): Promise<void> {
    'use server';
    const result = await apiSend(`/v1/admin/dives/${id}`, {
      method: 'PATCH',
      body: {
        diveNumber: int(formData.get('diveNumber')) ?? undefined,
        startTimeLocal: local(formData.get('startTimeLocal')) ?? undefined,
        tzOffsetMinutes: int(formData.get('tzOffsetMinutes')) ?? undefined,
        maxDepthM: num(formData.get('maxDepthM')),
        avgDepthM: num(formData.get('avgDepthM')),
        durationS: minutesToSeconds(formData.get('durationMin')),
        waterTempMinC: num(formData.get('waterTempMinC')),
        airTempC: num(formData.get('airTempC')),
        visibilityM: num(formData.get('visibilityM')),
        weightKg: num(formData.get('weightKg')),
        waterType: str(formData.get('waterType')),
        reason: str(formData.get('reason')) ?? undefined,
      },
    });
    redirect(result.ok ? withDone(here, 'Saved.') : withError(here, result.detail));
  }

  async function remove(formData: FormData): Promise<void> {
    'use server';
    const result = await apiSend(here.replace('/dives/', '/v1/admin/dives/'), {
      method: 'DELETE',
      body: { reason: String(formData.get('reason') ?? '') },
    });
    redirect(result.ok ? withDone(here, 'Dive deleted.') : withError(here, result.detail));
  }

  async function restore(): Promise<void> {
    'use server';
    const result = await apiSend(`/v1/admin/dives/${id}/restore`, { method: 'POST' });
    redirect(result.ok ? withDone(here, 'Dive restored.') : withError(here, result.detail));
  }

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
        )}{' '}
        · <a href={`/audit?entityType=dive&entityId=${dive.id}`}>staff history</a>
      </p>

      <Notice {...(error ? { error } : {})} {...(done ? { done } : {})} />

      {dive.deletedAt ? (
        <div className="panel">
          <p className="empty">
            <span className="tag bad">deleted</span> {dateTime(dive.deletedAt)}. The row and its
            provenance are intact — a soft delete is a tombstone, which is what lets an offline
            client learn the dive is gone.
          </p>
          <form action={restore} className="stack">
            <SubmitButton>Restore this dive</SubmitButton>
          </form>
        </div>
      ) : (
        <>
          <h2>Correct</h2>
          <p className="lede">
            The fields an import can get wrong. Notes, rating, trip, gear and buddies are absent:
            those are things the diver wrote rather than things a parser produced, and there is no
            support question whose answer is staff editing them.
          </p>
          {dive.sources.length > 0 && (
            <p className="notice warn" role="note">
              <strong>
                This dive has {dive.sources.length} source{dive.sources.length === 1 ? '' : 's'}.
              </strong>{' '}
              A correction is applied directly rather than recorded as a source, so committing or
              reverting an import that touches this dive recomputes every field from the sources
              below and takes the correction with it. Fixing the source data is the durable answer;
              this is the quick one.
            </p>
          )}
          <div className="panel">
            <form action={correct} className="stack">
              <div className="row">
                <label>
                  <span>Dive number</span>
                  <input
                    name="diveNumber"
                    type="number"
                    min={1}
                    defaultValue={dive.diveNumber}
                    required
                  />
                </label>
                <label>
                  <span>Start (local wall clock)</span>
                  <input
                    name="startTimeLocal"
                    type="datetime-local"
                    step={1}
                    defaultValue={localInput(dive.startTimeLocal)}
                    required
                  />
                </label>
                <label>
                  <span>Offset (minutes)</span>
                  <input
                    name="tzOffsetMinutes"
                    type="number"
                    min={-840}
                    max={840}
                    defaultValue={dive.tzOffsetMinutes}
                    required
                  />
                </label>
              </div>
              <p className="hint">
                The offset is minutes, not hours: −240 is −04:00. The sample UDDF writes
                &ldquo;−00:04&rdquo; meaning −04:00, which is the mistake this field usually exists
                to undo.
              </p>

              <div className="row">
                <label>
                  <span>Max depth (m)</span>
                  <input
                    name="maxDepthM"
                    type="number"
                    step="any"
                    min={0}
                    defaultValue={dive.maxDepthM ?? ''}
                  />
                </label>
                <label>
                  <span>Avg depth (m)</span>
                  <input
                    name="avgDepthM"
                    type="number"
                    step="any"
                    min={0}
                    defaultValue={dive.avgDepthM ?? ''}
                  />
                </label>
                <label>
                  <span>Duration (minutes)</span>
                  <input
                    name="durationMin"
                    type="number"
                    step="any"
                    min={0}
                    defaultValue={dive.durationS === null ? '' : dive.durationS / 60}
                  />
                </label>
              </div>

              <div className="row">
                <label>
                  <span>Water temp (°C)</span>
                  <input
                    name="waterTempMinC"
                    type="number"
                    step="any"
                    defaultValue={dive.waterTempMinC ?? ''}
                  />
                </label>
                <label>
                  <span>Air temp (°C)</span>
                  <input
                    name="airTempC"
                    type="number"
                    step="any"
                    defaultValue={dive.airTempC ?? ''}
                  />
                </label>
                <label>
                  <span>Visibility (m)</span>
                  <input
                    name="visibilityM"
                    type="number"
                    step="any"
                    min={0}
                    defaultValue={dive.visibilityM ?? ''}
                  />
                </label>
                <label>
                  <span>Weight (kg)</span>
                  <input
                    name="weightKg"
                    type="number"
                    step="any"
                    min={0}
                    defaultValue={dive.weightKg ?? ''}
                  />
                </label>
              </div>

              <label>
                <span>Water type</span>
                <select name="waterType" defaultValue={dive.waterType ?? ''}>
                  <option value="">—</option>
                  <option value="salt">salt</option>
                  <option value="fresh">fresh</option>
                  <option value="brackish">brackish</option>
                </select>
              </label>

              <label>
                <span>Reason (optional)</span>
                <input
                  name="reason"
                  maxLength={200}
                  placeholder="offset was -00:04 in the source"
                />
              </label>

              <div className="actions">
                <SubmitButton>Save</SubmitButton>
              </div>
            </form>
          </div>

          <div className="panel">
            <details>
              <summary>Delete this dive</summary>
              <form action={remove} className="stack">
                <p className="hint">
                  Soft. The row, its profile and its provenance all stay, and the diver&rsquo;s
                  offline clients get a tombstone rather than silence.
                </p>
                <label>
                  <span>Reason</span>
                  <input name="reason" required minLength={3} maxLength={200} />
                </label>
                <SubmitButton danger>Delete dive #{dive.diveNumber}</SubmitButton>
              </form>
            </details>
          </div>
        </>
      )}

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

/** A datetime-local input wants `YYYY-MM-DDTHH:MM:SS` and no zone. */
const localInput = (value: Date): string => value.toISOString().slice(0, 19);

const local = (value: FormDataEntryValue | null): string | null => {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  // The browser omits seconds when they are zero; the contract wants them.
  return text.length === 16 ? `${text}:00` : text;
};

const int = (value: FormDataEntryValue | null): number | null => {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Empty means "no value", not zero — the difference between unknown and 0 m. */
const num = (value: FormDataEntryValue | null): number | null => {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Shown in minutes because that is how a diver reads it; stored in seconds. */
const minutesToSeconds = (value: FormDataEntryValue | null): number | null => {
  const parsed = num(value);
  return parsed === null ? null : Math.round(parsed * 60);
};

const str = (value: FormDataEntryValue | null): string | null => {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};
