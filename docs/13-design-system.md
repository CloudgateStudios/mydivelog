# Design System — Descent

The product's personality, chosen deliberately: **a well-kept logbook.** Warm,
considered, personal. The digital version of the paper log with the stamps in
it — a record someone is proud of and would show you.

The visual direction that serves it is **Descent**: the palette is the
product's own metaphor. A page begins at surface light and gets darker with
depth, so the ground a thing sits on says how deep in the app you are.

## Two accents, and the difference matters

| Token | Role |
|---|---|
| `--accent` | Interactive. Links, focus rings, primary buttons, chart marks. Stays in the water. |
| `--signal` | The one warm color. Marks the thing worth looking at, and nothing else. |

`--signal` is warm for a reason rather than for contrast: **red is the first
wavelength the water absorbs**, so at depth a red object is black until a torch
finds it. It marks the deepest sample on a profile, a field two sources
disagreed about — the things a diver is looking for. Spending it on ordinary
links would waste the only warm color in the system.

`--bad` is deliberately a redder red than `--signal`. Error and attention are
different messages and must not be the same color.

## Tokens

Light, on `--bg` `#F4F8FA`:

| Token | Value | Contrast on bg |
|---|---|---|
| `--text` | `#12303F` | 12.9:1 |
| `--muted` | `#4E6E7E` | 5.1:1 |
| `--accent` | `#0E5C7A` | 6.9:1 · white on it 7.4:1 |
| `--signal` | `#AE4121` | 5.5:1 |
| `--good` | `#186043` | 7.0:1 |
| `--bad` | `#961B22` | 7.9:1 |

Dark, on `--bg` `#0C1E29` — the same water, deeper, not an inversion. This is
also where the product gets used: night dives and liveaboard cabins.

| Token | Value | Contrast on bg |
|---|---|---|
| `--text` | `#E8F0F4` | 14.8:1 |
| `--muted` | `#8FAAB8` | 7.0:1 |
| `--accent` | `#7EC8E8` | 9.2:1 |
| `--signal` | `#F0805B` | 6.4:1 |

Grounds, surface to depth: `--bg`, `--shelf`, `--coastal`, `--panel`,
`--border`.

> Every value was calculated against the grounds it is used on rather than
> chosen by eye, and the accessibility suite re-checks them on every pull
> request. The original torch was `#BC4A28`; it cleared AA at 4.74:1 on the
> lightest ground and failed at 4.38:1 on anything slightly darker, so it was
> darkened before it shipped.

## Type

**IBM Plex**, self-hosted. One family, three registers, one voice.

| Face | Role |
|---|---|
| Plex Serif 600 | Headings and dive titles. The one editorial note. |
| Plex Sans 400/600 | Interface and body. |
| Plex Mono 400 | Coordinates, provenance, labels. |

The serif on headings is what makes a dive read as an entry in a logbook
rather than a row in a database. Plex has genuine tabular figures, which this
product needs on nearly every screen: `table`, `.num`, `.facts dd` and
`.result-count` all set `font-variant-numeric: tabular-nums`, so digits stay in
their columns as values change.

**Not Inter, and not Space Grotesk.** Both are the default of the look this
system exists to leave.

### Why self-hosted

The Content-Security-Policy allows `font-src 'self'`, so a font CDN is blocked
outright. That is the right constraint anyway: the faces are served from our
own origin, tell Google nothing about our readers, and the latin subsets of the
four we use come to about 80 KB in total — which keeps Lighthouse at 100.

Weights are imported individually in `apps/web/app/layout.tsx`. Adding one is a
deliberate act with a measurable cost; do not import a whole family.

## The mark

The letter **M drawn as a dive profile** — an M is one descent and one ascent,
which is a dive — hanging below a surface rule, with the deepest point marked
the way the app marks it on every profile it draws.

It lives in `apps/web/components/Wordmark.tsx` as SVG, not an image: a few
hundred bytes, sharp at any size, and it takes its color from these tokens so
it follows the theme without a second asset. `apps/web/app/icon.svg` is the
same geometry on a deep tile.

The wordmark sets **My** back a weight so the eye lands on **DiveLog**, the
half people actually say. The split is presentational — it is one word to a
screen reader.

## Rules

- **Never hard-code a color.** Every value comes from a token, so a theme
  change is one edit and the contrast tests keep meaning something.
- **Spend `--signal` sparingly.** If it appears three times on a screen it has
  stopped signalling anything.
- **A new color needs a calculated ratio** against every ground it will sit
  on, in both themes, before it lands. See
  [the accessibility runbook](./runbooks/accessibility-and-performance.md).
- **Headings are serif, data is tabular.** Those two do most of the work of
  looking like this product rather than any other.

## Not yet done

- The admin panel still uses its own older dark-only palette. It is staff-
  facing and deliberately left alone for now.
- The descending-ground idea is in the tokens but not yet applied structurally
  to the marketing pages; today they all sit at surface level.
- A spacing scale is not tokenized — spacing is still ad hoc.
