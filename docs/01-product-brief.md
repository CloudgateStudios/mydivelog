# Product Brief

## Problem

A diver with 200 dives typically has them scattered across:

- a spreadsheet they started years ago and maintain by hand
- a dive computer vendor's app (Shearwater Cloud, Garmin Connect, Suunto, Oceanic+)
- a second vendor's app, because they changed computers
- a paper logbook with instructor signatures for the early dives
- photos in a camera roll, unconnected to any of it

None of these talk to each other. The vendor apps only hold dives recorded on that
vendor's hardware. The spreadsheet holds everything but no depth profiles. The paper log
holds the certification dives that matter for proof. Nothing is complete, and nothing is
safe — the spreadsheet lives in one Dropbox folder and the vendor cloud can be shut down
by a business decision the diver has no say in.

## Product

One canonical logbook that:

1. **Absorbs everything.** Any format, any vendor, any spreadsheet shape.
2. **Merges rather than duplicates.** The spreadsheet row and the dive computer track for
   the same dive become one dive holding both.
3. **Is available everywhere.** Web, iOS, Android, macOS, Windows — and on a dive boat
   with no signal.
4. **Can be taken away.** Full-fidelity export at any time, no paid gate on your own data.

## Users

| User | Needs |
|---|---|
| **The consolidator** (primary) | Has 100–500 dives in 3+ places. Wants one clean history without retyping. Judges the product entirely on whether import works. |
| **The active diver** | 20–80 dives/year. Logs on a trip, often offline. Wants fast entry and automatic pickup from their computer. |
| **The new diver** | <20 dives. Starting fresh, wants a nice logbook and to not lose it. Low import needs, high polish needs. |
| **The professional** | Divemaster/instructor. Needs totals, proof of experience, signatures, and export to agency formats. |

The consolidator is who v1 is for. They are the hardest to win and the ones whose problem
nobody has solved.

## Product Principles

1. **Never silently lose or overwrite a diver's data.** Merges are reversible and every
   field records where it came from. An import can always be undone.
2. **Never silently invent data.** If a source lacks a value, it stays empty. Derived
   values are labeled as derived.
3. **Units are a display concern, never a storage concern.** Store SI, render whatever
   the diver prefers.
4. **The diver is the authority.** Automatic merging proposes; the diver disposes. Any
   automatic decision must be visible and undoable.
5. **Offline is a first-class state, not an error state.**
6. **Export parity is a feature we advertise.** Lock-in is the incumbent's strategy; the
   absence of it is ours.

## v1 Scope (Public Launch)

**In:**
- Sign in with Google, Apple, or email link
- Full dive CRUD with the field set derived from real data (see [Data Model](./04-data-model.md))
- Import: UDDF, Subsurface, generic CSV/XLSX with a saved column-mapping UI
- Merge review: candidate detection, side-by-side reconciliation, field-level provenance
- Export: UDDF, CSV, JSON, PDF logbook
- Dive sites with geo, shared site database, map view
- Trips, gear, tanks/gas, tags, buddies (as text)
- Stats and charts: totals, depth/time distribution, sites, per-year
- Web portal + admin panel
- Free tier and paid tier with Stripe billing

**Out of v1, explicitly:**
- Dive computer Bluetooth download (Phase 10 — needs per-vendor reverse engineering)
- Social feed, following, public profiles
- Photo/video storage (Phase 9 — the cost model changes materially)
- Buddy verification / digital instructor signatures
- Decompression planning or any real-time dive guidance

## Non-Goals, Permanently

- **MyDiveLog is not a dive computer and gives no in-water guidance.** No deco calculation,
  no no-fly timers presented as safety advice, no gas planning that a diver could act on.
  This is a records product. It is stated in the ToS and it keeps the liability surface small.
- Not a dive shop booking or e-commerce platform.
- Not a training-records system of record for agencies.

## Success Signals

| Horizon | Signal |
|---|---|
| Phase 3 | The author's own 197-row spreadsheet and 96-dive UDDF merge into one verified history |
| Launch + 3mo | 100 users have completed an import of >50 dives |
| Launch + 6mo | Median imported user has dives from ≥2 distinct source formats |
| Launch + 12mo | Paid conversion covers hosting; >0 users have used export and stayed |

The last one matters: if people can leave freely and don't, the product is real.
