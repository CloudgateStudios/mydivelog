/**
 * Taxonomy matching — turning what a diver typed into tags.
 *
 * The seed workbook's `Dive Type` column holds `"Boat, Dift, Sunset"`: 16
 * distinct combinations built from 8 base values, one of which is a typo
 * repeated in 39 rows. Divers want a controlled vocabulary — this one had
 * already built themselves a `Lists` sheet — so the job is to meet them at the
 * one they invented rather than reject it.
 */

/**
 * Splits a multi-value cell without breaking values that contain the delimiter.
 *
 * The seed workbook contains a site called `1,000 Steps`. Naively splitting the
 * site column on commas turns one site into two, and the second is `000 Steps`.
 * So: respect quotes, and never split a field that was quoted whole.
 */
export function splitValues(cell: string, delimiters = [',', ';', '/', '|']): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | undefined;

  for (const char of cell) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (delimiters.includes(char)) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);

  return out.map((v) => v.trim()).filter((v) => v.length > 0);
}

/** Comparison form: case, punctuation and spacing are not meaningful here. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Levenshtein distance, bounded. Bounding matters: without it a long string
 * pair costs the full matrix to learn what a cheap length check already
 * implies, and this runs against every tag in the taxonomy for every row.
 */
export function editDistance(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (current[j - 1] as number) + 1,
        (previous[j] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    // Every future row is at least this expensive, so stop when the whole row
    // has exceeded the budget.
    if (rowBest > max) return max + 1;
    previous = current;
  }
  return previous[b.length] as number;
}

/**
 * How far a guess may reach, scaled by how much word there is to go on.
 *
 * A flat two-edit budget is wrong at both ends. On a long word it is too
 * cautious; on a short one it is reckless — two edits from a three-letter
 * value reaches a good fraction of any vocabulary, so `Cav` would land on
 * `cave` with the same confidence that `Dift` lands on `drift`, and only one
 * of those is a typo rather than a guess.
 *
 * `Dift` is four characters and one edit from `drift`, which is why the bands
 * start admitting fuzzy matches there.
 */
export function maxEditDistanceFor(slug: string): number {
  if (slug.length <= 3) return 0;
  if (slug.length <= 6) return 1;
  return 2;
}

export type TaxonomyEntry = { slug: string; label: string; aliases?: string[] };

export const TAG_MATCH_KINDS = ['exact', 'alias', 'fuzzy', 'new'] as const;
export type TagMatchKind = (typeof TAG_MATCH_KINDS)[number];

export type TagMatch = {
  /** Exactly as the diver wrote it. Always shown alongside any correction. */
  input: string;
  kind: TagMatchKind;
  slug: string;
  label: string;
  /** Set for a fuzzy match, so review can show how far the guess reached. */
  distance?: number;
};

/**
 * Resolves one written value against a taxonomy.
 *
 * A fuzzy hit is a *proposal*, never an application. `Dift` almost certainly
 * means `drift`, but the diver is the only one who can say so — and they should
 * be asked once for the batch, not 39 times.
 */
export function matchTag(input: string, taxonomy: readonly TaxonomyEntry[]): TagMatch {
  const slug = slugify(input);

  const exact = taxonomy.find((t) => t.slug === slug);
  if (exact) return { input, kind: 'exact', slug: exact.slug, label: exact.label };

  const aliased = taxonomy.find((t) => t.aliases?.some((a) => slugify(a) === slug));
  if (aliased) return { input, kind: 'alias', slug: aliased.slug, label: aliased.label };

  const budget = maxEditDistanceFor(slug);
  let best: { entry: TaxonomyEntry; distance: number } | undefined;
  if (budget > 0) {
    for (const entry of taxonomy) {
      const distance = editDistance(slug, entry.slug, budget);
      if (distance <= budget && (!best || distance < best.distance)) {
        best = { entry, distance };
      }
    }
  }

  if (best) {
    return {
      input,
      kind: 'fuzzy',
      slug: best.entry.slug,
      label: best.entry.label,
      distance: best.distance,
    };
  }

  return { input, kind: 'new', slug, label: input.trim() };
}

/** Splits a cell and resolves every value in it. */
export function matchTags(cell: string, taxonomy: readonly TaxonomyEntry[]): TagMatch[] {
  return splitValues(cell).map((value) => matchTag(value, taxonomy));
}

export type TagProposal = {
  input: string;
  kind: TagMatchKind;
  slug: string;
  label: string;
  distance?: number;
  /** How many rows in the batch wrote this. */
  occurrences: number;
};

/**
 * Collapses per-row matches into one question per distinct input.
 *
 * The diver answers "`Dift` means `drift`?" once, and the answer applies to all
 * 39 rows that wrote it.
 */
export function proposeTags(matches: readonly TagMatch[]): TagProposal[] {
  const byInput = new Map<string, TagProposal>();
  for (const m of matches) {
    const key = slugify(m.input);
    const existing = byInput.get(key);
    if (existing) existing.occurrences += 1;
    else byInput.set(key, { ...m, occurrences: 1 });
  }
  return [...byInput.values()].sort(
    (a, b) => b.occurrences - a.occurrences || a.input.localeCompare(b.input),
  );
}

/**
 * The seeded vocabulary, drawn from what the diver had already written down.
 * Divers extend it; they should not have to invent it.
 */
export const SEED_DIVE_TYPE_TAGS: readonly TaxonomyEntry[] = [
  { slug: 'boat', label: 'Boat' },
  { slug: 'shore', label: 'Shore' },
  { slug: 'drift', label: 'Drift' },
  { slug: 'night', label: 'Night' },
  { slug: 'sunset', label: 'Sunset' },
  { slug: 'wreck', label: 'Wreck' },
  { slug: 'cave', label: 'Cave', aliases: ['cavern'] },
  { slug: 'reef', label: 'Reef' },
  { slug: 'training', label: 'Training', aliases: ['course', 'class'] },
  { slug: 'deep', label: 'Deep' },
  { slug: 'altitude', label: 'Altitude' },
  { slug: 'ice', label: 'Ice' },
];
