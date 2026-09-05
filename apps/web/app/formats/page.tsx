import { currentUser } from '../../lib/api';
import { MarketingShell } from '../../components/MarketingShell';

/**
 * The supported-formats page.
 *
 * docs/08-clients.md calls this "the actual conversion driver" — consolidators
 * arrive searching "import Shearwater to …". So it is written for someone who
 * wants a yes or a no about their own file, and it gives them one: a format
 * that does not work says so, by name, with what to do instead.
 *
 * Every claim here is checked against packages/importers. Nothing is listed as
 * supported because it is on a roadmap — the landing page said Subsurface XML
 * worked, and it does not.
 */
export const metadata = {
  title: 'Supported formats — MyDiveLog',
  description:
    'UDDF from any dive computer, CSV and spreadsheet exports in any column layout, and ' +
    'MyDiveLog’s own JSON. What imports today, what does not yet, and what to do about it.',
};

type Row = {
  name: string;
  detail: string;
  status: 'yes' | 'no';
  note: string;
};

const IMPORT: Row[] = [
  {
    name: 'UDDF',
    detail: '.uddf, .xml',
    status: 'yes',
    note:
      'The open standard, written by Oceanic+, Suunto, Mares and others. Depth profiles, gas ' +
      'mixes, temperatures and coordinates all come across.',
  },
  {
    name: 'CSV and spreadsheet exports',
    detail: '.csv, tab- or semicolon-separated',
    status: 'yes',
    note:
      'Any column layout. Columns are matched by name, the mapping is shown before anything is ' +
      'written, and it is saved so the next export from the same tool needs no work.',
  },
  {
    name: 'MyDiveLog export',
    detail: '.json',
    status: 'yes',
    note: 'Our own full-fidelity format. Re-importing one is lossless, provenance included.',
  },
  {
    name: 'Subsurface XML',
    detail: '.xml',
    status: 'no',
    note:
      'Recognised on upload but not yet read — you get a clear message rather than a ' +
      'half-imported logbook. Subsurface also exports UDDF, and that route works today.',
  },
  {
    name: 'Garmin FIT',
    detail: '.fit',
    status: 'no',
    note:
      'Not yet. Garmin Connect exports UDDF for dive activities, which does work. Native FIT is ' +
      'planned because the binary carries more than the export does.',
  },
  {
    name: 'Shearwater Cloud',
    detail: 'sync or .db',
    status: 'no',
    note:
      'Not yet. Shearwater Cloud exports UDDF per dive or in bulk; that is the route today. A ' +
      'direct integration comes with the other continuous services.',
  },
];

const EXPORT: Row[] = [
  {
    name: 'MyDiveLog JSON',
    detail: '.json',
    status: 'yes',
    note: 'Everything, including which source each value came from and the values that did not win.',
  },
  {
    name: 'UDDF',
    detail: '.uddf',
    status: 'yes',
    note: 'The open standard, readable by Subsurface, MacDive and most desktop logbooks.',
  },
  {
    name: 'CSV',
    detail: '.csv',
    status: 'yes',
    note: 'One row per dive, in your own units, for a spreadsheet or anything that eats tables.',
  },
  {
    name: 'PDF logbook',
    detail: '.pdf',
    status: 'no',
    note: 'Not yet. A printable logbook with signature lines is planned.',
  },
];

export default async function Formats() {
  const user = await currentUser();

  return (
    <MarketingShell user={user}>
      <section className="hero">
        <h1>What MyDiveLog can read</h1>
        <p className="lede">
          If your format is not listed, the spreadsheet importer usually still gets it in — most
          tools can write a CSV, and MyDiveLog does not care what the columns are called.
        </p>
      </section>

      <section className="section">
        <h2>Importing</h2>
        <FormatTable caption="Formats MyDiveLog can import" rows={IMPORT} />
      </section>

      <section className="section">
        <h2>Exporting</h2>
        <p className="lede">
          Free, unlimited, and never behind a paid gate. If you leave, you leave with all of it.
        </p>
        <FormatTable caption="Formats MyDiveLog can export" rows={EXPORT} />
      </section>

      <section className="section">
        <h2>Files with mistakes in them</h2>
        <p className="lede">
          Real exports contain bugs, and a logbook that refuses them is a logbook you cannot use.
        </p>
        <div className="cards">
          <article>
            <h3>Timezone offsets that are wrong</h3>
            <p>
              One shipping export writes <code>-00:04</code> where it means −04:00, putting every
              dive four hours out. We detect the shape of that mistake, correct it against the
              site&rsquo;s own coordinates, and show you what changed before committing anything.
            </p>
          </article>
          <article>
            <h3>Columns that are really formulas</h3>
            <p>
              A spreadsheet built over years grows running totals and time-out columns computed from
              the others. Those are detected and left out, rather than stored as though a diver had
              recorded them.
            </p>
          </article>
          <article>
            <h3>Placeholder values</h3>
            <p>
              <code>N/A</code>, <code>0.0</code> for lead a watch never measured, a site name that
              is really an internal id. Each is recognised as an absence rather than a reading.
            </p>
          </article>
          <article>
            <h3>One bad row out of two hundred</h3>
            <p>
              A single unreadable date costs you that row and nothing else. You get the other 196
              dives and a note, not an error and a suggestion to check your file.
            </p>
          </article>
        </div>
      </section>

      <section className="section cta">
        <h2>Start with the messiest file you have</h2>
        <p className="lede">
          Nothing is written to your logbook until you have seen what the import proposes, and any
          import can be undone however long ago it ran.
        </p>
        <a className="button primary" href={user ? '/import' : '/signin'}>
          {user ? 'Import a file' : 'Sign in to begin'}
        </a>
      </section>
    </MarketingShell>
  );
}

const LABEL: Record<Row['status'], string> = { yes: 'Supported', no: 'Not yet' };

function FormatTable({ caption, rows }: { caption: string; rows: Row[] }) {
  return (
    <div className="table-scroll">
      <table className="formats">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Format</th>
            <th scope="col">Status</th>
            <th scope="col">What that means</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">
                {row.name}
                <span className="muted small">{row.detail}</span>
              </th>
              {/* The word carries the status, not the colour: a coloured dot
                  alone is invisible to a reader who cannot see it. */}
              <td>
                <span className={`status ${row.status}`}>{LABEL[row.status]}</span>
              </td>
              <td>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
