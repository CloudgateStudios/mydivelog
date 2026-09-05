import { describe, expect, it } from 'vitest';
import { normalizeQuery } from './saved-views.controller.ts';

/**
 * A saved view is a string, so the thing worth testing is what happens to
 * strings that are not what the writer expected — an old view, a hand-edited
 * URL, a filter that has since been removed.
 */
describe('normalizing a saved view', () => {
  it('keeps the filters', () => {
    expect(normalizeQuery('tag=wreck&minDepthM=30')).toBe('minDepthM=30&sort=date_desc&tag=wreck');
  });

  it('orders keys so the same filters save as the same string', () => {
    expect(normalizeQuery('tag=wreck&q=manta')).toBe(normalizeQuery('q=manta&tag=wreck'));
  });

  it('drops paging, which belongs to a result set and not to a view', () => {
    // A cursor points into one particular page boundary, computed against the
    // logbook as it was. Reopening the view next season must start at the top.
    const q = normalizeQuery('cursor=01890a5d-ac96-774b-bcce-b302099a8057&limit=25&q=manta');
    expect(q).not.toContain('cursor');
    expect(q).not.toContain('limit');
    expect(q).toContain('q=manta');
  });

  it('drops a filter that no longer exists rather than failing the whole view', () => {
    // The case this design exists for: a view saved when `waterType` was a
    // filter still opens, showing the dives its surviving filters describe.
    expect(normalizeQuery('waterType=salt&q=manta')).toBe('q=manta&sort=date_desc');
  });

  it('drops a value the schema rejects', () => {
    // 900 m is past MAX_DEPTH_M. Zod rejects the whole object, so the view
    // opens unfiltered rather than 400ing on a page the diver did not ask for.
    expect(normalizeQuery('minDepthM=900')).toBe('');
  });

  it('survives a string that is not a query at all', () => {
    expect(() => normalizeQuery('%%%')).not.toThrow();
    expect(normalizeQuery('')).toBe('sort=date_desc');
  });

  it('keeps repeated tags, which narrow rather than widen', () => {
    // Object.fromEntries would have kept only the last: a filter meant to find
    // wreck dives at night would have returned every night dive, which is worse
    // than an error because it looks like an answer.
    expect(normalizeQuery('tag=wreck&tag=night')).toBe('sort=date_desc&tag=night&tag=wreck');
  });

  it('treats two tags in either order as one view', () => {
    expect(normalizeQuery('tag=wreck&tag=night')).toBe(normalizeQuery('tag=night&tag=wreck'));
  });
});
