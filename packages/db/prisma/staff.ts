/**
 * Grant or revoke staff.
 *
 *   pnpm staff someone@example.com --create    # local: make the account too
 *   pnpm staff someone@example.com             # grant, refusing an unknown address
 *   pnpm staff someone@example.com --revoke
 *
 * Staff membership is two independent facts and both are required: Cloudflare
 * Access decides who reaches the panel, `is_staff` decides whether the API will
 * act on their behalf. This sets the second. Removing someone from Access is
 * enough on its own; clearing this column as well is tidy, not load-bearing.
 *
 * **The address has to match.** The guard looks the account up by the email in
 * the Access token, so a staff member whose Access identity is not also their
 * MyDiveLog account address gets a 403 that looks exactly like a missing flag.
 *
 * Creating the account is behind `--create` rather than being the default.
 * Locally that is what you want — the alternative is "sign in through the web
 * app first", which is three steps to make the panel work on a fresh clone.
 * Against dev or prod it is the opposite of what you want: an upsert turns a
 * mistyped address into a brand new staff account that nobody is looking for,
 * so by default a name this database does not know is an error.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../src/client.ts';

const [email, ...flags] = process.argv.slice(2);
const revoke = flags.includes('--revoke');
const create = flags.includes('--create');

if (!email || !email.includes('@')) {
  console.error('Usage: pnpm staff <email> [--create] [--revoke]');
  process.exit(1);
}

const prisma = createPrismaClient();

const existing = await prisma.user.findUnique({ where: { email } });

if (!existing && !create) {
  console.error(
    `No account here for ${email}.\n\n` +
      'Staff are matched by the address in their Cloudflare Access token, so this has to be ' +
      'the same address they sign in to MyDiveLog with. Check the spelling against the list, ' +
      'or pass --create to make the account:\n\n' +
      '  pnpm staff <email> --create\n',
  );
  process.exit(1);
}

if (!existing && revoke) {
  console.error(`No account here for ${email}; nothing to revoke.`);
  process.exit(1);
}

const user = existing
  ? await prisma.user.update({ where: { email }, data: { isStaff: !revoke } })
  : await prisma.user.create({
      data: { id: randomUUID(), email, isStaff: !revoke, displayName: 'Staff' },
    });

console.log(
  `${user.email} ${user.isStaff ? 'is staff' : 'is no longer staff'} (${user.id})` +
    `${existing ? '' : ', account created'}.`,
);

await prisma.$disconnect();
