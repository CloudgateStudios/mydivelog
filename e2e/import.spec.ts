import { expect, test } from '@playwright/test';
import { signIn } from './session';

/**
 * An import bigger than a megabyte.
 *
 * A Server Action buffers the whole body, and Next's default limit is 1 MB —
 * so every dive computer export of any real size failed inside Next before any
 * of our code ran, with a blank "This page couldn't load" and the reason only
 * in the server log. The real 96-dive Oceanic+ export is 4.4 MB.
 *
 * The fixture in this repository is a 6-dive subset well under the limit,
 * which is why nothing caught it. This builds a file that is deliberately over
 * it, because the size is the thing being tested.
 */

/** A valid UDDF whose waypoint count puts it past `atLeastBytes`. */
function bigUddf(atLeastBytes: number): string {
  const head =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<uddf version="3.2.1" xmlns="http://www.streit.cc/uddf/3.2/">\n' +
    '<generator><manufacturer><contact><homepage>https://example.invalid/</homepage>' +
    '</contact></manufacturer><version>0.0.1</version></generator>\n' +
    '<profiledata><repetitiongroup><dive id="big-1">' +
    '<informationbeforedive><datetime>2026-04-01T09:00:00Z</datetime></informationbeforedive>' +
    '<samples>';
  const tail =
    '</samples><informationafterdive><greatestdepth>28.4</greatestdepth>' +
    '<diveduration>3000</diveduration></informationafterdive>' +
    '</dive></repetitiongroup></profiledata></uddf>';

  const parts: string[] = [head];
  let size = head.length + tail.length;
  for (let i = 0; size < atLeastBytes; i += 1) {
    // A plausible descent-and-return rather than noise, so the parser has
    // something real to chew on.
    const depth = (Math.sin(i / 400) * 14 + 14).toFixed(3);
    const sample = `<waypoint><divetime>${i}</divetime><depth>${depth}</depth></waypoint>`;
    parts.push(sample);
    size += sample.length;
  }
  parts.push(tail);
  return parts.join('');
}

test('accepts a file larger than a megabyte', async ({ page, context }) => {
  const xml = bigUddf(1_500_000);
  expect(Buffer.byteLength(xml), 'the fixture must exceed the old 1 MB limit').toBeGreaterThan(
    1024 * 1024,
  );

  await signIn(context, 'demo@mydivelog.invalid');
  await page.goto('/import');

  await page.setInputFiles('input[type=file]', {
    name: 'large-export.uddf',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  });

  // Straight to review means it was accepted, read, and matched. A body the
  // server refuses never gets this far — it renders an error page instead.
  await page.waitForURL(/\/import\/[0-9a-f-]{36}/, { timeout: 120_000 });
  await expect(page.locator('main')).toContainText(/dive computer export/i);
});

test('says so before posting a file that is too big', async ({ page, context }) => {
  // The limit is enforced by Next before any of our code runs, so nothing on
  // the server could turn it into a sentence. The browser knows the size, and
  // asking it is the only way anyone finds out what went wrong.
  await signIn(context, 'demo@mydivelog.invalid');
  await page.goto('/import');

  await page.setInputFiles('input[type=file]', {
    name: 'enormous.uddf',
    mimeType: 'application/xml',
    buffer: Buffer.alloc(33 * 1024 * 1024, ' '),
  });

  const warning = page.locator('form p[role="alert"]');
  await expect(warning).toContainText(/enormous\.uddf is 33\.0 MB/);
  await expect(warning).toContainText(/limit is 32\.0 MB/);
  // And it never left the browser.
  await expect(page).toHaveURL(/\/import$/);
});

test('shows that a commit is running, and locks the button while it is', async ({
  page,
  context,
}) => {
  /*
   * Committing writes one depth profile per dive to object storage. On a
   * laptop that is fast; from a Fly machine to R2 it was twenty seconds of a
   * page that looked broken, and the only honest reading of a button that
   * does nothing is that it is dead.
   *
   * The delay is injected rather than waited for, so this asserts the pending
   * state deterministically instead of racing a fast local commit.
   */
  await signIn(context, 'demo@mydivelog.invalid');
  await page.goto('/import');
  await page.setInputFiles('input[type=file]', {
    name: 'commit-me.uddf',
    mimeType: 'application/xml',
    buffer: Buffer.from(bigUddf(20_000)),
  });
  await page.waitForURL(/\/import\/[0-9a-f-]{36}/, { timeout: 120_000 });

  await page.route('**/import/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return route.continue();
  });

  const button = page.locator('form.commit button');
  await button.click();

  await expect(button).toBeDisabled();
  await expect(button).toContainText(/Adding \d+ dives/);
  await expect(button).toHaveAttribute('aria-busy', 'true');
});

/**
 * The template a diver with nothing to import starts from.
 *
 * The round trip is the whole feature: if what this hands out does not import
 * cleanly, it is worse than offering nothing. `template.test.ts` proves the
 * generator; this proves the button, the download, and the file arriving back
 * through the real upload path.
 */
test.describe('the import template', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, 'demo@mydivelog.invalid');
  });

  for (const [label, extension] of [
    ['Excel template', 'xlsx'],
    ['CSV template', 'csv'],
  ] as const) {
    test(`${label} downloads and imports back with nothing unrecognised`, async ({ page }) => {
      await page.goto('/import');

      const download = await Promise.race([
        page.waitForEvent('download'),
        page
          .getByRole('link', { name: label })
          .click()
          .then(() => page.waitForEvent('download')),
      ]);
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));

      const saved = await download.path();
      expect(saved).toBeTruthy();

      // Straight back in through the drop zone, the way someone who filled it
      // in would. Reaching review at all means every column was understood.
      await page.goto('/import');
      await page.setInputFiles('#file', saved as string);

      await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await expect(page.locator('main')).not.toContainText('not in a format');
      // Reaching a review at all means every column was understood. The one
      // row is the example, and it must arrive as something to add rather than
      // as a conflict with a dive the diver already has — which is why nothing
      // in it names a real place.
      await expect(page.locator('main')).toContainText('Example Reef');
      await expect(page.locator('main')).not.toContainText('needs your decision');
    });
  }

  test('says which units it comes in, because that is a preference', async ({ page }) => {
    await page.goto('/import');
    await expect(page.getByText(/metres and Celsius|feet and Fahrenheit/)).toBeVisible();
  });
});
