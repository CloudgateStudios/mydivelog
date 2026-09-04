import { describe, expect, it } from 'vitest';
import { parseUddfDateTime } from './datetime.ts';

describe('parseUddfDateTime', () => {
  it('keeps the wall clock and the offset apart', () => {
    // The whole reason this is not `new Date(text)`. That call returns a valid
    // instant with the bogus four-minute offset already baked in, and the
    // information needed to detect the bug is gone before anything can look.
    const t = parseUddfDateTime('2026-03-06T19:07:42.000-00:04');
    expect(t?.local.toISOString()).toBe('2026-03-06T19:07:42.000Z');
    expect(t?.offsetMinutes).toBe(-4);
  });

  it('does not depend on the machine’s timezone', () => {
    // `new Date(y, m, d, …)` resolves in the process's zone, so the same file
    // would import differently on a laptop in Chicago and a Fly machine in UTC.
    const t = parseUddfDateTime('2026-03-06T19:07:42');
    expect(t?.local.toISOString()).toBe('2026-03-06T19:07:42.000Z');
    expect(t?.offsetMinutes).toBeUndefined();
  });

  it.each([
    ['2026-03-06T19:07:42.000-00:06', -6],
    ['2026-03-06T19:07:42.000-00:05', -5],
    ['2026-03-06T19:07:42.000-04:00', -240],
    ['2026-03-06T19:07:42.000+05:30', 330],
    ['2026-03-06T19:07:42.000Z', 0],
    ['2026-03-06T19:07:42-0400', -240],
  ])('%s → offset %i', (text, expected) => {
    expect(parseUddfDateTime(text)?.offsetMinutes).toBe(expected);
  });

  it('preserves the raw text for the audit trail', () => {
    expect(parseUddfDateTime('2026-03-06T19:07:42.000-00:04')?.raw).toBe(
      '2026-03-06T19:07:42.000-00:04',
    );
  });

  it('accepts a timestamp with no seconds', () => {
    expect(parseUddfDateTime('2026-03-06T19:07')?.local.toISOString()).toBe(
      '2026-03-06T19:07:00.000Z',
    );
  });

  it('rounds fractional seconds rather than truncating', () => {
    expect(parseUddfDateTime('2026-03-06T19:07:42.6')?.local.toISOString()).toBe(
      '2026-03-06T19:07:42.600Z',
    );
  });

  it('returns undefined for text it cannot read, rather than an Invalid Date', () => {
    // An Invalid Date propagates silently; undefined forces a decision at the
    // call site and becomes a per-row issue.
    for (const bad of ['', 'not a date', '06/03/2026']) {
      expect(parseUddfDateTime(bad), bad).toBeUndefined();
    }
  });

  it('rejects an impossible date instead of rolling it over', () => {
    // Date.UTC turns month 13 into January of the next year without complaint,
    // which would import a dive into a year it did not happen in.
    expect(parseUddfDateTime('2026-13-06T19:07:42')).toBeUndefined();
  });

  it('ignores a trailing offset it cannot read rather than guessing', () => {
    const t = parseUddfDateTime('2026-03-06T19:07:42 GMT-4');
    expect(t?.local.toISOString()).toBe('2026-03-06T19:07:42.000Z');
    expect(t?.offsetMinutes).toBeUndefined();
  });
});
