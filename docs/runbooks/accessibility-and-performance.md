# Runbook: accessibility and performance

Two of Phase 5's acceptance criteria are numbers, and a number nobody measures
is a claim. These are measured on every pull request, by the
`Accessibility and Lighthouse` job in CI.

| Criterion | How it is checked | Where it runs |
|---|---|---|
| WCAG 2.2 AA on primary flows | axe-core through Playwright, plus keyboard tests | `pnpm test:a11y` |
| Lighthouse performance > 90 on marketing pages | Lighthouse CI, two runs of each of seven pages | `pnpm test:lighthouse` |
| Lighthouse accessibility > 95 on marketing pages | the same run | `pnpm test:lighthouse` |

## Running them yourself

Both need the stack up, and Lighthouse needs the **production** build — a
development server compiles on demand and would be measuring itself.

```bash
pnpm dev          # in one terminal
pnpm demo         # load the sample logbook, so the pages have content
pnpm test:a11y
```

```bash
pnpm build
pnpm --filter @mydivelog/api start &
pnpm --filter @mydivelog/web start &
pnpm test:lighthouse
```

A failing accessibility test names the rule, its impact, and the CSS selector
of every element that broke it. A failing Lighthouse run writes full reports to
`.lighthouseci/`; CI uploads those, plus Playwright traces, as an artifact.

## What axe can and cannot tell you

axe finds the machine-checkable minority of accessibility problems. It knows
whether a label exists; it cannot know whether the label is useful. So the
suite pairs it with the checks a person would actually make — that the log can
be filtered without a mouse, that every focusable element shows where focus
is, that a skip link exists, and that the depth chart has a table equivalent.

Every one of the defects this suite found on its first run was in that second
group or in color contrast, not in a missing attribute.

## Known gaps

- **The admin panel is not covered.** `docs/08-clients.md` asks for WCAG 2.2 AA
  there too. It is Phase 4 work and the panel is behind Cloudflare Access;
  adding it means running a third server in the job.
- **One blind spot inside the keyboard test.** A `<input type="date">` is a
  single element that takes four tab stops in Chrome, the last of them a
  calendar button inside its shadow tree. `document.activeElement` is still the
  input on that stop, so the test cannot see whether the button has a focus
  ring of its own. A CSS rule covers it; this test does not.
- **Scores are taken on a desktop preset**, against localhost. They are a
  regression signal, not a measurement of what a diver on a boat's wifi sees.
