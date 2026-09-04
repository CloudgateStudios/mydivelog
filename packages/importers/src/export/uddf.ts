import { celsiusToKelvin } from '@mydivelog/domain';
import type { ExportableDive, Logbook } from './types.ts';

/**
 * UDDF 3.2 export.
 *
 * The escape hatch. A diver who cannot get their data out of a logbook is
 * being held by it, and the whole premise of this product is that they were
 * held by something else first.
 *
 * Deliberately written by hand rather than with an XML library. The document
 * is small, fixed and ours; a serializer would be another dependency in the
 * path of the one guarantee this file exists to make.
 */

export function exportUddf(logbook: Logbook, generatedAt = new Date()): string {
  const sites = collectSites(logbook.dives);
  const mixes = collectMixes(logbook.dives);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<uddf version="3.2.0" xmlns="http://www.streit.cc/uddf/3.2/">',
    '  <generator>',
    '    <name>MyDiveLog</name>',
    '    <manufacturer><name>MyDiveLog</name></manufacturer>',
    `    <datetime>${generatedAt.toISOString()}</datetime>`,
    '  </generator>',
    ...(sites.size > 0 ? renderSites(sites) : []),
    ...(mixes.size > 0 ? renderMixes(mixes) : []),
    '  <profiledata>',
    ...logbook.dives.flatMap((dive, index) => renderDive(dive, index, sites, mixes)),
    '  </profiledata>',
    '</uddf>',
    '',
  ].join('\n');
}

type SiteKey = string;
const siteKeyOf = (dive: ExportableDive): SiteKey | undefined => {
  const site = dive.site;
  if (!site) return undefined;
  if (site.name !== undefined) return `name:${site.name}`;
  if (site.lat !== undefined && site.lon !== undefined) return `geo:${site.lat},${site.lon}`;
  return undefined;
};

function collectSites(
  dives: readonly ExportableDive[],
): Map<SiteKey, { id: string; dive: ExportableDive }> {
  const out = new Map<SiteKey, { id: string; dive: ExportableDive }>();
  for (const dive of dives) {
    const key = siteKeyOf(dive);
    if (key === undefined || out.has(key)) continue;
    out.set(key, { id: `site_${out.size + 1}`, dive });
  }
  return out;
}

function collectMixes(
  dives: readonly ExportableDive[],
): Map<string, { id: string; o2: number; he?: number }> {
  const out = new Map<string, { id: string; o2: number; he?: number }>();
  for (const dive of dives) {
    for (const gas of dive.gases ?? []) {
      const key = `${gas.o2Fraction}:${gas.heFraction ?? 0}`;
      if (out.has(key)) continue;
      out.set(key, {
        id: `mix_${out.size + 1}`,
        o2: gas.o2Fraction,
        ...(gas.heFraction === undefined ? {} : { he: gas.heFraction }),
      });
    }
  }
  return out;
}

const renderSites = (sites: Map<SiteKey, { id: string; dive: ExportableDive }>): string[] => [
  '  <divesite>',
  ...[...sites.values()].flatMap(({ id, dive }) => {
    const site = dive.site ?? {};
    const geography = [
      site.lat === undefined ? undefined : `        <latitude>${site.lat}</latitude>`,
      site.lon === undefined ? undefined : `        <longitude>${site.lon}</longitude>`,
      site.altitudeM === undefined ? undefined : `        <altitude>${site.altitudeM}</altitude>`,
    ].filter((line): line is string => line !== undefined);

    return [
      `    <site id="${id}">`,
      `      <name>${escapeXml(site.name ?? id)}</name>`,
      ...(geography.length > 0 ? ['      <geography>', ...geography, '      </geography>'] : []),
      '    </site>',
    ];
  }),
  '  </divesite>',
];

const renderMixes = (mixes: Map<string, { id: string; o2: number; he?: number }>): string[] => [
  '  <gasdefinitions>',
  ...[...mixes.values()].flatMap(({ id, o2, he }) => [
    `    <mix id="${id}">`,
    `      <name>${o2 === 0.21 && !he ? 'air' : `ean${Math.round(o2 * 100)}`}</name>`,
    `      <o2>${o2}</o2>`,
    ...(he === undefined ? [] : [`      <he>${he}</he>`]),
    '    </mix>',
  ]),
  '  </gasdefinitions>',
];

function renderDive(
  dive: ExportableDive,
  index: number,
  sites: Map<SiteKey, { id: string; dive: ExportableDive }>,
  mixes: Map<string, { id: string; o2: number; he?: number }>,
): string[] {
  const siteKey = siteKeyOf(dive);
  const siteId = siteKey === undefined ? undefined : sites.get(siteKey)?.id;
  const gas = dive.gases?.[0];
  const mixId =
    gas === undefined ? undefined : mixes.get(`${gas.o2Fraction}:${gas.heFraction ?? 0}`)?.id;

  const before = [
    siteId === undefined ? undefined : `        <link ref="${siteId}"/>`,
    // Written with a correct offset, unlike the export that started all this.
    dive.startTimeLocal === undefined
      ? undefined
      : `        <datetime>${localIso(dive.startTimeLocal, dive.tzOffsetMinutes)}</datetime>`,
  ].filter((line): line is string => line !== undefined);

  const after = [
    dive.waterTempMinC === undefined
      ? undefined
      : `        <lowesttemperature>${round(celsiusToKelvin(dive.waterTempMinC), 2)}</lowesttemperature>`,
    dive.maxDepthM === undefined
      ? undefined
      : `        <greatestdepth>${dive.maxDepthM}</greatestdepth>`,
    dive.avgDepthM === undefined
      ? undefined
      : `        <averagedepth>${dive.avgDepthM}</averagedepth>`,
    dive.durationS === undefined
      ? undefined
      : `        <diveduration>${dive.durationS}</diveduration>`,
    // Weight is omitted when unknown rather than written as 0.0, which is the
    // bug that made the seed file's 96 dives claim no lead at all.
    dive.weightKg === undefined
      ? undefined
      : `        <equipmentused><leadquantity>${dive.weightKg}</leadquantity></equipmentused>`,
  ].filter((line): line is string => line !== undefined);

  return [
    '    <repetitiongroup>',
    `      <dive id="dive_${index + 1}">`,
    ...(before.length > 0
      ? [
          '        <informationbeforedive>',
          ...before.map(indent),
          '        </informationbeforedive>',
        ]
      : []),
    ...renderSamples(dive, mixId),
    ...(after.length > 0
      ? ['        <informationafterdive>', ...after.map(indent), '        </informationafterdive>']
      : []),
    '      </dive>',
    '    </repetitiongroup>',
  ];
}

const indent = (line: string): string => `  ${line.trimStart()}`.padStart(line.length + 2, ' ');

function renderSamples(dive: ExportableDive, mixId?: string): string[] {
  const timeS = dive.profile?.timeS;
  const depthM = dive.profile?.depthM;
  if (!timeS || !depthM || timeS.length === 0) return [];
  const tempC = dive.profile?.tempC;

  return [
    '        <samples>',
    ...timeS.flatMap((t, i) => [
      '          <waypoint>',
      `            <divetime>${t}</divetime>`,
      `            <depth>${depthM[i] ?? 0}</depth>`,
      ...(tempC?.[i] === undefined
        ? []
        : [
            `            <temperature>${round(celsiusToKelvin(tempC[i] as number), 2)}</temperature>`,
          ]),
      ...(i === 0 && mixId ? [`            <switchmix ref="${mixId}"/>`] : []),
      '          </waypoint>',
    ]),
    '        </samples>',
  ];
}

/** `2026-03-06T19:07:42.000-04:00` — local wall clock plus a real offset. */
function localIso(local: Date, offsetMinutes?: number): string {
  const base = local.toISOString().replace(/Z$/, '');
  if (offsetMinutes === undefined) return base;
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${base}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const round = (value: number, places: number): number => Number(value.toFixed(places));

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
