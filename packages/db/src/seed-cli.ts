/**
 * Runs the reference-data seed.
 *
 *   node dist/seed-cli.js          # inside the API image, from the release command
 *   pnpm --filter @mydivelog/db db:seed
 *
 * Idempotent: every row is upserted under a deterministic id, so running it on
 * every deploy converges rather than accumulating. It touches only
 * system-owned rows — agencies, the tag taxonomy, gas mixes and regions — and
 * never anything belonging to a user.
 */
import { createPrismaClient } from './client.ts';
import { seedReferenceData } from './seed.ts';

const prisma = createPrismaClient();

seedReferenceData(prisma)
  .then((counts) => {
    console.log('seeded', counts);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
