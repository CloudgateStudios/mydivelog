import { editDistance, slugify } from './taxonomy.ts';

/**
 * Name similarity, 0 to 1.
 *
 * Used for site matching, where `1,000 Steps`, `Thousand Steps` and
 * `1000 Steps` are one place. Slugging handles the punctuation; edit distance
 * handles the rest.
 */
export function nameSimilarity(a: string, b: string): number {
  const x = slugify(a);
  const y = slugify(b);
  if (x === '' || y === '') return 0;
  if (x === y) return 1;

  // A short name inside a longer one is usually the same place qualified:
  // `Angel City` and `Angel City Reef`. Scored high but not exact.
  if (x.includes(y) || y.includes(x)) {
    const ratio = Math.min(x.length, y.length) / Math.max(x.length, y.length);
    return 0.8 + 0.15 * ratio;
  }

  const longest = Math.max(x.length, y.length);
  return Math.max(0, 1 - editDistance(x, y) / longest);
}
