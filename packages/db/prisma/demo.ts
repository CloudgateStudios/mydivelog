/**
 * Inserts the worked example from docs/02-source-data-analysis.md: one real
 * dive recorded twice, once in the spreadsheet and once by the dive computer,
 * merged into a single record with field-level provenance.
 *
 * Phase 1 has no API or UI, so this is how the data model can be seen doing the
 * job it exists for. Safe to run repeatedly; it clears its own demo user first.
 *
 *   pnpm db:demo
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../src/generated/client.ts';

const prisma = new PrismaClient();
const DEMO_EMAIL = 'demo@mydivelog.invalid';

// Spreadsheet row 195 and UDDF dive_69ab7a96… are the same dive. Each source
// holds fields the other lacks, and they disagree about two of them.
const SPREADSHEET = {
  diveNumber: 195,
  maxDepthFt: 46,
  site: 'Angel City',
  gasPercent: 32,
  weightLb: 24,
  notes: 'Last dive of the Bonaire trip.',
  visibilityFt: 60,
};

const COMPUTER = {
  sourceRef: 'dive_69ab7a96dce6e40c7d3abe65',
  maxDepthM: 14.099043,
  durationS: 2776,
  latitude: 12.103435,
  longitude: -68.28725,
  o2Fraction: 0.33,
  lowestTempK: 299.64,
  rawOffset: '-00:04', // the exporter wrote hours into the minutes field
  correctedOffsetMinutes: -240,
  startLocal: '2026-03-06T19:07:42',
};

const ft = (n: number) => n * 0.3048;
const lb = (n: number) => n * 0.45359237;
const k = (n: number) => n - 273.15;

async function main(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const userId = randomUUID();
  await prisma.user.create({
    data: { id: userId, email: DEMO_EMAIL, displayName: 'Demo Diver' },
  });

  const siteId = randomUUID();
  await prisma.site.create({
    data: {
      id: siteId,
      name: SPREADSHEET.site, // named by the human
      latitude: COMPUTER.latitude, // located by the instrument
      longitude: COMPUTER.longitude,
      ownerUserId: userId,
      aliases: { create: [{ id: randomUUID(), name: '1,000 Steps', source: 'import' }] },
    },
  });

  const startLocal = new Date(`${COMPUTER.startLocal}Z`);
  const startUtc = new Date(startLocal.getTime() - COMPUTER.correctedOffsetMinutes * 60_000);

  const diveId = randomUUID();
  await prisma.dive.create({
    data: {
      id: diveId,
      userId,
      siteId,
      diveNumber: SPREADSHEET.diveNumber,
      startTimeUtc: startUtc,
      startTimeLocal: startLocal,
      tzOffsetMinutes: COMPUTER.correctedOffsetMinutes,
      tzName: 'America/Kralendijk',
      durationS: COMPUTER.durationS,
      maxDepthM: COMPUTER.maxDepthM, // instrument wins a measured field
      waterTempMinC: k(COMPUTER.lowestTempK),
      visibilityM: ft(SPREADSHEET.visibilityFt), // human wins a subjective one
      weightKg: lb(SPREADSHEET.weightLb),
      waterType: 'salt',
      diveMode: 'opencircuit',
      notes: SPREADSHEET.notes,
      hasProfile: true,
      hasContestedFields: true, // the two sources disagree about gas
    },
  });

  const sheetSourceId = randomUUID();
  const computerSourceId = randomUUID();
  await prisma.diveSource.createMany({
    data: [
      {
        id: sheetSourceId,
        diveId,
        sourceKind: 'spreadsheet',
        sourceRef: 'row-195',
        recordedAt: startUtc,
        rawPayload: SPREADSHEET,
      },
      {
        id: computerSourceId,
        diveId,
        sourceKind: 'uddf',
        sourceRef: COMPUTER.sourceRef,
        recordedAt: startUtc,
        rawPayload: COMPUTER,
      },
    ],
  });

  // Both values are kept for every contested field. One is selected; the other
  // is one click away and never destroyed.
  await prisma.diveFieldProvenance.createMany({
    data: [
      {
        diveId,
        fieldPath: 'maxDepthM',
        sourceId: computerSourceId,
        value: COMPUTER.maxDepthM,
        isSelected: true,
        confidence: 0.95,
      },
      {
        diveId,
        fieldPath: 'maxDepthM',
        sourceId: sheetSourceId,
        value: ft(SPREADSHEET.maxDepthFt),
        isSelected: false,
        confidence: 0.6,
      },
      {
        diveId,
        fieldPath: 'site.name',
        sourceId: sheetSourceId,
        value: SPREADSHEET.site,
        isSelected: true,
        confidence: 0.95,
      },
      {
        diveId,
        fieldPath: 'gas.o2Fraction',
        sourceId: computerSourceId,
        value: COMPUTER.o2Fraction,
        isSelected: true,
        confidence: 0.9,
      },
      {
        diveId,
        fieldPath: 'gas.o2Fraction',
        sourceId: sheetSourceId,
        value: SPREADSHEET.gasPercent / 100,
        isSelected: false,
        confidence: 0.7,
      },
      {
        diveId,
        fieldPath: 'notes',
        sourceId: sheetSourceId,
        value: SPREADSHEET.notes,
        isSelected: true,
        confidence: 1,
      },
      {
        diveId,
        fieldPath: 'weightKg',
        sourceId: sheetSourceId,
        value: lb(SPREADSHEET.weightLb),
        isSelected: true,
        confidence: 0.9,
      },
    ],
  });

  const dive = await prisma.dive.findUniqueOrThrow({
    where: { id: diveId },
    include: { site: { include: { aliases: true } }, sources: true, provenance: true },
  });

  const contested = await prisma.diveFieldProvenance.groupBy({
    by: ['fieldPath'],
    where: { diveId },
    _count: { fieldPath: true },
    having: { fieldPath: { _count: { gt: 1 } } },
  });

  console.log(`
One dive, two sources
─────────────────────────────────────────────────────────
  dive number       ${dive.diveNumber}
  site              ${dive.site?.name}  (${dive.site?.latitude}, ${dive.site?.longitude})
  aliases           ${dive.site?.aliases.map((a) => a.name).join(', ')}
  local time        ${dive.startTimeLocal.toISOString().slice(0, 19)}  offset ${dive.tzOffsetMinutes} min
                    source said "${COMPUTER.rawOffset}" — repaired from geography
  UTC               ${dive.startTimeUtc.toISOString()}
  max depth         ${dive.maxDepthM} m   (spreadsheet said ${SPREADSHEET.maxDepthFt} ft = ${ft(SPREADSHEET.maxDepthFt).toFixed(4)} m)
  duration          ${dive.durationS} s
  water temp        ${dive.waterTempMinC?.toFixed(2)} C   (source reported ${COMPUTER.lowestTempK} K)
  weight            ${dive.weightKg?.toFixed(3)} kg  (spreadsheet said ${SPREADSHEET.weightLb} lb)
  notes             ${dive.notes}

  sources           ${dive.sources.map((s) => s.sourceKind).join(' + ')}
  provenance rows   ${dive.provenance.length}
  contested fields  ${contested.map((c) => c.fieldPath).join(', ')}

Every value above traces to a source, and nothing either file
contained was discarded. Browse it with: pnpm db:studio
`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
