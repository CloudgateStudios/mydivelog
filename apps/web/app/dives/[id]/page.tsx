import { notFound, redirect } from 'next/navigation';
import { apiJson, currentUser } from '../../../lib/api';
import { ProfileChart } from '../../../components/ProfileChart';
import { AppHeader } from '../../../components/AppHeader';
import { withUnits } from '../../../lib/units';

export const dynamic = 'force-dynamic';

type Detail = {
  id: string;
  diveNumber: number;
  startTimeLocal: string;
  startTimeUtc: string;
  tzOffsetMinutes: number;
  durationS: number | null;
  maxDepthM: number | null;
  avgDepthM: number | null;
  waterTempMinC: number | null;
  airTempC: number | null;
  visibilityM: number | null;
  weightKg: number | null;
  waterType: string | null;
  rating: number | null;
  notes: string | null;
  hasContestedFields: boolean;
  site: { id: string; name: string; latitude: number | null; longitude: number | null } | null;
  tags: { slug: string; label: string }[];
  buddies: string[];
  profile: { sampleCount: number } | null;
  sources: { sourceKind: string; sourceRef: string | null; recordedAt: string }[];
  provenance: {
    fieldPath: string;
    value: unknown;
    isSelected: boolean;
    sourceKind: string;
  }[];
};

type Series = { timeS: number[]; depthM: number[]; tempC?: number[] };

export default async function DiveDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const { id } = await params;
  const u = await withUnits();
  const dive = await apiJson<Detail>(`/v1/dives/${id}`).catch(() => undefined);
  if (!dive) notFound();

  // The samples are a separate request, and a dive whose blob is unreadable
  // still shows everything else rather than failing whole.
  const series = dive.profile
    ? await apiJson<Series>(`/v1/dives/${id}/profile`).catch(() => undefined)
    : undefined;

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <p className="crumb">
          <a href="/logbook">← Logbook</a>
        </p>

        <h1>
          Dive #{dive.diveNumber}
          {dive.site && <span className="muted"> · {dive.site.name}</span>}
        </h1>
        <p className="lede">
          {formatLocal(dive.startTimeLocal)}{' '}
          <span className="muted">{offset(dive.tzOffsetMinutes)}</span>
          {dive.maxDepthM !== null && ` · ${u.depth(dive.maxDepthM)}`}
          {dive.durationS !== null && ` · ${u.duration(dive.durationS)}`}
        </p>

        {series && (
          <section>
            <h2>Depth profile</h2>
            <ProfileChart series={series} units={u} />
          </section>
        )}
        {dive.profile && !series && (
          <p className="notice">
            This dive has a recorded profile, but its samples could not be read just now.
          </p>
        )}

        <section>
          <h2>Details</h2>
          <dl className="facts">
            <Fact
              label="Started"
              value={`${formatLocal(dive.startTimeLocal)} ${offset(dive.tzOffsetMinutes)}`}
            />
            <Fact label="Duration" value={u.duration(dive.durationS)} />
            <Fact label="Max depth" value={u.depth(dive.maxDepthM)} />
            <Fact label="Average depth" value={u.depth(dive.avgDepthM)} />
            <Fact label="Water temperature" value={u.temperature(dive.waterTempMinC)} />
            <Fact label="Air temperature" value={u.temperature(dive.airTempC)} />
            <Fact label="Visibility" value={u.depth(dive.visibilityM)} />
            <Fact label="Weight" value={u.weight(dive.weightKg)} />
            <Fact label="Water" value={dive.waterType ?? '—'} />
            <Fact label="Site" value={dive.site?.name ?? '—'} />
            <Fact
              label="Coordinates"
              value={
                dive.site?.latitude != null && dive.site.longitude != null
                  ? `${dive.site.latitude.toFixed(5)}, ${dive.site.longitude.toFixed(5)}`
                  : '—'
              }
            />
            <Fact label="Tags" value={dive.tags.map((t) => t.label).join(', ') || '—'} />
            <Fact label="Buddies" value={dive.buddies.join(', ') || '—'} />
          </dl>
        </section>

        {dive.notes && (
          <section>
            <h2>Notes</h2>
            <p className="notes">{dive.notes}</p>
          </section>
        )}

        <Provenance dive={dive} u={u} />
      </main>
    </>
  );
}

/**
 * Where each value came from.
 *
 * The reason this product exists is that two sources describe the same dive
 * differently, so "why does it say 14.099 when I wrote 46 feet" has to have an
 * answer on the page rather than in a support email. The value that did not
 * win is shown too, because it was not wrong — it was rounded.
 */
function Provenance({ dive, u }: { dive: Detail; u: Awaited<ReturnType<typeof withUnits>> }) {
  if (dive.sources.length === 0) return null;

  const contested = new Map<string, Detail['provenance']>();
  for (const row of dive.provenance) {
    contested.set(row.fieldPath, [...(contested.get(row.fieldPath) ?? []), row]);
  }
  // Only fields where the sources actually said something different, at the
  // precision this diver is shown.
  //
  // A consequence worth knowing: in imperial, 14.099 m and 14.0208 m are both
  // 46 ft, so max depth stops being listed as a disagreement. That is correct
  // for this panel — it explains what is on the screen, and telling someone
  // two identical numbers disagree is confusing rather than rigorous. The
  // underlying values are unchanged and the admin panel still shows both.
  //
  // Filtering on "more than one source" alone listed duration twice at 2776
  // and start time twice at 19:07 — both sources agreeing, presented as a
  // disagreement. The comparison is on the *displayed* value, because two
  // timestamps a second apart are the same moment to a reader and a table that
  // says otherwise is just noise.
  const disagreements = [...contested.entries()]
    .filter(([fieldPath, rows]) => {
      const shown = new Set(rows.map((r) => display(fieldPath, r.value, u)));
      return shown.size > 1;
    })
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <section>
      <h2>Where this came from</h2>
      <p className="lede">
        {dive.sources.length === 1
          ? 'One source recorded this dive.'
          : `${dive.sources.length} sources recorded this dive, and each field takes the one that knows best.`}
      </p>

      <ul className="sources">
        {dive.sources.map((source, i) => (
          <li key={`${source.sourceKind}-${i}`}>
            <strong>{sourceName(source.sourceKind)}</strong>{' '}
            <span className="muted">recorded {formatLocal(source.recordedAt)}</span>
          </li>
        ))}
      </ul>

      {disagreements.length > 0 && (
        <>
          <h3>Fields the sources disagreed on</h3>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Shown</th>
                <th>Also recorded</th>
              </tr>
            </thead>
            <tbody>
              {disagreements.map(([fieldPath, rows]) => {
                const shown = rows.find((r) => r.isSelected);
                const others = rows.filter((r) => !r.isSelected);
                return (
                  <tr key={fieldPath}>
                    <td>{fieldLabel(fieldPath)}</td>
                    <td>
                      {display(fieldPath, shown?.value, u)}{' '}
                      <span className="muted">from {sourceName(shown?.sourceKind ?? '')}</span>
                    </td>
                    <td className="muted">
                      {others
                        .map(
                          (o) =>
                            `${display(fieldPath, o.value, u)} from ${sourceName(o.sourceKind)}`,
                        )
                        .join('; ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** A source kind is a format name; a diver thinks in terms of where it came from. */
const SOURCE_NAMES: Record<string, string> = {
  uddf: 'your dive computer',
  spreadsheet: 'your spreadsheet',
  xlsx: 'your spreadsheet',
  subsurface: 'Subsurface',
  mydivelog: 'a MyDiveLog export',
  manual: 'you, by hand',
};
const sourceName = (kind: string): string => SOURCE_NAMES[kind] ?? kind;

const FIELD_LABELS: Record<string, string> = {
  maxDepthM: 'Max depth',
  avgDepthM: 'Average depth',
  durationS: 'Duration',
  waterTempMinC: 'Water temperature',
  airTempC: 'Air temperature',
  visibilityM: 'Visibility',
  weightKg: 'Weight',
  gases: 'Gas',
  'site.name': 'Site',
  'site.lat': 'Latitude',
  'site.lon': 'Longitude',
  startTimeLocal: 'Start time',
  startTimeUtc: 'Start time (UTC)',
  tzOffsetMinutes: 'Timezone offset',
  notes: 'Notes',
  tags: 'Tags',
};
const fieldLabel = (path: string): string => FIELD_LABELS[path] ?? path;

/** Units per field, so a bare `2776` never appears next to the word Duration. */
const unitsFor = (
  u: Awaited<ReturnType<typeof withUnits>>,
): Record<string, (value: number) => string> => ({
  maxDepthM: (v) => u.depth(v),
  avgDepthM: (v) => u.depth(v),
  visibilityM: (v) => u.depth(v),
  durationS: (v) => u.duration(v),
  waterTempMinC: (v) => u.temperature(v),
  airTempC: (v) => u.temperature(v),
  weightKg: (v) => u.weight(v),
  tzOffsetMinutes: (v) => offset(v),
  'site.lat': (v) => v.toFixed(5),
  'site.lon': (v) => v.toFixed(5),
});

function display(
  fieldPath: string,
  value: unknown,
  u: Awaited<ReturnType<typeof withUnits>>,
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' && value.startsWith('@date:')) {
    return formatLocal(value.slice(6));
  }
  if (typeof value === 'number') {
    return unitsFor(u)[fieldPath]?.(value) ?? String(Number(value.toFixed(4)));
  }
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        typeof v === 'object' && v !== null && 'o2Fraction' in v
          ? `${Math.round((v as { o2Fraction: number }).o2Fraction * 100)}% oxygen`
          : String(v),
      )
      .join(', ');
  }
  return String(value);
}

const formatLocal = (iso: string): string => iso.replace('T', ' ').slice(0, 16);
const offset = (v: number | null): string => {
  if (v === null) return '';
  const sign = v < 0 ? '-' : '+';
  const abs = Math.abs(v);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};
