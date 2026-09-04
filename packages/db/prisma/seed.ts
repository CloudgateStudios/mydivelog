/**
 * Seeds the system-owned reference data: agencies, the tag taxonomy, standard
 * gas mixes, and a starter region tree.
 *
 * IDs are UUIDv5 derived from a fixed namespace, so re-running the seed updates
 * rows in place rather than duplicating them. User-created rows use UUIDv7 as
 * described in docs/04-data-model.md; system rows want determinism instead.
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '../src/generated/client.ts';

const prisma = new PrismaClient();

const NAMESPACE = 'mydivelog.app/seed';

function deterministicUuid(name: string): string {
  const h = createHash('sha1').update(`${NAMESPACE}:${name}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

const AGENCIES: [string, string][] = [
  ['PADI', 'Professional Association of Diving Instructors'],
  ['SSI', 'Scuba Schools International'],
  ['NAUI', 'National Association of Underwater Instructors'],
  ['SDI', 'Scuba Diving International'],
  ['TDI', 'Technical Diving International'],
  ['GUE', 'Global Underwater Explorers'],
  ['BSAC', 'British Sub-Aqua Club'],
  ['CMAS', 'Confédération Mondiale des Activités Subaquatiques'],
  ['RAID', 'Rebreather Association of International Divers'],
  ['IANTD', 'International Association of Nitrox and Technical Divers'],
  ['NASE', 'National Academy of Scuba Educators'],
  ['PSAI', 'Professional Scuba Association International'],
];

// The vocabulary a real diver builds for themselves. The seed values below are
// taken from the Dive Type and Water Type columns of the sample workbook, plus
// the obvious neighbours. Import fuzzy-matches against these, which is how
// "Dift" resolves to "drift".
const TAGS: [string, string, string][] = [
  // slug, label, category
  ['shore', 'Shore', 'entry'],
  ['boat', 'Boat', 'entry'],
  ['dock', 'Dock', 'entry'],
  ['liveaboard', 'Liveaboard', 'entry'],
  ['drift', 'Drift', 'condition'],
  ['night', 'Night', 'condition'],
  ['sunset', 'Sunset', 'condition'],
  ['current', 'Current', 'condition'],
  ['surge', 'Surge', 'condition'],
  ['low-visibility', 'Low visibility', 'condition'],
  ['wreck', 'Wreck', 'environment'],
  ['wall', 'Wall', 'environment'],
  ['reef', 'Reef', 'environment'],
  ['cave', 'Cave', 'environment'],
  ['cavern', 'Cavern', 'environment'],
  ['quarry', 'Quarry', 'environment'],
  ['muck', 'Muck', 'environment'],
  ['ice', 'Ice', 'environment'],
  ['altitude', 'Altitude', 'environment'],
  ['training', 'Training', 'activity'],
  ['certification', 'Certification', 'activity'],
  ['photography', 'Photography', 'activity'],
  ['deep', 'Deep', 'activity'],
  ['deco', 'Decompression', 'activity'],
  ['navigation', 'Navigation', 'activity'],
  ['search-recovery', 'Search and recovery', 'activity'],
];

// Standard mixes. o2 is a fraction; n2 is derived and never stored.
const GAS_MIXES: [string, number, number][] = [
  ['Air', 0.21, 0],
  ['EAN28', 0.28, 0],
  ['EAN30', 0.3, 0],
  ['EAN32', 0.32, 0],
  ['EAN34', 0.34, 0],
  ['EAN36', 0.36, 0],
  ['EAN40', 0.4, 0],
  ['EAN50', 0.5, 0],
  ['Oxygen', 1.0, 0],
  ['Trimix 21/35', 0.21, 0.35],
  ['Trimix 18/45', 0.18, 0.45],
];

// A starter tree, covering the places in the sample data plus common
// destinations. Regions grow from imports; this is a floor, not a catalogue.
const COUNTRIES: [string, string][] = [
  ['US', 'United States'],
  ['MX', 'Mexico'],
  ['BQ', 'Bonaire'],
  ['HN', 'Honduras'],
  ['BS', 'Bahamas'],
  ['TH', 'Thailand'],
  ['HR', 'Croatia'],
  ['EG', 'Egypt'],
  ['ID', 'Indonesia'],
  ['PH', 'Philippines'],
  ['AU', 'Australia'],
  ['BZ', 'Belize'],
  ['CR', 'Costa Rica'],
  ['FJ', 'Fiji'],
  ['MV', 'Maldives'],
  ['KY', 'Cayman Islands'],
  ['GB', 'United Kingdom'],
  ['CA', 'Canada'],
];

const STATES: [string, string, string][] = [
  // countryCode, name, kind
  ['US', 'Hawaii', 'state'],
  ['US', 'Florida', 'state'],
  ['US', 'California', 'state'],
  ['US', 'Illinois', 'state'],
  ['MX', 'Quintana Roo', 'state'],
];

async function main(): Promise<void> {
  for (const [code, name] of AGENCIES) {
    await prisma.agency.upsert({
      where: { code },
      update: { name },
      create: { id: deterministicUuid(`agency:${code}`), code, name },
    });
  }

  for (const [slug, label, category] of TAGS) {
    const id = deterministicUuid(`tag:${slug}`);
    await prisma.tag.upsert({
      where: { id },
      update: { label, category, isSystem: true },
      create: { id, slug, label, category, isSystem: true, userId: null },
    });
  }

  for (const [name, o2Fraction, heFraction] of GAS_MIXES) {
    const id = deterministicUuid(`gas:${name}`);
    await prisma.gasMix.upsert({
      where: { id },
      update: { o2Fraction, heFraction },
      create: { id, name, o2Fraction, heFraction, userId: null },
    });
  }

  for (const [countryCode, name] of COUNTRIES) {
    const id = deterministicUuid(`region:${countryCode}`);
    await prisma.region.upsert({
      where: { id },
      update: { name },
      create: { id, name, kind: 'country', countryCode },
    });
  }

  for (const [countryCode, name, kind] of STATES) {
    const id = deterministicUuid(`region:${countryCode}:${name}`);
    await prisma.region.upsert({
      where: { id },
      update: { name },
      create: {
        id,
        name,
        kind,
        countryCode,
        parentId: deterministicUuid(`region:${countryCode}`),
      },
    });
  }

  const counts = {
    agencies: await prisma.agency.count(),
    tags: await prisma.tag.count(),
    gasMixes: await prisma.gasMix.count(),
    regions: await prisma.region.count(),
  };
  console.log('seeded', counts);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
