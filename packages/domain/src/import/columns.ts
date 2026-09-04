/**
 * Derived-column detection.
 *
 * Spreadsheets carry rollups. The seed workbook has `Running Total Time`, a
 * cumulative sum down the sheet, and `Time Out`, which is `Time In + Dive Time`.
 * Neither is a fact about a dive; both are formulas the diver wrote for their
 * own convenience.
 *
 * Importing a rollup as a field is worse than dropping it, because it looks
 * like data. `Running Total Time` on the 197th row is 197 dives' worth of
 * bottom time attached to a single dive, and nothing downstream can tell that
 * it did not mean it.
 *
 * So candidates are detected and default to ignore. The diver can override —
 * detection is a suggestion, and a column that only looks derived is still
 * theirs.
 */

export const DERIVATION_KINDS = ['cumulative', 'sum', 'difference', 'constant'] as const;
export type DerivationKind = (typeof DERIVATION_KINDS)[number];

export type DerivedColumn = {
  column: string;
  kind: DerivationKind;
  /** The columns it is computed from, for `sum` and `difference`. */
  from?: string[];
  /** Plain-language reason, shown in the mapping UI. */
  explanation: string;
};

/** Tolerance for float comparison; spreadsheet day fractions carry noise. */
const EPSILON = 1e-6;

const close = (a: number, b: number): boolean =>
  Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b));

export type NumericColumns = Record<string, readonly (number | undefined)[]>;

/**
 * Finds columns that are exact functions of the others.
 *
 * Deliberately requires an *exact* relationship across every populated row
 * rather than a correlation. A dive log where depth happens to track duration
 * is not a derived column, and dropping it would lose real data.
 *
 * ### Which column in a triangle is the formula?
 *
 * `Time Out = Time In + Dive Time` is true, and so are both rearrangements.
 * Arithmetic cannot say which of the three the diver typed and which the
 * spreadsheet computed — all three are mutually derivable, and a first pass
 * here flagged `Dive Time`, the one column of the three that is a real
 * measurement.
 *
 * The tiebreak: prefer the sum. A spreadsheet computes a total or an end time
 * from its parts, essentially never a part from a total. So sums are settled
 * first, and a column already identified as derived is then barred from
 * serving as evidence that anything else is — which is what stops `Dive Time`
 * from being condemned by `Time Out`, a cell that only exists because of it.
 */
export function detectDerivedColumns(columns: NumericColumns): DerivedColumn[] {
  const names = Object.keys(columns);
  const found: DerivedColumn[] = [];
  const derived = new Set<string>();

  for (const name of names) {
    const values = columns[name];
    if (!values) continue;
    const populated = values.filter((v): v is number => v !== undefined);
    // Two rows can satisfy almost any relationship by coincidence.
    if (populated.length < 3) continue;

    if (populated.every((v) => close(v, populated[0] as number))) {
      found.push({
        column: name,
        kind: 'constant',
        explanation: `Every row holds ${populated[0]}, so this column records nothing about individual dives.`,
      });
      derived.add(name);
      continue;
    }

    const others = names.filter((n) => n !== name);

    const cumulativeOf = others.find((other) => isCumulativeOf(values, columns[other]));
    if (cumulativeOf) {
      found.push({
        column: name,
        kind: 'cumulative',
        from: [cumulativeOf],
        explanation: `This is a running total of ${cumulativeOf}, not a value for one dive.`,
      });
      derived.add(name);
      continue;
    }

    const pair = findSumPair(values, columns, others);
    if (pair) {
      found.push({
        column: name,
        kind: 'sum',
        from: pair,
        explanation: `This equals ${pair[0]} + ${pair[1]} on every row, so it adds nothing.`,
      });
      derived.add(name);
    }
  }

  // Second pass. A column already known to be derived cannot be evidence that
  // another one is: `Dive Time` equals `Time Out` minus `Time In`, but
  // `Time Out` is itself the formula, so that equation proves nothing.
  for (const name of names) {
    if (derived.has(name)) continue;
    const values = columns[name];
    if (!values) continue;
    if (values.filter((v) => v !== undefined).length < 3) continue;

    const usable = names.filter((n) => n !== name && !derived.has(n));
    const diff = findDifferencePair(values, columns, usable);
    if (diff) {
      found.push({
        column: name,
        kind: 'difference',
        from: diff,
        explanation: `This equals ${diff[0]} − ${diff[1]} on every row, so it adds nothing.`,
      });
      derived.add(name);
    }
  }

  return found;
}

/** Is `candidate` the running sum of `source`, read top to bottom? */
function isCumulativeOf(
  candidate: readonly (number | undefined)[],
  source: readonly (number | undefined)[] | undefined,
): boolean {
  if (!source) return false;
  let running = 0;
  let compared = 0;
  for (let i = 0; i < candidate.length; i++) {
    const step = source[i];
    if (step === undefined) continue;
    running += step;
    const value = candidate[i];
    if (value === undefined) continue;
    if (!close(value, running)) return false;
    compared++;
  }
  // A running total that only ever matched on its first row has told us
  // nothing — one row of any column equals the sum of one row.
  return compared >= 3;
}

function findSumPair(
  candidate: readonly (number | undefined)[],
  columns: NumericColumns,
  others: readonly string[],
): [string, string] | undefined {
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      const a = columns[others[i] as string];
      const b = columns[others[j] as string];
      if (holdsForEveryRow(candidate, a, b, (x, y) => x + y)) {
        return [others[i] as string, others[j] as string];
      }
    }
  }
  return undefined;
}

function findDifferencePair(
  candidate: readonly (number | undefined)[],
  columns: NumericColumns,
  others: readonly string[],
): [string, string] | undefined {
  for (const left of others) {
    for (const right of others) {
      if (left === right) continue;
      if (holdsForEveryRow(candidate, columns[left], columns[right], (x, y) => x - y)) {
        return [left, right];
      }
    }
  }
  return undefined;
}

function holdsForEveryRow(
  candidate: readonly (number | undefined)[],
  a: readonly (number | undefined)[] | undefined,
  b: readonly (number | undefined)[] | undefined,
  op: (x: number, y: number) => number,
): boolean {
  if (!a || !b) return false;
  let compared = 0;
  for (let i = 0; i < candidate.length; i++) {
    const value = candidate[i];
    const x = a[i];
    const y = b[i];
    if (value === undefined || x === undefined || y === undefined) continue;
    if (!close(value, op(x, y))) return false;
    compared++;
  }
  return compared >= 3;
}
