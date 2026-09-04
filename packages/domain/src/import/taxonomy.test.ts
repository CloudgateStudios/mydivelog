import { describe, expect, it } from 'vitest';
import {
  editDistance,
  matchTag,
  matchTags,
  proposeTags,
  SEED_DIVE_TYPE_TAGS,
  slugify,
  splitValues,
} from './taxonomy.ts';

describe('splitValues', () => {
  it('splits the seed workbook’s dive type cell', () => {
    expect(splitValues('Boat, Dift, Sunset')).toEqual(['Boat', 'Dift', 'Sunset']);
  });

  it('does not split a quoted value containing the delimiter', () => {
    // The site `1,000 Steps` is one place. Splitting it yields a site called
    // `000 Steps`, which is how a dive log quietly grows sites nobody visited.
    expect(splitValues('"1,000 Steps"')).toEqual(['1,000 Steps']);
  });

  it('handles a quoted value beside unquoted ones', () => {
    expect(splitValues('Boat, "1,000 Steps", Drift')).toEqual(['Boat', '1,000 Steps', 'Drift']);
  });

  it('drops empty segments from trailing or doubled delimiters', () => {
    expect(splitValues('Boat,,Drift,')).toEqual(['Boat', 'Drift']);
  });

  it('accepts the other delimiters people use', () => {
    expect(splitValues('Boat; Drift / Night')).toEqual(['Boat', 'Drift', 'Night']);
  });

  it('returns nothing for an empty cell', () => {
    expect(splitValues('')).toEqual([]);
    expect(splitValues('  ')).toEqual([]);
  });
});

describe('slugify', () => {
  it.each([
    ['Angel City', 'angel-city'],
    ['1,000 Steps', '1-000-steps'],
    ['  Drift  ', 'drift'],
    ['Salt/Fresh', 'salt-fresh'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('editDistance', () => {
  it('measures the seed typo', () => {
    expect(editDistance('dift', 'drift')).toBe(1);
  });

  it('is zero for identical strings', () => {
    expect(editDistance('drift', 'drift')).toBe(0);
  });

  it('respects its bound instead of computing the full matrix', () => {
    // Over budget returns max+1, not the true distance — callers only ask
    // whether it is within reach.
    expect(editDistance('boat', 'certification', 2)).toBe(3);
  });

  it('handles empty input', () => {
    expect(editDistance('', 'drift')).toBe(5);
    expect(editDistance('drift', '')).toBe(5);
  });
});

describe('matchTag', () => {
  it('matches an exact value', () => {
    const m = matchTag('Boat', SEED_DIVE_TYPE_TAGS);
    expect(m.kind).toBe('exact');
    expect(m.slug).toBe('boat');
  });

  it('proposes drift for the seed file’s Dift', () => {
    const m = matchTag('Dift', SEED_DIVE_TYPE_TAGS);
    expect(m.kind).toBe('fuzzy');
    expect(m.slug).toBe('drift');
    expect(m.distance).toBe(1);
  });

  it('keeps what the diver wrote alongside the proposal', () => {
    // Review has to show both, or the diver is confirming a correction they
    // cannot see the need for.
    expect(matchTag('Dift', SEED_DIVE_TYPE_TAGS).input).toBe('Dift');
  });

  it('matches through an alias', () => {
    const m = matchTag('Cavern', SEED_DIVE_TYPE_TAGS);
    expect(m.kind).toBe('alias');
    expect(m.slug).toBe('cave');
  });

  it('proposes a new tag when nothing is close', () => {
    const m = matchTag('Muck', SEED_DIVE_TYPE_TAGS);
    expect(m.kind).toBe('new');
    expect(m.slug).toBe('muck');
    expect(m.label).toBe('Muck');
  });

  it('will not guess at a word too short to guess from', () => {
    // One edit from `Cav` reaches `cave`, but three characters is not enough
    // evidence that it was a typo rather than the diver's own shorthand.
    expect(matchTag('Cav', SEED_DIVE_TYPE_TAGS).kind).toBe('new');
    expect(matchTag('Icy', SEED_DIVE_TYPE_TAGS).kind).toBe('new');
  });

  it('allows a wider reach on a long word', () => {
    // Two edits is safe here in a way it is not on `Cav`.
    expect(matchTag('Certifcaton', [{ slug: 'certification', label: 'Certification' }]).kind).toBe(
      'fuzzy',
    );
  });

  it('holds a four-letter word to a single edit', () => {
    // `Dift` → `drift` is one edit and must match. `Reff` → `reef` likewise.
    // But `Bost` should not reach `boat` and `wreck` equally.
    expect(matchTag('Dift', SEED_DIVE_TYPE_TAGS).distance).toBe(1);
    expect(matchTag('Xyzw', SEED_DIVE_TYPE_TAGS).kind).toBe('new');
  });

  it('is case- and punctuation-insensitive on exact matches', () => {
    expect(matchTag('  bOaT ', SEED_DIVE_TYPE_TAGS).kind).toBe('exact');
  });
});

describe('matchTags', () => {
  it('resolves a whole cell', () => {
    const kinds = matchTags('Boat, Dift, Sunset', SEED_DIVE_TYPE_TAGS).map((m) => m.kind);
    expect(kinds).toEqual(['exact', 'fuzzy', 'exact']);
  });
});

describe('proposeTags', () => {
  it('asks about a repeated typo once, not once per row', () => {
    // 39 rows of the real sheet say `Dift`. One question, one answer.
    const matches = Array.from({ length: 39 }, () => matchTag('Dift', SEED_DIVE_TYPE_TAGS));
    const proposals = proposeTags(matches);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.occurrences).toBe(39);
    expect(proposals[0]?.slug).toBe('drift');
  });

  it('orders by how often each was written', () => {
    const matches = [
      ...Array.from({ length: 3 }, () => matchTag('Boat', SEED_DIVE_TYPE_TAGS)),
      matchTag('Muck', SEED_DIVE_TYPE_TAGS),
      ...Array.from({ length: 7 }, () => matchTag('Dift', SEED_DIVE_TYPE_TAGS)),
    ];
    expect(proposeTags(matches).map((p) => p.input)).toEqual(['Dift', 'Boat', 'Muck']);
  });

  it('groups spellings that differ only by case or spacing', () => {
    const proposals = proposeTags([
      matchTag('Boat', SEED_DIVE_TYPE_TAGS),
      matchTag(' boat ', SEED_DIVE_TYPE_TAGS),
    ]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.occurrences).toBe(2);
  });
});
