import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The panel reads the database and writes through the API.
 *
 * That boundary is the mechanism behind an acceptance criterion — "every staff
 * action appears in the audit log" — because the audit row is written by the
 * same transaction as the change, and only `@mydivelog/db`'s admin repository
 * is on that side of it. A `db.site.update(...)` here would be a staff change
 * with no audit row and nothing would notice.
 *
 * A convention cannot hold that line for a year. This can.
 */

const ROOT = join(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.next', 'dist']);

/** Prisma's writing verbs. `upsert` and `createMany` included deliberately. */
const WRITES = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'executeRaw',
  'executeRawUnsafe',
  '$transaction',
];

/**
 * Comments are not code.
 *
 * Both rules below grep source text, and a comment explaining a rule names the
 * very pattern the rule forbids — which failed this suite the first time one
 * was written. Stripping comments keeps the rules enforcing what the program
 * does rather than what it says about itself.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

describe('the admin panel', () => {
  /**
   * The rule above greps for `db.<model>.<verb>(`, which a repository hides.
   * `createSuggestionRepository(db).pending()` is a read — and the object it
   * returns also has `decide()`, which renames a site. Handing this app a
   * client wrapped in something that can write puts the whole boundary one
   * autocomplete away from gone, with nothing to notice.
   */
  it('never hands the database to a repository that can write', () => {
    const offenders: string[] = [];
    for (const file of sources(ROOT)) {
      const text = code(readFileSync(file, 'utf8'));
      if (/\bcreate[A-Za-z]*Repository\s*\(\s*db\s*\)/.test(text)) {
        offenders.push(`${file.replace(ROOT, 'apps/admin')}: create…Repository(db)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never writes to the database directly', () => {
    const offenders: string[] = [];

    for (const file of sources(ROOT)) {
      const text = code(readFileSync(file, 'utf8'));
      for (const verb of WRITES) {
        // `db.<model>.<verb>(` — the shape every Prisma write takes through
        // the client this app exports.
        const pattern = new RegExp(`\\bdb\\.[A-Za-z]+\\.${verb}\\s*\\(|\\bdb\\.${verb}\\s*\\(`);
        if (pattern.test(text)) {
          offenders.push(`${file.replace(ROOT, 'apps/admin')}: db…${verb}()`);
        }
      }
    }

    expect(
      offenders,
      'Staff changes go through /v1/admin, where the audit row shares a transaction with the ' +
        'change. See apps/admin/lib/api.ts.',
    ).toEqual([]);
  });

  it('is looking at the files it thinks it is', () => {
    // A path bug would make the check above pass by finding nothing, which is
    // the failure mode of every test that greps a directory.
    const files = sources(ROOT);
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.endsWith(join('app', 'audit', 'page.tsx')))).toBe(true);
  });
});
