import { defineConfig, devices } from '@playwright/test';

/**
 * Accessibility and keyboard checks against the running app.
 *
 * These need a real browser because the things they assert are properties of
 * a rendered page — computed contrast, focus order, what a screen reader would
 * be handed — none of which survive being approximated in jsdom.
 *
 * The stack is started outside this config (`pnpm dev`, or the CI job's own
 * steps) rather than by `webServer`, because it is four processes, a database
 * and an object store, and starting them per test run would be slower than the
 * tests by an order of magnitude.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: process.env['WEB_URL'] ?? 'http://localhost:53000',
    trace: 'retain-on-failure',
  },
  /*
   * Every test runs twice, once per colour scheme.
   *
   * The palette is defined in two themes and only one of them was ever
   * exercised, which meant "it works in dark mode" was an assertion rather
   * than a measurement. A contrast failure that only exists at night is
   * exactly the kind that ships.
   */
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
  ],
});
