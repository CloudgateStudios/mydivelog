import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  applySentinels,
  checkRange,
  cleanSiteName,
  completeTime,
  emptyObservation,
  issue,
  kelvinToCelsius,
  OCEANIC_UDDF_SENTINELS,
  repairOffset,
  type DiveObservation,
  type ObservedGas,
  type ProfileSeries,
  type TzResolver,
} from '@mydivelog/domain';
import { parseUddfDateTime } from './datetime.ts';

/**
 * UDDF 3.x.
 *
 * The open standard, and the widest-supported one — which in practice means
 * every vendor writes it slightly differently and at least one writes it
 * wrong. The seed file is an Oceanic+ export whose UTC offsets are hours in
 * the minutes field; see `datetime.ts` and the timezone repair rule.
 */
export const UDDF_SOURCE_KIND = 'uddf';

export type UddfParseOptions = {
  /** Injected so this package needs no geographic database. */
  resolveTz?: TzResolver;
};

export type ParseResult = {
  observations: DiveObservation[];
  /** Problems with the file as a whole, as distinct from one dive. */
  fileIssues: ReturnType<typeof issue>[];
};

/** Elements that may appear once or many times, depending on the writer. */
const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const num = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const n = Number(typeof value === 'object' ? (value as { '#text'?: unknown })['#text'] : value);
  return Number.isFinite(n) ? n : undefined;
};

const text = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const raw = typeof value === 'object' ? (value as { '#text'?: unknown })['#text'] : value;
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  return s === '' ? undefined : s;
};

type UddfSite = { name?: string; lat?: number; lon?: number; altitudeM?: number };

export function parseUddf(xml: string, options: UddfParseOptions = {}): ParseResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    // Values stay as text: fast-xml-parser would happily read the site id
    // `site_69ab…` as a string but turn a depth of `0.0` into 0 and a
    // leadquantity of `0.0` into 0 too, and this pipeline needs to know which
    // numbers the file actually wrote.
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });

  // Validated before parsing, because the parser is lenient: it accepts a
  // truncated document like `<uddf><profiledata>` and returns a plausible
  // object tree from it. A half-downloaded file would otherwise import as an
  // empty logbook and look like a file with no dives in it.
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    const where = valid.err.line > 0 ? ` at line ${valid.err.line}` : '';
    return {
      observations: [],
      fileIssues: [
        issue('error', 'unparseable_xml', `This file is not valid XML${where}: ${valid.err.msg}`),
      ],
    };
  }

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    return {
      observations: [],
      fileIssues: [
        issue('error', 'unparseable_xml', `This file is not readable XML: ${String(err)}`),
      ],
    };
  }

  const root = doc['uddf'] as Record<string, unknown> | undefined;
  if (!root) {
    return {
      observations: [],
      fileIssues: [issue('error', 'not_uddf', 'This file has no <uddf> root element.')],
    };
  }

  const sites = readSites(root);
  const gases = readGases(root);
  const tankToGas = readTanks(root);

  const dives = asArray(
    (root['profiledata'] as Record<string, unknown> | undefined)?.['repetitiongroup'],
  ).flatMap((group) => asArray((group as Record<string, unknown>)['dive']));

  const observations = dives.map((dive, index) =>
    readDive(dive as Record<string, unknown>, index, { sites, gases, tankToGas }, options),
  );

  const fileIssues =
    observations.length === 0
      ? [issue('warning', 'no_dives', 'This UDDF file contains no dives.')]
      : [];

  return { observations, fileIssues };
}

function readSites(root: Record<string, unknown>): Map<string, UddfSite> {
  const out = new Map<string, UddfSite>();
  for (const site of asArray((root['divesite'] as Record<string, unknown> | undefined)?.['site'])) {
    const s = site as Record<string, unknown>;
    const id = text(s['@id']);
    if (!id) continue;
    const geography = s['geography'] as Record<string, unknown> | undefined;
    // The watch names every site after its own opaque id. The coordinates are
    // real; the name is not a name.
    const name = cleanSiteName(text(s['name']), id);
    const altitude = checkRange('site.altitudeM', num(geography?.['altitude']));
    out.set(id, {
      ...(name === undefined ? {} : { name }),
      ...pick('lat', num(geography?.['latitude'])),
      ...pick('lon', num(geography?.['longitude'])),
      ...pick('altitudeM', altitude.value),
    });
  }
  return out;
}

function readGases(root: Record<string, unknown>): Map<string, ObservedGas> {
  const out = new Map<string, ObservedGas>();
  for (const mix of asArray(
    (root['gasdefinitions'] as Record<string, unknown> | undefined)?.['mix'],
  )) {
    const m = mix as Record<string, unknown>;
    const id = text(m['@id']);
    const o2 = num(m['o2']);
    if (!id || o2 === undefined) continue;
    const he = num(m['he']);
    const label = text(m['name']);
    out.set(id, {
      o2Fraction: o2,
      ...(he === undefined || he === 0 ? {} : { heFraction: he }),
      ...(label === undefined ? {} : { label }),
    });
  }
  return out;
}

/** tank id → gas id, so a dive's tank link resolves to a mix. */
function readTanks(root: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === 'tankdata') {
        for (const tank of asArray(value)) {
          const t = tank as Record<string, unknown>;
          const id = text(t['@id']);
          const ref = text((t['link'] as Record<string, unknown> | undefined)?.['@ref']);
          if (id && ref) out.set(id, ref);
        }
      }
      walk(value);
    }
  };
  walk(root);
  return out;
}

const pick = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

function readDive(
  dive: Record<string, unknown>,
  index: number,
  refs: {
    sites: Map<string, UddfSite>;
    gases: Map<string, ObservedGas>;
    tankToGas: Map<string, string>;
  },
  options: UddfParseOptions,
): DiveObservation {
  const before = dive['informationbeforedive'] as Record<string, unknown> | undefined;
  const after = dive['informationafterdive'] as Record<string, unknown> | undefined;

  const rawDateTime = text(before?.['datetime']) ?? '';
  const obs = emptyObservation(UDDF_SOURCE_KIND, dive, rawDateTime);

  const sourceRef = text(dive['@id']);
  if (sourceRef) obs.sourceRef = sourceRef;

  // --- site, resolved first: the repair below needs its coordinates ---------
  const siteRef = text((before?.['link'] as Record<string, unknown> | undefined)?.['@ref']);
  const site = siteRef ? refs.sites.get(siteRef) : undefined;
  if (site && Object.keys(site).length > 0) obs.site = { ...site };

  // --- time ----------------------------------------------------------------
  const parsed = parseUddfDateTime(rawDateTime);
  if (!parsed) {
    obs.issues.push(
      issue(
        'error',
        'unreadable_datetime',
        rawDateTime === ''
          ? `Dive ${index + 1} has no start time, so it cannot be placed in a logbook.`
          : `Could not read the start time "${rawDateTime}".`,
        'startTime',
      ),
    );
  } else {
    const repair = repairOffset(parsed.offsetMinutes, site, parsed.local, options.resolveTz);
    obs.normalizations.push(...repair.normalizations);
    obs.startTime = completeTime({
      local: parsed.local,
      raw: parsed.raw,
      ...pick('offsetMinutes', repair.offsetMinutes),
      ...(repair.suspect ? { offsetSuspect: true } : {}),
    });
  }

  // --- measurements --------------------------------------------------------
  assign(obs, 'maxDepthM', checkRange('maxDepthM', num(after?.['greatestdepth'])));
  assign(obs, 'durationS', checkRange('durationS', num(after?.['diveduration'])));

  const lowestK = num(after?.['lowesttemperature']);
  if (lowestK !== undefined) {
    assign(obs, 'waterTempMinC', checkRange('waterTempMinC', kelvinToCelsius(lowestK)));
  }

  // --- equipment -----------------------------------------------------------
  const equipment = after?.['equipmentused'] as Record<string, unknown> | undefined;
  const leadKg = num(equipment?.['leadquantity']);
  // 0.0 on every dive in the file. Not a measurement — see OCEANIC_UDDF_SENTINELS.
  const lead = applySentinels('weightKg', leadKg, OCEANIC_UDDF_SENTINELS);
  obs.issues.push(...lead.issues);
  if (lead.value !== undefined) assign(obs, 'weightKg', checkRange('weightKg', lead.value));

  // --- gases ---------------------------------------------------------------
  const gases = collectGases(dive, refs);
  if (gases.length > 0) obs.gases = gases;

  // --- profile -------------------------------------------------------------
  const profile = readProfile(dive);
  if (profile) obs.profile = profile;

  return obs;
}

function assign(
  obs: DiveObservation,
  field: 'maxDepthM' | 'durationS' | 'waterTempMinC' | 'weightKg',
  checked: { value?: number; issues: ReturnType<typeof issue>[] },
): void {
  obs.issues.push(...checked.issues);
  if (checked.value !== undefined) obs[field] = checked.value;
}

/**
 * A dive's gases come from its tank links and from mid-dive switches. Both are
 * collected, deduplicated by mix, in the order first seen — the first is the
 * one the dive started on.
 */
function collectGases(
  dive: Record<string, unknown>,
  refs: { gases: Map<string, ObservedGas>; tankToGas: Map<string, string> },
): ObservedGas[] {
  const ids: string[] = [];

  for (const tank of asArray(dive['tankdata'])) {
    const ref = text(
      ((tank as Record<string, unknown>)['link'] as Record<string, unknown> | undefined)?.['@ref'],
    );
    if (ref) ids.push(refs.tankToGas.get(ref) ?? ref);
  }

  const samples = dive['samples'] as Record<string, unknown> | undefined;
  for (const waypoint of asArray(samples?.['waypoint'])) {
    const ref = text(
      ((waypoint as Record<string, unknown>)['switchmix'] as Record<string, unknown> | undefined)?.[
        '@ref'
      ],
    );
    if (ref) ids.push(ref);
  }

  const seen = new Set<string>();
  const out: ObservedGas[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const gas = refs.gases.get(id);
    if (gas) out.push(gas);
  }
  return out;
}

function readProfile(dive: Record<string, unknown>): ProfileSeries | undefined {
  const samples = dive['samples'] as Record<string, unknown> | undefined;
  const waypoints = asArray(samples?.['waypoint']);
  if (waypoints.length === 0) return undefined;

  const timeS: number[] = [];
  const depthM: number[] = [];
  const tempC: number[] = [];
  let anyTemp = false;

  for (const waypoint of waypoints) {
    const w = waypoint as Record<string, unknown>;
    const t = num(w['divetime']);
    const d = num(w['depth']);
    // A waypoint without both is not a point on a curve.
    if (t === undefined || d === undefined) continue;
    timeS.push(t);
    depthM.push(d);

    const k = num(w['temperature']);
    if (k === undefined) {
      // The channel has to stay the same length as the others, so a gap
      // carries the previous reading forward. The first sample in the seed
      // file has no temperature, which is why this falls back to the next
      // known value rather than to zero.
      tempC.push(tempC.at(-1) ?? Number.NaN);
    } else {
      tempC.push(kelvinToCelsius(k));
      anyTemp = true;
    }
  }

  if (timeS.length === 0) return undefined;

  if (anyTemp) {
    // Backfill any leading gap with the first real reading.
    const firstReal = tempC.find((v) => !Number.isNaN(v));
    if (firstReal !== undefined) {
      for (let i = 0; i < tempC.length && Number.isNaN(tempC[i]); i++) tempC[i] = firstReal;
    }
  }

  return anyTemp ? { timeS, depthM, tempC } : { timeS, depthM };
}
