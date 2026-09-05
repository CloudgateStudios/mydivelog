import { redirect } from 'next/navigation';
import { apiFetch, currentUser } from '../../lib/api';
import { loadUnits } from '../../lib/units';
import { AppHeader } from '../../components/AppHeader';

export const dynamic = 'force-dynamic';

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const prefs = await loadUnits();
  const { saved } = await searchParams;

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
