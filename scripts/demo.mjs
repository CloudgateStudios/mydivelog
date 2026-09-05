#!/usr/bin/env node
/**
 * Loads the two real seed files into a local logbook, through the API.
 *
 *   pnpm dev      # in one terminal
 *   pnpm demo     # in another
 *
 * Deliberately over HTTP rather than by importing the service directly: it
 * exercises upload, detect, parse, match, review and commit exactly as a
 * browser does, so a green run means the thing a person would do works.
 *
 * Safe to run repeatedly. An identical file short-circuits to the batch that
 * already exists, so a second run adds nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL ?? 'http://localhost:53001';
const WEB = process.env.WEB_URL ?? 'http://localhost:53000';
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@mydivelog.invalid';

const root = new URL('../', import.meta.url);
const fixture = (name) => readFileSync(fileURLToPath(new URL(`fixtures/${name}`, root)));

const die = (message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
};

async function main() {
  const health = await fetch(`${API}/health`).catch(() => undefined);
  if (!health?.ok) {
    die(`The API is not answering at ${API}. Start it with \`pnpm dev\` and try again.`);
  }

  // The dev-only stub login. It is refused unless AUTH_DEV_LOGIN_ENABLED is
  // set, which is why this script cannot be pointed at a deployed environment
  // by accident.
  const login = await fetch(`${API}/v1/auth/dev/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, displayName: 'Demo diver' }),
  });
  if (!login.ok) {
    const problem = await login.json().catch(() => ({}));
    die(
      `Could not sign in as ${EMAIL}: ${problem.detail ?? login.status}. ` +
        'Set AUTH_DEV_LOGIN_ENABLED=true in .env for local development.',
    );
  }
  const { accessToken } = await login.json();
  const auth = { authorization: `Bearer ${accessToken}` };

  for (const name of ['spreadsheet-sample.csv', 'uddf-sample.uddf']) {
    const form = new FormData();
    form.set('file', new Blob([fixture(name)]), name);

    const created = await fetch(`${API}/v1/imports`, { method: 'POST', headers: auth, body: form });
    if (!created.ok) die(`Upload of ${name} failed: ${created.status}`);
    const batch = await created.json();

    if (batch.status === 'failed') die(`${name} could not be parsed: ${batch.error}`);

    // An identical upload short-circuits to the batch that already exists, so
    // a second run of this script finds one that is already committed. That is
    // the API working — importing the same file twice must not duplicate a
    // logbook — but the first version of this script called commit anyway and
    // died on the 400.
    if (batch.status === 'committed') {
      console.log(`  ${name.padEnd(24)} already imported, nothing to do`);
      continue;
    }

    // Accept whatever the engine proposed, the way a person clicking through a
    // review with no changes would. Rows it was unsure about become new dives.
    for (const row of batch.rows) {
      if (row.decision !== 'pending') continue;
      await fetch(`${API}/v1/imports/${batch.id}/rows/${row.rowIndex}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'create' }),
      });
    }

    const committed = await fetch(`${API}/v1/imports/${batch.id}/commit`, {
      method: 'POST',
      headers: auth,
    });
    if (!committed.ok) die(`Commit of ${name} failed: ${committed.status}`);
    const result = await committed.json();
    console.log(
      `  ${name.padEnd(24)} ${String(result.created).padStart(2)} new, ` +
        `${String(result.merged).padStart(2)} merged into dives you already had`,
    );
  }

  // The list is cursor-paginated and returns no total, so this counts a page
  // rather than reporting one. Asking for a page of 1 and printing its length
  // said "1 dives in the logbook" after importing 24.
  const dives = await fetch(`${API}/v1/dives?limit=200`, { headers: auth }).then((r) => r.json());
  const total = dives.data?.length ?? 0;
  const more = dives.nextCursor ? '+' : '';

  // The link, rather than instructions to find one. The API logs a magic link
  // when dev login is on, but printing it here is one less place to look.
  const link = await fetch(`${API}/v1/auth/email/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL }),
  });

  console.log(`\n  ${total}${more} dives in the logbook.\n`);
  console.log(`  Open ${WEB} and sign in as ${EMAIL}.`);
  console.log(
    link.ok
      ? '  A sign-in link was written to the API log — look for "magic link for".'
      : '  Request a sign-in link from the sign-in page.',
  );
  console.log(`\n  Admin panel: ${process.env.ADMIN_URL ?? 'http://localhost:53002'}\n`);
}

main().catch((error) => die(String(error)));
