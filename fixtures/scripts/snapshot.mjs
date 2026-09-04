#!/usr/bin/env node
/**
 * Regenerates the golden snapshot from the committed fixtures.
 *
 *   pnpm --filter "@mydivelog/*" build && node fixtures/scripts/snapshot.mjs
 *
 * The snapshot is the merged result of both seed files: the single
 * highest-value test in the project, verified by hand once and asserted
 * against on every change to the import engine after that.
 *
 * Regenerating is not a way to make a failing test pass. A diff here means the
 * engine now merges someone's dive history differently, and that difference
 * has to be read and understood before it is committed.
 *
 * The work itself lives in packages/importers/src/snapshot.ts. Keeping it
 * there rather than here is what lets the golden test import it from source:
 * a test reaching through the package's own dist depends on its own build,
 * which passes locally where a stale dist exists and fails in CI where nothing
 * has built it yet.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// By relative path, not by package name. A root dependency on a workspace
// package makes every container image install it, and none of them use it.
const { buildSnapshot } = await import('../../packages/importers/dist/snapshot.js');

const read = (name) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const snapshot = buildSnapshot({
  uddf: read('uddf-sample.uddf'),
  spreadsheet: read('spreadsheet-sample.csv'),
});

const target = fileURLToPath(new URL('../expected/merged.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`wrote ${target}`);
