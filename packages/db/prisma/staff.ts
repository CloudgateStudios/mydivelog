/**
 * Grant or revoke staff, locally.
 *
 *   pnpm staff someone@example.com          # grant
 *   pnpm staff someone@example.com --revoke
 *
 * Deployed environments do not need this: staff membership there is a
 * Cloudflare Access group, and the `is_staff` column is the second half of the
 * check — set it once, by hand, when someone joins. Locally there is no Access
 * at all, so the column is the *only* half, and `ADMIN_DEV_STAFF_EMAIL` has to
 * name a row that has it.
 *
 * Creating the account if it is missing is deliberate. The alternative is
 * "sign in through the web app first, then run this", which is three steps to
 * make the admin panel work on a fresh clone.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../src/client.ts';

const [email, ...flags] = process.argv.slice(2);
const revoke = flags.includes('--revoke');

if (!email || !email.includes('@')) {
  console.error('Usage: pnpm staff <email> [--revoke]');
  process.exit(1);
}

const prisma = createPrismaClient();

const user = await prisma.user.upsert({
  where: { email },
  update: { isStaff: !revoke },
  create: { id: randomUUID(), email, isStaff: !revoke, displayName: 'Staff' },
});

console.log(
  `${user.email} ${user.isStaff ? 'is staff' : 'is no longer staff'} (${user.id}).\n` +
    (user.isStaff
      ? `Set ADMIN_DEV_STAFF_EMAIL=${user.email} in .env so staff changes are attributed to them.`
      : ''),
);

await prisma.$disconnect();
