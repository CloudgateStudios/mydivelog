import { redirect } from 'next/navigation';
import { apiFetch, apiJson, currentUser } from '../../lib/api';
import type { NumberingState } from '@mydivelog/contracts';
import { SubmitButton } from '../../components/SubmitButton';
import { loadUnits } from '../../lib/units';
import { AppHeader } from '../../components/AppHeader';

export const dynamic = 'force-dynamic';

/**
 * Renumbering, and whether it is worth doing.
 *
 * Its own component so the state is fetched only by the part that needs it,
 * and so the button can say what it will change rather than offering an
 * operation whose effect is invisible until afterwards.
 */
async function NumberingPanel() {
  const state = await apiJson<NumberingState>('/v1/dives/numbering').catch(() => undefined);

  async function renumber(): Promise<void> {
    'use server';
    await apiFetch('/v1/dives/renumber', { method: 'POST', body: JSON.stringify({ startAt: 1 }) });
    redirect('/settings?renumbered=1');
  }

  if (!state || state.diveCount === 0) {
    return <p className="muted small">Nothing to number yet.</p>;
  }

  return (
    <>
      <p className="muted small">
        {state.chronological
          ? `All ${state.diveCount} of your dives are numbered in date order.`
          : `${state.outOfOrder} of your ${state.diveCount} dives are numbered out of step with when they happened.`}
      </p>
      <div className="actions">
        <form action={renumber}>
          <SubmitButton className="button" pendingLabel="Renumbering…">
            {state.wouldChange === 0
              ? 'Renumber anyway'
              : `Renumber ${state.wouldChange} of ${state.diveCount} dives`}
          </SubmitButton>
        </form>
      </div>
      <p className="muted small">
        Only the numbers change; no dive is added, removed or altered. Renumbering also closes any
        gaps, so it can change more dives than are out of order.
      </p>
    </>
  );
}

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; renumbered?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const prefs = await loadUnits();
  const { saved, renumbered } = await searchParams;

  async function save(formData: FormData): Promise<void> {
    'use server';
    const value = (name: string): string | null => {
      const raw = formData.get(name);
      return raw === null || raw === '' ? null : String(raw);
    };

    await apiFetch('/v1/preferences', {
      method: 'PUT',
      body: JSON.stringify({
        unitSystem: value('unitSystem') ?? 'metric',
        depthUnit: value('depthUnit'),
        temperatureUnit: value('temperatureUnit'),
        weightUnit: value('weightUnit'),
        pressureUnit: value('pressureUnit'),
      }),
    });
    redirect('/settings?saved=1');
  }

  return (
    <>
      <AppHeader user={user} />
      <main id="main" tabIndex={-1} className="app">
        <h1>Settings</h1>

        {saved && <p className="notice">Saved. Every screen now uses these units.</p>}
        {renumbered && (
          <p className="notice" role="status">
            Renumbered. Your logbook now runs from 1, oldest first.
          </p>
        )}

        <form action={save}>
          <h2>Units</h2>
          <p className="lede">
            Everything is stored the same way whatever you choose here — this only changes what you
            are shown, and you can change it as often as you like.
          </p>

          <fieldset className="stack">
            <legend>System</legend>
            <Choice
              name="unitSystem"
              value="metric"
              current={prefs.unitSystem}
              label="Metric — metres, °C, kg"
            />
            <Choice
              name="unitSystem"
              value="imperial"
              current={prefs.unitSystem}
              label="Imperial — feet, °F, lb"
            />
          </fieldset>

          <h3>Exceptions</h3>
          <p className="muted small">
            Plenty of divers log depth in feet and still think in Celsius. Leave these alone to
            follow the system above.
          </p>

          <div className="facts">
            <Override
              name="depthUnit"
              label="Depth"
              current={prefs.depthUnit}
              options={[
                ['m', 'metres'],
                ['ft', 'feet'],
              ]}
            />
            <Override
              name="temperatureUnit"
              label="Temperature"
              current={prefs.temperatureUnit}
              options={[
                ['C', 'Celsius'],
                ['F', 'Fahrenheit'],
              ]}
            />
            <Override
              name="weightUnit"
              label="Weight"
              current={prefs.weightUnit}
              options={[
                ['kg', 'kilograms'],
                ['lb', 'pounds'],
              ]}
            />
            <Override
              name="pressureUnit"
              label="Pressure"
              current={prefs.pressureUnit}
              options={[
                ['bar', 'bar'],
                ['psi', 'psi'],
              ]}
            />
          </div>

          <p style={{ marginTop: '1.5rem' }}>
            <button className="button primary" type="submit" style={{ width: 'auto' }}>
              Save
            </button>
          </p>
        </form>

        <h2>Dive numbering</h2>
        <p className="lede">
          A dive number is the nth dive you have done, so number 1 is your oldest. Importing dives
          that are older than ones you already had leaves the numbering out of step — this puts it
          back in date order.
        </p>
        <NumberingPanel />

        <h2>Your data</h2>
        <p className="lede">
          Everything you have, in a format you can read elsewhere. No paid gate, ever.
        </p>
        <a className="button" href="/export" style={{ width: 'auto', display: 'inline-block' }}>
          Export your logbook
        </a>
      </main>
    </>
  );
}

function Choice({
  name,
  value,
  current,
  label,
}: {
  name: string;
  value: string;
  current: string;
  label: string;
}) {
  return (
    <label className="choice">
      <input type="radio" name={name} value={value} defaultChecked={current === value} />
      <span>{label}</span>
    </label>
  );
}

function Override({
  name,
  label,
  current,
  options,
}: {
  name: string;
  label: string;
  current: string | null | undefined;
  options: [string, string][];
}) {
  return (
    <div>
      <label htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={current ?? ''}>
        <option value="">Follow the system</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
