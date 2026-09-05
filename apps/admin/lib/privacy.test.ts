import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIVE_SELECT, WITHHELD_FIELD_PATHS, redactProvenanceValue } from './privacy';

/**
 * "Staff cannot see dive notes anywhere in the UI" is an acceptance criterion
 * for this phase, not a preference. A dive note is the most personal thing in
 * a logbook — who someone dived with, what went wrong, what frightened them —
 * and none of it is needed to debug an import.
 *
 * A convention would hold until the first person adds `notes: true` to a
 * select while chasing a bug. These tests are the mechanism.
 */

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const sources = globSync('{app,lib}/**/*.{ts,tsx}', { cwd: adminRoot })
  .filter((f) => !f.endsWith('.test.ts'))
  // privacy.ts names both fields because it is the rule; scanning it for
  // mentions of them is scanning the smoke detector for smoke. It has its own
  // assertions above.
  .filter((f) => !f.endsWith('privacy.ts'))
  .map((f) => ({ file: f, text: readFileSync(`${adminRoot}${f}`, 'utf8') }));

describe('the dive select', () => {
  it('omits notes and privateNotes', () => {
    expect(Object.keys(DIVE_SELECT)).not.toContain('notes');
    expect(Object.keys(DIVE_SELECT)).not.toContain('privateNotes');
  });

  it('still selects the fields the panel needs to be useful', () => {
    for (const field of ['maxDepthM', 'startTimeLocal', 'tzOffsetMinutes', 'hasContestedFields']) {
      expect(Object.keys(DIVE_SELECT)).toContain(field);
    }
  });
});

describe('provenance values', () => {
  it('withholds a note that arrives as a provenance row', () => {
    // Provenance stores the asserted value, so a `notes` row carries the note
    // itself. Rendering provenance unfiltered would leak exactly what the
    // select above is written to prevent.
    expect(redactProvenanceValue('notes', 'Saw a turtle')).toBe('[withheld]');
    expect(redactProvenanceValue('privateNotes', 'anything')).toBe('[withheld]');
  });

  it('passes everything else through unchanged', () => {
    expect(redactProvenanceValue('maxDepthM', 14.099)).toBe(14.099);
    expect(redactProvenanceValue('site.name', 'Angel City')).toBe('Angel City');
  });
});

describe('no page selects a note', () => {
  it('found the admin sources to check', () => {
    // Without this, a broken glob would turn the assertions below into a
    // silent pass.
    expect(sources.length).toBeGreaterThan(6);
  });

  it.each(sources)('$file', ({ text }) => {
    // Catches `notes: true` in a Prisma select and `dive.notes` in a render.
    expect(text).not.toMatch(/\bnotes:\s*true\b/);
    expect(text).not.toMatch(/\bprivateNotes\b(?!\s*\])/);
    expect(text).not.toMatch(/\bdive\.notes\b/);
  });

  it('never reads a whole dive without naming the fields', () => {
    // `findMany()` with no select returns every column, notes included.
    //
    // Two earlier versions of this were too weak, and a perturbation test
    // found both:
    //
    // Matching a balanced call expression with a regex stopped at the first
    // `})`, which in a query with a nested object comes well before the
    // `select:` it was looking for — it failed on correct code.
    //
    // Scanning a window for `select:` then passed when `select` was swapped
    // for `include`, because a nested relation in the same query brought its
    // own `select:` along. Requiring DIVE_SELECT by name is both simpler and
    // the actual rule: it is the only vetted field list, so a dive read that
    // does not use it has not been reviewed for what it exposes.
    for (const { file, text } of sources) {
      for (const match of text.matchAll(/db\.dive\.find\w+/g)) {
        const window = text.slice(match.index, match.index + 500);
        expect(window, `${file}: a dive query that does not use DIVE_SELECT`).toContain(
          'DIVE_SELECT',
        );
      }
    }
  });
});

describe('the withheld list', () => {
  it('names both note fields', () => {
    expect([...WITHHELD_FIELD_PATHS].sort()).toEqual(['notes', 'privateNotes']);
  });
});
