#!/usr/bin/env node
/**
 * Builds the committed fixtures from the diver's real export files.
 *
 * Reduces volume and shifts identifying detail while preserving every data
 * hazard the import engine has to survive. See fixtures/README.md.
 *
 * Usage:
 *   node fixtures/scripts/redact.mjs <workbook.json> <export.uddf>
 *
 * The workbook argument is the JSON dump of the Dive Data sheet, since parsing
 * xlsx is the importer's job rather than this script's.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Fixed offset applied to every coordinate. Relative geometry survives, so site
// clustering still behaves identically; absolute position does not identify a
// real place.
const LAT_SHIFT = -7.331;
const LON_SHIFT = 12.884;

const KEEP_TAIL = 14; // trailing rows: the window that overlaps the UDDF export
const KEEP_DIVES = 6; // UDDF dives to keep
const KEEP_WAYPOINTS = 40; // waypoints per dive after downsampling

function redactSpreadsheet(workbookJsonPath) {
  const sheet = JSON.parse(readFileSync(workbookJsonPath, 'utf8'))['Dive Data'];
  const [header, ...rows] = sheet;

  // Rows are chosen for what they exercise, not for where they sit. Taking a
  // positional slice silently drops hazards: the trailing rows are all one
  // trip and contain no "N/A" sites, no multi-value dive types and no "Dift".
  const col = (name) => header.indexOf(name);
  const hazards = [
    ['non-numeric dive number', (r) => r[col('Dive Number')] === 'x'],
    ['N/A used as a null', (r) => r[col('Dive Site')] === 'N/A'],
    ['typo in taxonomy', (r) => String(r[col('Dive Type')] ?? '').includes('Dift')],
    ['multi-value tag column', (r) => String(r[col('Dive Type')] ?? '').includes(', ')],
    ['comma inside a value', (r) => String(r[col('Dive Site')] ?? '').includes(',')],
    ['air temperature present', (r) => r[col('Air Temperature (F)')] != null],
    ['no EAN percentage', (r) => r[col('EAN %')] == null],
  ];

  const kept = new Map(); // row index -> row, deduplicated
  for (const [label, matches] of hazards) {
    const found = rows.filter(matches).slice(0, 2);
    if (found.length === 0) throw new Error(`hazard no longer present in source: ${label}`);
    for (const r of found) kept.set(rows.indexOf(r), r);
  }
  for (const r of rows.slice(-KEEP_TAIL)) kept.set(rows.indexOf(r), r);

  const ordered = [...kept.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);

  const quote = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
  };

  const csv = [header, ...ordered].map((r) => r.map(quote).join(',')).join('\n');
  writeFileSync(join(OUT, 'spreadsheet-sample.csv'), csv + '\n');
  const serialToMonth = (serial) =>
    new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(serial)) * 86400000)
      .toISOString()
      .slice(0, 7);
  const months = [...new Set(ordered.map((r) => serialToMonth(r[col('Date')])))];
  return { rows: ordered.length, months };
}

function redactUddf(uddfPath) {
  const xml = readFileSync(uddfPath, 'utf8');

  const sites = [...xml.matchAll(/<site id="([^"]+)">[\s\S]*?<\/site>/g)];
  const dives = [...xml.matchAll(/<dive id="([^"]+)">[\s\S]*?<\/dive>/g)];
  const mixes = [...xml.matchAll(/<mix id="([^"]+)">[\s\S]*?<\/mix>/g)];

  // The export lists dives newest-first, so a positional slice takes the
  // OLDEST dives — which would leave zero overlap with the spreadsheet tail and
  // quietly turn the merge fixture into two unrelated files. Sort explicitly.
  const dateOf = (block) => block.match(/<datetime>([^<]+)<\/datetime>/)?.[1] ?? '';
  const byDateDesc = [...dives].sort((a, b) => dateOf(b[0]).localeCompare(dateOf(a[0])));
  const keptDives = byDateDesc.slice(0, KEEP_DIVES);
  const keptIds = new Set(keptDives.map((d) => d[1]));

  const shift = (block) =>
    block
      .replace(
        /<latitude>([-\d.]+)<\/latitude>/g,
        (_, v) => `<latitude>${(Number(v) + LAT_SHIFT).toFixed(6)}</latitude>`,
      )
      .replace(
        /<longitude>([-\d.]+)<\/longitude>/g,
        (_, v) => `<longitude>${(Number(v) + LON_SHIFT).toFixed(6)}</longitude>`,
      );

  // Downsample waypoints, keeping the first and last so depth and duration
  // summaries stay recognisable.
  const thin = (dive) => {
    const wps = [...dive.matchAll(/<waypoint>[\s\S]*?<\/waypoint>/g)].map((m) => m[0]);
    if (wps.length <= KEEP_WAYPOINTS) return dive;
    const step = Math.ceil(wps.length / KEEP_WAYPOINTS);
    const picked = wps.filter((_, i) => i % step === 0);
    if (picked.at(-1) !== wps.at(-1)) picked.push(wps.at(-1));
    return dive.replace(
      /<samples>[\s\S]*?<\/samples>/,
      `<samples>\n${picked.join('\n')}\n</samples>`,
    );
  };

  const keptSites = sites.filter((s) => keptIds.has(s[1].replace('site_', 'dive_')));
  const keptMixes = mixes.filter(
    (m) => m[1] === 'air' || keptIds.has(m[1].replace(/^nitrox_/, 'dive_')),
  );

  const out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<uddf version="3.2.1" xmlns="http://www.streit.cc/uddf/3.2/">
  <generator>
    <manufacturer><contact><homepage>https://example.invalid/</homepage></contact></manufacturer>
    <version>0.0.1</version>
    <datetime>2026-08-26T16:47:42.380Z</datetime>
  </generator>
  <divesite>
${keptSites.map((s) => shift(s[0])).join('\n')}
  </divesite>
  <gasdefinitions>
${keptMixes.map((m) => m[0]).join('\n')}
  </gasdefinitions>
  <profiledata>
${keptDives.map((d) => `<repetitiongroup>\n${thin(shift(d[0]))}\n</repetitiongroup>`).join('\n')}
  </profiledata>
</uddf>
`;
  writeFileSync(join(OUT, 'uddf-sample.uddf'), out);
  return {
    dives: keptDives.length,
    sites: keptSites.length,
    months: [...new Set(keptDives.map((d) => dateOf(d[0]).slice(0, 7)))],
  };
}

const [workbookJson, uddf] = process.argv.slice(2);
if (!workbookJson || !uddf) {
  console.error('usage: redact.mjs <workbook.json> <export.uddf>');
  process.exit(1);
}
const csvMonths = redactSpreadsheet(workbookJson);
const uddfResult = redactUddf(uddf);
console.log('spreadsheet rows:', csvMonths.rows, 'months:', csvMonths.months.join(', '));
console.log('uddf dives:', uddfResult.dives, 'months:', uddfResult.months.join(', '));

// The point of these two files is that they describe some of the same dives.
// Without shared months there is nothing for the merge engine to reconcile.
const overlap = uddfResult.months.filter((m) => csvMonths.months.includes(m));
if (overlap.length === 0) {
  console.error('FAILED: fixtures share no months — there is no merge case to test');
  process.exit(1);
}
console.log('overlapping months:', overlap.join(', '));
