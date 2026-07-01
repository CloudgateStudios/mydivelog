# Workbook Findings

The attached workbook, `Dive Log-2.xlsx`, is a useful seed for the first data model. It contains 197 non-empty dive rows across a long-running personal log from 2012 through 2026.

## Workbook Structure

- `Overview & Summary`: derived summary values such as number of dives, total underwater time, average dive length, and average water temperature.
- `Dive Data`: primary dive log table.
- `Graphs`: placeholder or empty graph sheet.
- `Lists`: lookup values for location, gas, water type, dive type, and gear.

## Dive Data Fields

The primary table tracks:

- Dive number.
- Date.
- Time in.
- Dive time.
- Time out.
- Running total time.
- Max depth in feet.
- Air temperature in Fahrenheit.
- Water temperature in Fahrenheit.
- Visibility in feet.
- Location.
- Dive site.
- Water type.
- Dive type.
- Gas.
- EAN percentage.
- Equipment.
- Weight in pounds.
- Notes.

## Domain Signals

The workbook shows several important patterns:

- Dive number is meaningful to the diver, but should not be the database primary key.
- Some values are derived, such as time out and running total time.
- Time fields are sometimes missing, while duration and depth are still known.
- Dive type is multi-valued in practice, for example `Shore, Night`.
- Equipment is multi-valued and currently stored as comma-separated text.
- Locations and dive sites are related but not normalized.
- Gas starts simple with Air and EAN, but EAN percentages vary.
- Units are currently imperial, but the product should support metric users.
- Notes are free-form and can include memorable details, operators, conditions, or sightings.

## MVP Import Mapping

| Workbook field        | Proposed model target                                                                                                                    | Notes                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Dive Number           | `dives.userDiveNumber`                                                                                                                   | User-scoped sequence, editable.                               |
| Date                  | `dives.diveDate`                                                                                                                         | Preserve date even when time is unknown.                      |
| Time In               | `dives.timeInLocal`                                                                                                                      | Optional local time.                                          |
| Dive Time             | `dives.durationSeconds`                                                                                                                  | Store as seconds.                                             |
| Time Out              | Derived or `dives.timeOutLocal`                                                                                                          | Can be recomputed when time in and duration are present.      |
| Running Total Time    | Derived                                                                                                                                  | Do not store as source of truth.                              |
| Max Depth (ft)        | `dives.maxDepthEnteredValue`, `dives.maxDepthEnteredUnit`, `dives.maxDepthMeters`                                                        | Preserve feet as entered and store meters canonically.        |
| Air Temperature (F)   | `dive_conditions.airTemperatureEnteredValue`, `dive_conditions.airTemperatureEnteredUnit`, `dive_conditions.airTemperatureCelsius`       | Preserve Fahrenheit as entered and store Celsius canonically. |
| Water Temperature (F) | `dive_conditions.waterTemperatureEnteredValue`, `dive_conditions.waterTemperatureEnteredUnit`, `dive_conditions.waterTemperatureCelsius` | Preserve Fahrenheit as entered and store Celsius canonically. |
| Visibility (ft)       | `dive_conditions.visibilityEnteredValue`, `dive_conditions.visibilityEnteredUnit`, `dive_conditions.visibilityMeters`                    | Preserve feet as entered and store meters canonically.        |
| Location              | `locations.name`                                                                                                                         | User-created at first, later canonicalizable.                 |
| Dive Site             | `dive_sites.name`                                                                                                                        | Belongs to location when known.                               |
| Water Type            | `dives.waterType`                                                                                                                        | Enum candidate: fresh, salt, mixed, unknown.                  |
| Dive Type             | `dive_type_tags`                                                                                                                         | Multi-select tags.                                            |
| Gas                   | `gas_mixes.type`                                                                                                                         | Air, nitrox/EAN, trimix, other later.                         |
| EAN %                 | `gas_mixes.oxygenPercent`                                                                                                                | Required for nitrox when known.                               |
| Equipment             | `gear_items`, `dive_gear_usage`                                                                                                          | Split and create structured gear records immediately.         |
| Weight (lbs)          | `dives.weightCarriedEnteredValue`, `dives.weightCarriedEnteredUnit`, `dives.weightCarriedKilograms`                                      | Preserve pounds as entered and store kilograms canonically.   |
| Notes                 | `dives.notes`                                                                                                                            | Free text.                                                    |

## Import Considerations

- Keep the original spreadsheet row number for traceability during import.
- Preserve raw source values alongside parsed values for audit and retry.
- Create structured gear, locations, sites, and dive type tags during import, with user review before finalizing when possible.
- Treat import as idempotent by using an import batch ID plus source row identity.
- Avoid overwriting existing dives automatically unless the user explicitly confirms a merge.
