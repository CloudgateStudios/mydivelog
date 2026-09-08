import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './session';

/**
 * WCAG 2.2 AA on the primary flows, measured rather than claimed.
 *
 * axe finds a minority of accessibility problems — the machine-checkable ones.
 * It cannot tell whether a label is *useful*, only that one exists. So this
 * file pairs it with the checks a person would actually make: that the page
 * can be reached by keyboard, that focus is visible, that headings describe a
 * structure, and that the depth chart has an equivalent a screen reader can
 * read. Those are where the real failures were.
 */

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const scan = (page: Page) => new AxeBuilder({ page }).withTags(WCAG_AA);

/** Every violation, named, so a failure says what to fix and where. */
const report = (violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']): string =>
  violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}`).join('\n'),
    )
    .join('\n');

/** The number the log says it matched, which is not the number on this page. */
async function countOf(page: Page): Promise<number> {
  const text = (await page.locator('.result-count').textContent()) ?? '';
  return Number(/^(\d+)/.exec(text.trim())?.[1] ?? '0');
}

const PUBLIC_PAGES = [
  ['the landing page', '/'],
  ['sign in', '/signin'],
  ['supported formats', '/formats'],
  ['pricing', '/pricing'],
  ['the documentation', '/docs'],
  ['privacy', '/legal/privacy'],
  ['terms', '/legal/terms'],
] as const;

const SIGNED_IN_PAGES = [
  ['the logbook', '/logbook'],
  ['a filtered logbook', '/logbook?tag=shore&sort=depth_desc'],
  ['stats', '/stats'],
  ['sites', '/sites'],
  ['trips', '/trips'],
  ['gear', '/gear'],
  ['settings', '/settings'],
  ['export', '/export'],
  ['import', '/import'],
] as const;

test.describe('public pages', () => {
  for (const [name, path] of PUBLIC_PAGES) {
    test(`${name} has no WCAG 2.2 AA violations`, async ({ page }) => {
      await page.goto(path);
      const { violations } = await scan(page).analyze();
      expect(report(violations), report(violations)).toBe('');
    });
  }
});

test.describe('the public site', () => {
  test('every page links to every other, and none of the links are broken', async ({
    page,
    request,
  }) => {
    // Six pages sharing one footer, which is exactly the arrangement where a
    // link is added to five of them.
    for (const [name, path] of PUBLIC_PAGES) {
      await page.goto(path);
      const hrefs = await page
        .locator('a[href^="/"]')
        .evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute('href') ?? ''))]);

      for (const href of hrefs) {
        const response = await request.get(href, { maxRedirects: 0 });
        // 307 is the signed-out redirect from an authenticated page, which is
        // a working link and not a broken one.
        expect([200, 307], `${name} links to ${href}`).toContain(response.status());
      }
    }
  });

  test('states plainly that it is not a dive computer', async ({ page }) => {
    // docs/10-security-privacy.md draws this boundary deliberately: the moment
    // the product looks like it gives dive guidance it becomes a different
    // product. It belongs on every public page, not only in the terms.
    for (const [name, path] of PUBLIC_PAGES) {
      await page.goto(path);
      await expect(page.locator('.site-footer'), name).toContainText(/not a dive computer/i);
    }
  });
});

test.describe('signed in', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, 'demo@mydivelog.invalid');
  });

  for (const [name, path] of SIGNED_IN_PAGES) {
    test(`${name} has no WCAG 2.2 AA violations`, async ({ page }) => {
      await page.goto(path);
      const { violations } = await scan(page).analyze();
      expect(report(violations), report(violations)).toBe('');
    });
  }

  test('a dive detail page has no WCAG 2.2 AA violations', async ({ page }) => {
    await page.goto('/logbook');
    await page.locator('tbody th a').first().click();
    await expect(page.locator('h1')).toBeVisible();

    const { violations } = await scan(page).analyze();
    expect(report(violations), report(violations)).toBe('');
  });
});

test.describe('keyboard', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, 'demo@mydivelog.invalid');
  });

  test('the log can be filtered without a mouse', async ({ page }) => {
    // The whole point of building the filter bar as a plain form. If this
    // needs a pointer, the form is not a form.
    //
    // Asserts that the filter *narrowed*, not that it found some particular
    // number: this ran green locally against a database that had accumulated
    // several `pnpm demo` runs and failed on a cold CI runner, where the same
    // fixture yields a different count. A test that encodes how many times
    // somebody seeded their laptop is testing the laptop.
    await page.goto('/logbook');
    const before = await countOf(page);
    expect(before, 'the log must have dives for this to mean anything').toBeGreaterThan(1);

    await page.getByLabel('Search').fill('Angel');
    await page.getByRole('button', { name: 'Apply' }).press('Enter');

    await expect(page).toHaveURL(/q=Angel/);
    await expect(page.locator('.result-count')).toContainText('Angel');

    const after = await countOf(page);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    await expect(page.locator('tbody tr')).toHaveCount(after);
  });

  test('every interactive element on the log shows focus', async ({ page }) => {
    // A focus ring the browser draws is not guaranteed: `outline: none` in a
    // reset, or a custom control that never receives focus at all, removes it.
    // Tabbing and asking what has focus is the only way to know.
    //
    // One known blind spot, stated rather than papered over: `<input
    // type="date"` is a single element that consumes four tab stops in Chrome
    // — month, day, year, and a calendar button inside its shadow tree. On
    // that fourth stop `document.activeElement` is still the input, so this
    // reads the host's style and cannot see whether the shadow button has a
    // ring of its own. Consecutive stops on the same element are counted once;
    // the calendar button is covered by a CSS rule, not by this test.
    await page.goto('/logbook');

    const seen: string[] = [];
    let previous = '';

    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        // A stable identity for "the same element", so repeat stops collapse.
        const path: string[] = [];
        for (let node: Element | null = el; node; node = node.parentElement) {
          path.push(`${node.tagName}:${[...(node.parentElement?.children ?? [])].indexOf(node)}`);
        }
        return {
          id: path.join('>'),
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
          visible: style.outlineStyle !== 'none' || style.boxShadow !== 'none',
        };
      });
      if (!focused) break;
      if (focused.id === previous) continue;
      previous = focused.id;

      seen.push(`${focused.tag}: ${focused.label}`);
      expect(focused.visible, `no focus indicator on ${focused.tag} "${focused.label}"`).toBe(true);
    }

    expect(seen.length, 'nothing was reachable by keyboard').toBeGreaterThan(10);
  });

  test('a skip link gets past the navigation', async ({ page }) => {
    // Without one, reaching the first dive on the log means tabbing through
    // every link in the header on every page.
    await page.goto('/logbook');
    await page.keyboard.press('Tab');

    const first = page.locator(':focus');
    await expect(first).toHaveText(/skip to (main )?content/i);

    await first.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });
});

/*
 * The staff panel.
 *
 * docs/08-clients.md has asked for AA here since Phase 0 and it was listed as a
 * known gap for exactly as long — the panel was dark-only and outside this
 * suite. It now wears the same tokens as the product, so it can be held to the
 * same bar. Absolute URLs because it is a different origin to the baseURL.
 */
const ADMIN_URL = process.env['ADMIN_URL'] ?? 'http://localhost:53002';

const ADMIN_PAGES = [
  ['the overview', '/'],
  ['imports', '/imports'],
  ['format health', '/health'],
  ['dives', '/dives'],
  ['sites', '/sites'],
  // The pages staff act on rather than only read. Forms are where the
  // violations are — an input whose only label is a table header, a button
  // whose colour was picked for a fill rather than for contrast — so these
  // matter more here than the read-only pages above, not less.
  ['tags', '/tags'],
  ['users', '/users'],
  ['the audit log', '/audit'],
] as const;

test.describe('the admin panel', () => {
  for (const [name, path] of ADMIN_PAGES) {
    test(`${name} has no WCAG 2.2 AA violations`, async ({ page }) => {
      await page.goto(`${ADMIN_URL}${path}`);
      const { violations } = await scan(page).analyze();
      expect(report(violations), report(violations)).toBe('');
    });
  }

  /*
   * The two record pages carry the biggest forms in the panel, and neither has
   * a fixed URL. Reached by clicking, the way a person reaches them — which
   * also means a broken link on the list page fails this test rather than
   * quietly leaving the form unscanned.
   */
  for (const [name, list, rowLink] of [
    ['a site', '/sites', 'table tbody tr:first-child a'],
    ['a dive', '/dives', 'table tbody tr:first-child a'],
  ] as const) {
    test(`${name} has no WCAG 2.2 AA violations`, async ({ page }) => {
      await page.goto(`${ADMIN_URL}${list}`);
      const first = page.locator(rowLink).first();
      const count = await page.locator(rowLink).count();
      test.skip(count === 0, `no ${name} in this database to open`);

      await first.click();
      await expect(page.locator('form')).not.toHaveCount(0);

      const { violations } = await scan(page).analyze();
      expect(report(violations), report(violations)).toBe('');
    });
  }

  test('a delete form asks why before it appears', async ({ page }) => {
    // The reason field is the confirmation step. A dialog asking "are you
    // sure?" gets a reflexive yes; typing why you are deleting somebody's
    // data does not, and it leaves the audit log with a sentence.
    await page.goto(`${ADMIN_URL}/tags`);
    const rows = await page.locator('table tbody tr').count();
    test.skip(rows === 0, 'no tags in this database');

    const disclosure = page.locator('details > summary', { hasText: 'Delete' }).first();
    await disclosure.click();
    const reason = page.locator('details form input[name="reason"]').first();
    await expect(reason).toBeVisible();
    await expect(reason).toHaveAttribute('required', '');
  });

  test('says it is the staff panel, not the product', async ({ page }) => {
    // Someone glancing at a screenshot should never have to work out which
    // side of the login it came from.
    await page.goto(`${ADMIN_URL}/imports`);
    await expect(page.locator('.wordmark-staff')).toHaveText(/staff/i);
  });
});

/**
 * The account menu.
 *
 * A disclosure rather than an ARIA menu, and it opens with no JavaScript —
 * which is the part worth guarding, because the easy version of this feature
 * is a click handler that leaves a keyboard user with nothing.
 */
test.describe('the account menu', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, 'demo@mydivelog.invalid');
  });

  test('holds settings and sign out, and opens on a click', async ({ page }) => {
    await page.goto('/logbook');

    // Closed to begin with: the bar shows a name, not a menu.
    await expect(page.getByRole('link', { name: 'Settings' })).toBeHidden();

    await page.locator('.account > summary').click();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('has no WCAG 2.2 AA violations while it is open', async ({ page }) => {
    // Scanned open as well as closed. A menu that only exists after a click is
    // a menu the rest of this suite would never look at.
    await page.goto('/logbook');
    await page.locator('.account > summary').click();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();

    const { violations } = await scan(page).analyze();
    expect(report(violations), report(violations)).toBe('');
  });

  test('opens from the keyboard alone', async ({ page }) => {
    await page.goto('/logbook');
    await page.locator('.account > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();

    // And Escape puts you back where you were, rather than at the top of the
    // document with the menu still covering the page.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: 'Settings' })).toBeHidden();
    await expect(page.locator('.account > summary')).toBeFocused();
  });

  test('closes when you click somewhere else', async ({ page }) => {
    await page.goto('/logbook');
    await page.locator('.account > summary').click();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();

    await page.locator('h1').click();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeHidden();
  });

  test('still opens with JavaScript turned off', async ({ browser }) => {
    // The claim the whole shape of this component rests on. A `<details>`
    // needs no script to open; only the Escape and click-away niceties do.
    const context = await browser.newContext({ javaScriptEnabled: false });
    await signIn(context, 'demo@mydivelog.invalid');
    const page = await context.newPage();

    await page.goto('/logbook');
    await page.locator('.account > summary').click();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
    await context.close();
  });

  test('signs out, which is a form and not a link', async ({ page }) => {
    // Sign out changes state on the server, so it is a POST. A link here would
    // be followed by every prefetcher and crawler that met it.
    await page.goto('/logbook');
    await page.locator('.account > summary').click();
    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/signin/);
  });
});

test.describe('charts', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, 'demo@mydivelog.invalid');
  });

  test('every chart on the stats page has a table beside it', async ({ page }) => {
    // Same rule as the depth profile: an SVG of rectangles tells a screen
    // reader nothing, and docs/08-clients.md requires an equivalent for every
    // chart rather than for the one somebody remembered.
    await page.goto('/stats');

    const charts = page.locator('figure.chart');
    const count = await charts.count();
    expect(count, 'the stats page should draw some charts').toBeGreaterThan(2);

    for (let i = 0; i < count; i += 1) {
      const chart = charts.nth(i);
      const summary = chart.locator('details.chart-table > summary');
      await expect(summary, `chart ${i} has no table`).toHaveText(/as numbers/i);

      await summary.focus();
      await summary.press('Enter');
      await expect(chart.locator('table tbody tr').first()).toBeVisible();
    }
  });

  test('the site plot says it is not a map', async ({ page }) => {
    // It plots the diver's own coordinates and requests nothing from a tile
    // server. Letting a reader assume otherwise would be a privacy claim made
    // by omission.
    await page.goto('/sites');
    await expect(page.locator('.site-map figcaption')).toContainText(/not a map/i);
    await expect(page.locator('.site-map svg')).toHaveAttribute('aria-label', /dive sites/i);
  });
});

test.describe('the depth profile', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, 'demo@mydivelog.invalid');
  });

  test('has a table a screen reader can read', async ({ page }) => {
    // docs/08-clients.md is explicit: "Charts always have a table equivalent —
    // a depth profile is meaningless to a screen reader otherwise." An SVG of
    // a path element is a picture of a dive, not a record of one.
    await page.goto('/logbook?hasProfile=true');
    await page.locator('tbody th a').first().click();

    const chart = page.locator('figure.profile');
    await expect(chart).toBeVisible();

    // Behind a disclosure, so the numbers do not push the rest of the dive off
    // the screen. A closed <details> hides its content from the accessibility
    // tree too, which is why this opens it the way a reader would: the summary
    // is announced, reachable, and named in words.
    const disclosure = page.locator('details.profile-table');
    const summary = disclosure.locator('summary');
    await expect(summary).toHaveText(/the same dive as numbers/i);

    // Opened with the keyboard, because that is the path being asserted.
    await summary.focus();
    await summary.press('Enter');
    await expect(disclosure).toHaveAttribute('open', '');

    const table = page.getByRole('table', { name: /depth profile/i });
    await expect(table).toBeVisible();

    // The deepest sample is the one number a diver looks for, and even spacing
    // lands on it only by accident.
    await expect(table.locator('tbody tr.deepest')).toHaveCount(1);
    await expect(table.locator('tbody tr')).not.toHaveCount(0);
  });
});
