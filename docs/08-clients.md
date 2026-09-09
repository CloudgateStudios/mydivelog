# Client Applications

Three clients over one API contract. All models are generated from
`packages/contracts` — TypeScript for web/admin, Dart for Flutter.

## Web Portal — `mydivelog.app`

Next.js App Router. Serves two things from one deployment:

**Marketing (public, SSR/SSG, SEO-relevant):** landing page, how import works, supported
formats, pricing, docs, privacy/terms. The supported-formats page is the actual conversion
driver — consolidators arrive searching *"import Shearwater to …"*.

**Application (authenticated, client-rendered):**

| Area | Contents |
|---|---|
| Dashboard | Totals, recent dives, cumulative time, next milestone (dive #200) |
| Log | Virtualized list/table, filter by date, site, tag, depth, gas; saved views |
| Dive detail | All fields, depth/temperature profile chart, map, gear, gas, buddies, provenance panel |
| **Import** | Upload → detect → map columns → review → commit. The flagship flow. |
| Export | Format picker, filters, async job with download |
| Sites | Map view, most-dived list, site detail with all your dives there |
| Trips | Timeline, per-trip stats |
| Stats | Charts: dives/year, depth histogram, temperature, sites, gas usage |
| Gear | Kit, sets, service reminders |
| Settings | Units, profile, certifications, billing, data export, account deletion |

### The import flow, in detail

This screen decides whether the product succeeds.

```
1. DROP          drag a file, or pick a connected service
                 → format auto-detected and named back to the user

2. MAP           only for CSV/XLSX. Column list beside a live preview of 10
   (conditional) parsed dives. Auto-mapping pre-fills. Derived columns flagged
                 "looks computed — ignore?". Save as a reusable template.

3. REVIEW        the heart of it. A row per incoming dive, grouped:
                   ✓ 96 will merge into existing dives      (collapsed by default)
                   + 4 are new                              (collapsed)
                   ⚠ 3 need your decision                   (expanded)
                   ℹ 96 timestamps were corrected           (expandable explanation)
                 Each merge row expands to a side-by-side field diff showing
                 which source wins and why, every field overridable.

4. COMMIT        progress, then a summary:
                 "197 dives now in your logbook. 96 gained depth profiles.
                  Nothing was duplicated."   [Undo this import]

5. UNDO          available forever, from import history.
```

Two design rules for this screen:

- **Never show 197 identical decisions.** Group, summarize, expand on demand. A wall of rows
  reads as work; a summary with three exceptions reads as competence.
- **Always explain, never just assert.** "Matched: same start time (±2 min), depth within
  0.6%" beats a confidence percentage. The diver learns to trust the matcher by watching it
  be right.

### Charts
Depth profile with temperature overlay, ascent-rate shading, and gas-switch markers. This is
the visual payoff of merging — the spreadsheet row that becomes a real dive profile.

## Admin Panel — `admin.mydivelog.app`

Built **before** the public web app, because the first real imports will fail in ways nobody
predicted and staring at the database by hand does not scale past week one.

| Screen | Purpose |
|---|---|
| Import inspector | **The most important screen.** Any batch, any row: raw source, normalized observation, match candidates with scores, normalizations applied, issues. Replay a parse against current engine code without touching user data. |
| Users | Search, status, dive counts, subscription, support context |
| Site moderation | Promote private→public, merge duplicates, fix names/coords |
| Suggested names | Decide the names divers propose for shared sites; a rejection must say why |
| Format health | Success/failure rates per format and per generator — surfaces "Oceanic+ 0.0.1 exports have broken offsets" as a *pattern*, not an anecdote |
| Metrics | Signups, activation (imported >10 dives), storage, job queue depth |
| Audit log | Every staff action |
| Feature flags | Kill switches per importer |

Access: staff allowlist, OIDC with mandatory 2FA, IP-restricted at the edge, every read of
user-adjacent data audited. Staff cannot read dive notes or private notes.

"Replay a parse" is worth the effort: a support ticket becomes a fixture, the fixture becomes
a regression test, and the engine improves from real failures.

## Flutter Apps — iOS, Android, macOS, Windows

One codebase, four platforms.

| Layer | Choice |
|---|---|
| Local DB | **Drift** (SQLite) — mature, typed, real migration support |
| State | Riverpod |
| Networking | Dio + generated client from OpenAPI |
| Secure storage | `flutter_secure_storage` (Keychain / Keystore / DPAPI) |
| Charts | `fl_chart`, or custom paint for profiles |
| Maps | `flutter_map` + OSM tiles — no per-request billing surprises |

### Priorities

1. **Log a dive with zero signal, in under a minute.** Big touch targets, works with wet
   hands and in sunlight. Defaults carried from the previous dive — same site, same gear,
   same gas — because divers log five near-identical dives in a row.
2. **Read the whole logbook offline.** Everything except profiles and photos, always local.
3. **Sync invisibly.** A quiet indicator; no modal ever blocks logging.
4. **Import on-device.** Divers get UDDF files emailed from a shop's computer on the boat.
   Handing a file to the app should work without a laptop.

### Platform specifics

| Platform | Notes |
|---|---|
| iOS | Apple Sign-In mandatory alongside Google. Files/Share-sheet import. Later: HealthKit dive-session read, Apple Watch companion. |
| Android | Share-target for `.uddf`/`.xml`/`.csv`. Background sync via WorkManager. |
| macOS/Windows | Desktop is where bulk import and cleanup actually happen — drag-and-drop, multi-select, keyboard-driven bulk edit. Do not ship a stretched phone UI. |

### Deliberately not in the Flutter app for v1
Column-mapping UI (complex, rare, desktop/web work) and Bluetooth dive-computer download
(Phase 10).

## Shared Design Language

One visual system across all three clients: shared tokens (color, type, spacing) in
`packages/ui` for React, mirrored in a Flutter theme package. Not shared components across
the React/Flutter boundary — that always ends badly — but shared *decisions*.

Practical constraints that shape it:
- **Sunlight legibility.** High contrast, large type. Dark mode matters for night dives and
  liveaboard cabins.
- **Units render from preference, never hardcoded.** A single `formatDepth(meters, prefs)`
  in domain code, mirrored in Dart.
- **Empty states teach.** A new user with zero dives sees the import path, not a blank table.

## Accessibility
WCAG 2.2 AA for web and admin: keyboard-navigable, screen-reader-labeled, contrast-checked,
respects reduced motion. Flutter: semantic labels, dynamic type, sufficient touch targets.
Charts always have a table equivalent — a depth profile is meaningless to a screen reader
otherwise.
