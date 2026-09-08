import { describe, expect, it } from 'vitest';
import { numberingIsChronological, outOfOrderDives, renumberDives } from './index.ts';

const dive = (id: string, day: number, diveNumber: number) => ({
  id,
  startTimeUtc: new Date(Date.UTC(2026, 0, day)),
  diveNumber,
});

/**
 * A dive number means "the nth dive I have done". The import engine cannot
 * keep that true on its own — it numbers a batch from the diver's current
 * highest, which is right when the file is newer than everything already
 * logged and wrong when it is not — so the check that notices has to be
 * exactly right about what counts as wrong.
 */
describe('numberingIsChronological', () => {
  it('accepts numbers that run with the dates', () => {
    expect(numberingIsChronological([dive('a', 1, 1), dive('b', 2, 2), dive('c', 3, 3)])).toBe(
      true,
    );
  });

  it('accepts gaps, which are somebody counting from their paper logbook', () => {
    // Starting at 100 or skipping 4 is not a defect. Only the direction is.
    expect(
      numberingIsChronological([dive('a', 1, 100), dive('b', 2, 104), dive('c', 3, 999)]),
    ).toBe(true);
  });

  it('rejects a later dive with a lower number', () => {
    expect(numberingIsChronological([dive('a', 1, 1), dive('b', 2, 9), dive('c', 3, 4)])).toBe(
      false,
    );
  });

  it('catches the reversal an import used to produce', () => {
    // A newest-first file numbered by row position: the newest dive gets 1.
    const reversed = [dive('a', 1, 3), dive('b', 2, 2), dive('c', 3, 1)];
    expect(numberingIsChronological(reversed)).toBe(false);
    expect(outOfOrderDives(reversed)).toHaveLength(2);
  });

  it('is true of an empty logbook and of a single dive', () => {
    expect(numberingIsChronological([])).toBe(true);
    expect(numberingIsChronological([dive('a', 1, 7)])).toBe(true);
  });

  it('accepts two dives at the same instant, whichever way round they are', () => {
    // A repetitive dive logged with only a date. Both orders are the diver's
    // own sequence and neither is evidence of anything wrong.
    const a = { id: 'a', startTimeUtc: new Date(0), diveNumber: 1 };
    const b = { id: 'b', startTimeUtc: new Date(0), diveNumber: 2 };
    expect(numberingIsChronological([a, b])).toBe(true);
    expect(numberingIsChronological([b, a])).toBe(true);
  });
});

describe('which dive is named as out of order', () => {
  it('blames the one high outlier, not everything after it', () => {
    // 1, 9, 2, 3 — the 9 is the mistake. Pairwise comparison blames the 2 and
    // the 3 and tells the diver two correct dives are wrong.
    const dives = [dive('a', 1, 1), dive('b', 2, 9), dive('c', 3, 2), dive('d', 4, 3)];
    expect(outOfOrderDives(dives).map((d) => d.id)).toEqual(['b']);
  });

  it('names as few dives as could possibly be at fault', () => {
    // 1, 2, 3, 2. Removing either the 3 or the last 2 leaves the numbering
    // consistent, so both answers are minimal and equally true — which of the
    // two is reported is not something to pin down. What matters is that it
    // is one dive and not three.
    const dives = [dive('a', 1, 1), dive('b', 2, 2), dive('c', 3, 3), dive('d', 4, 2)];
    const named = outOfOrderDives(dives);

    expect(named).toHaveLength(1);
    // And the answer is sufficient: set those aside and the rest is in order.
    const rest = dives.filter((d) => !named.includes(d));
    expect(numberingIsChronological(rest)).toBe(true);
  });

  it('always names a set that is enough to fix', () => {
    // The property, over a shape that is genuinely tangled rather than a case
    // chosen to be easy.
    const dives = [
      dive('a', 1, 4),
      dive('b', 2, 1),
      dive('c', 3, 9),
      dive('d', 4, 5),
      dive('e', 5, 2),
      dive('f', 6, 6),
    ];
    const named = outOfOrderDives(dives);
    const rest = dives.filter((d) => !named.includes(d));

    // 4,5,6 and 1,2,6 and 1,5,6 are all runs of three that already ascend, so
    // three dives are at fault and *which* three is a coin toss between
    // equally true answers. Pinning the ids here would be testing the tie
    // break rather than the behaviour.
    expect(named).toHaveLength(3);
    expect(numberingIsChronological(rest)).toBe(true);
  });

  it('agrees with renumbering about whether anything is wrong', () => {
    // The two have to concur: offering a renumbering that changes nothing, or
    // staying silent while numbering is visibly wrong, are both worse than
    // either being absent.
    const fine = [dive('a', 1, 1), dive('b', 2, 2), dive('c', 3, 3)];
    expect(numberingIsChronological(fine)).toBe(true);
    expect(renumberDives(fine)).toEqual([]);

    const broken = [dive('a', 1, 3), dive('b', 2, 1), dive('c', 3, 2)];
    expect(numberingIsChronological(broken)).toBe(false);
    expect(renumberDives(broken).length).toBeGreaterThan(0);
  });
});
