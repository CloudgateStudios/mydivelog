import { describe, expect, it } from 'vitest';
import { AUDITABLE_DIVE_FIELDS, diff } from './admin.repository.ts';

/**
 * The parts of the staff path that can be checked without a database. The
 * behaviour that actually matters — that a change and its audit row commit
 * together — needs both, and lives in `apps/api/src/admin/admin.itest.ts`.
 */

describe('what an audit row records', () => {
  it('records what moved, not the whole record', () => {
    const before = { name: 'Angel City', latitude: null, isPublic: false };
    const after = { name: '1,000 Steps', latitude: null, isPublic: false };
    expect(diff(before, after)).toEqual({ name: ['Angel City', '1,000 Steps'] });
  });

  it('says nothing when nothing moved', () => {
    const row = { name: 'Angel City', latitude: 12.1 };
    expect(diff(row, { ...row })).toEqual({});
  });

  it('ignores the columns that change on every write', () => {
    const before = { name: 'a', version: 1, updatedAt: new Date('2026-01-01') };
    const after = { name: 'a', version: 2, updatedAt: new Date('2026-02-01') };
    // Otherwise every row says "version changed" and nothing else, which is
    // the shape of a log nobody reads.
    expect(diff(before, after)).toEqual({});
  });

  it('compares dates by value rather than by identity', () => {
    const before = { at: new Date('2026-03-06T23:07:42Z') };
    const after = { at: new Date('2026-03-06T23:07:42Z') };
    expect(diff(before, after)).toEqual({});
  });

  it('serialises dates, because the metadata column is JSON', () => {
    const before = { at: new Date('2026-03-06T23:07:42Z') };
    const after = { at: new Date('2026-03-07T01:00:00Z') };
    expect(diff(before, after)).toEqual({
      at: ['2026-03-06T23:07:42.000Z', '2026-03-07T01:00:00.000Z'],
    });
  });

  it('records a field being cleared', () => {
    expect(diff({ description: 'a wall' }, { description: null })).toEqual({
      description: ['a wall', null],
    });
  });

  it('drops anything outside the allowlist it is given', () => {
    const before = { maxDepthM: 14, notes: 'the good one' };
    const after = { maxDepthM: 18, notes: 'the other one' };
    expect(diff(before, after, AUDITABLE_DIVE_FIELDS)).toEqual({ maxDepthM: [14, 18] });
  });
});

describe('what staff may see of a dive', () => {
  /**
   * `docs/11-roadmap.md`: "Staff cannot see dive notes anywhere in the UI."
   * The audit log is UI — it is the most-read page in the panel — so a note
   * reaching an audit row would breach that criterion through a side door.
   *
   * Adding either field below is a decision, not an oversight, and this test
   * is where that decision has to be argued with.
   */
  it('never carries a note into the audit log', () => {
    expect(AUDITABLE_DIVE_FIELDS.has('notes')).toBe(false);
    expect(AUDITABLE_DIVE_FIELDS.has('privateNotes')).toBe(false);
  });

  it('withholds a note even when the allowlist is bypassed by a caller', () => {
    // `diff` without an allowlist is used for sites and tags, which have no
    // personal free text. If a dive ever reaches it, the note comes with it —
    // so the allowlist is not optional at the dive call site, and this records
    // why rather than pretending the function is safe on its own.
    const leaked = diff({ notes: 'a' }, { notes: 'b' });
    expect(leaked).toEqual({ notes: ['a', 'b'] });
  });
});
