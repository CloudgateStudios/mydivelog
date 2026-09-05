/**
 * Thin wrapper so `prisma db seed` and local development keep working.
 *
 * The seed itself lives in `src/seed.ts` so it compiles into `dist` and can run
 * inside the API image — see the comment there.
 */
import '../src/seed-cli.ts';
