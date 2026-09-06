import { redirect } from 'next/navigation';
import { units } from '@mydivelog/domain';
import { apiJson, currentUser } from '../../lib/api';
import { AppHeader } from '../../components/AppHeader';
import { BarChart, type Bar } from '../../components/BarChart';
import { withUnits } from '../../lib/units';

export const dynamic = 'force-dynamic';

type Overview = {
  totals: {
    diveCount: number;
    totalBottomTimeS: number;
    maxDepthM: number | null;
    longestDiveS: number | null;
    averageDepthM: number | null;
  };
  byYear: { year: number; dives: number; bottomTimeS: number }[];
  byMonth: { month: number; name: string; dives: number }[];
  depthHistogram: { fromM: number; toM: number; dives: number }[];
  milestone: { at: number; remaining: number } | null;
  streak: { days: number; from: string; to: string } | null;
  firstDive: string | null;
  lastDive: string | null;
};

/**
 * Depth buckets in the diver's own units.
 *
 * 10 ft or 5 m — round numbers in the unit they think in. Bucketing in metres
 * and relabelling gives boundaries of 16.4 and 32.8 ft, which is nobody's
 * mental model of depth, so the bucket width is chosen here and sent to the
 * API rather than converted afterwards.
 */
const FEET_BUCKET_M = 3.048;

export default async function Stats() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const u = await withUnits();
  const feet = u.prefs.depthUnit ? u.prefs.depthUnit === 'ft' : u.prefs.unitSystem === 'imperial';
  const bucketM = feet ? FEET_BUCKET_M : 5;

  const stats = await apiJson<Overview>(`/v1/stats/overview?bucketM=${bucketM}`).catch(
    () => undefined,
  );

  if (!stats || stats.totals.diveCount === 0) {
    return (
      <>
        <AppHeader user={user} />
        <main id="main" tabIndex={-1} className="app">
          <h1>Stats</h1>
          <p className="muted">
            Nothing to count yet. <a href="/import">Import a file</a> and this fills in.
          </p>
        </main>
      </>
    );
  }

  const { totals } = stats;

  const yearBars: Bar[] = stats.byYear.map((row) => ({
    label: String(row.year),
    value: row.dives,
    caption: String(row.year),
  }));

  const monthBars: Bar[] = stats.byMonth.map((row) => ({
    // Three letters, because twelve full month names do not fit and a chart
    // that needs turning your head is not a chart.
    label: row.name.slice(0, 3),
    value: row.dives,
    caption: row.name,
  }));

  const deepest = Math.max(...stats.depthHistogram.map((b) => b.dives));
  const depthBars: Bar[] = stats.depthHistogram.map((bucket) => ({
    label: units.depth(bucket.fromM, u.prefs).value.toFixed(0),
    value: bucket.dives,
    caption: `${u.depth(bucket.fromM)} to ${u.depth(bucket.toM)}`,
    highlight: bucket.dives === deepest,
  }));

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <h1>Stats</h1>
        <p className="lede">
          {totals.diveCount} dives between {stats.firstDive?.slice(0, 10)} and{' '}
          {stats.lastDive?.slice(0, 10)}.
        </p>

        <dl className="facts stat-grid">
          <div>
            <dt>Dives</dt>
            <dd>{totals.diveCount}</dd>
          </div>
          <div>
            <dt>Time underwater</dt>
            <dd>{hours(totals.totalBottomTimeS)}</dd>
          </div>
          <div>
            <dt>Deepest</dt>
            <dd>{u.depth(totals.maxDepthM)}</dd>
          </div>
          <div>
            <dt>Average depth</dt>
            <dd>{u.depth(totals.averageDepthM)}</dd>
          </div>
          <div>
            <dt>Longest dive</dt>
            <dd>{u.duration(totals.longestDiveS)}</dd>
          </div>
          {stats.streak && (
            <div>
              <dt>Longest run of diving days</dt>
              <dd>
                {stats.streak.days} {stats.streak.days === 1 ? 'day' : 'days'}
                <span className="muted small"> from {stats.streak.from.slice(0, 10)}</span>
              </dd>
            </div>
          )}
        </dl>

        {stats.milestone && (
          <p className="notice">
            {stats.milestone.remaining} {stats.milestone.remaining === 1 ? 'dive' : 'dives'} to
            number {stats.milestone.at}.
          </p>
        )}

        <h2>Dives by year</h2>
        <p className="muted small">
          {/* Empty years are drawn as gaps rather than skipped. A logbook with
              a decade missing should look like one. */}
          Years with no dives are shown, because a gap is part of the shape.
        </p>
        <BarChart bars={yearBars} title="Dives by year" valueLabel="Year" />

        <h2>How deep you go</h2>
        <p className="muted small">
          Buckets of {feet ? '10 ft' : '5 m'}. Dives with no recorded depth are left out rather than
          counted as shallow.
        </p>
        <BarChart bars={depthBars} title="Dives by depth" valueLabel="Depth" />

        <h2>When in the year</h2>
        <BarChart bars={monthBars} title="Dives by month" valueLabel="Month" />
      </main>
    </>
  );
}

/** Bottom time reads in hours long before it reads in seconds. */
function hours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, '0')} min`;
}
