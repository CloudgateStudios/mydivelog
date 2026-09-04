import { describe, expect, it } from 'vitest';
import {
  applySentinels,
  checkRange,
  cleanNumber,
  cleanSiteName,
  cleanText,
  isNullToken,
  OCEANIC_UDDF_SENTINELS,
} from './sentinels.ts';

describe('null tokens', () => {
  it('treats the seed workbook’s N/A as absent', () => {
    // 40+ rows of the real sheet carry N/A in the site column.
    expect(cleanText('N/A')).toBeUndefined();
    expect(cleanText('n/a')).toBeUndefined();
    expect(cleanText(' - ')).toBeUndefined();
    expect(cleanText('')).toBeUndefined();
  });

  it('keeps a real value, trimmed', () => {
    expect(cleanText('  Angel City  ')).toBe('Angel City');
  });

  it('does not mistake a site named after a null token for one', () => {
    // "Nada" and "Nan" start with null-token text but are not null tokens.
    expect(cleanText('Nada')).toBe('Nada');
    expect(cleanText('Nan')).toBe('Nan');
    expect(isNullToken('none at all')).toBe(false);
  });

  it('accepts a per-format token list', () => {
    expect(cleanText('N/A', ['x'])).toBe('N/A');
    expect(cleanText('x', ['x'])).toBeUndefined();
  });
});

describe('cleanNumber', () => {
  it('parses a plain number', () => {
    expect(cleanNumber('46')).toBe(46);
    expect(cleanNumber(14.099043)).toBe(14.099043);
  });

  it('keeps zero, which is a real reading in most fields', () => {
    // Only a declared sentinel rule may discard a zero; cleaning must not.
    expect(cleanNumber('0')).toBe(0);
    expect(cleanNumber(0)).toBe(0);
  });

  it('strips thousands separators', () => {
    expect(cleanNumber('1,000')).toBe(1000);
  });

  it('returns undefined for text that is not a number', () => {
    expect(cleanNumber('N/A')).toBeUndefined();
    expect(cleanNumber('deep')).toBeUndefined();
    expect(cleanNumber('')).toBeUndefined();
  });
});

describe('sentinel rules', () => {
  it('drops the UDDF leadquantity of zero', () => {
    // The trap: importing 0.0 as a measurement lets a worthless value out-rank
    // the spreadsheet's real 16-24 lbs during merge, because merge prefers a
    // value to no value.
    const r = applySentinels('weightKg', 0, OCEANIC_UDDF_SENTINELS);
    expect(r.value).toBeUndefined();
    expect(r.issues[0]?.code).toBe('sentinel_dropped');
    expect(r.issues[0]?.severity).toBe('info');
  });

  it('keeps a real weight', () => {
    const r = applySentinels('weightKg', 9.07, OCEANIC_UDDF_SENTINELS);
    expect(r.value).toBe(9.07);
    expect(r.issues).toEqual([]);
  });

  it('leaves other fields’ zeros alone', () => {
    // Zero visibility is a miserable dive, but it is a reading.
    expect(applySentinels('visibilityM', 0, OCEANIC_UDDF_SENTINELS).value).toBe(0);
  });
});

describe('range checks', () => {
  it('drops the seed file’s -196 m site altitude', () => {
    // A barometric artifact from the watch, not the Dead Sea.
    const r = checkRange('site.altitudeM', -196);
    expect(r.value).toBeUndefined();
    expect(r.issues[0]?.code).toBe('out_of_range');
  });

  it('keeps a plausible altitude, including a small negative one', () => {
    expect(checkRange('site.altitudeM', 4.59).value).toBe(4.59);
    expect(checkRange('site.altitudeM', -12).value).toBe(-12);
    expect(checkRange('site.altitudeM', 3800).value).toBe(3800); // Lake Titicaca
  });

  it('excludes the Dead Sea, knowingly', () => {
    // The lower bound is -50 m, so the one real dive site below it loses its
    // altitude. That trade is deliberate: see the comment on RANGE_RULES.
    expect(checkRange('site.altitudeM', -420).value).toBeUndefined();
  });

  it('drops an impossible depth', () => {
    expect(checkRange('maxDepthM', 4000).value).toBeUndefined();
    expect(checkRange('maxDepthM', -3).value).toBeUndefined();
  });

  it('keeps a deep technical dive', () => {
    expect(checkRange('maxDepthM', 150).value).toBe(150);
  });

  it('reports NaN rather than storing it', () => {
    const r = checkRange('maxDepthM', Number.NaN);
    expect(r.value).toBeUndefined();
    expect(r.issues[0]?.code).toBe('not_a_number');
  });

  it('passes through a field with no rule', () => {
    expect(checkRange('somethingElse', 99).value).toBe(99);
  });
});

describe('cleanSiteName', () => {
  it('drops a name identical to the site id', () => {
    const id = 'site_69ab7a96dce6e40c7d3abe65';
    expect(cleanSiteName(id, id)).toBeUndefined();
  });

  it('drops an opaque site id even without the id to compare against', () => {
    expect(cleanSiteName('site_69ab7a96dce6e40c7d3abe65')).toBeUndefined();
  });

  it('keeps a real name', () => {
    // The spreadsheet's name plus the watch's coordinates is the merged result
    // that neither file could produce alone.
    expect(cleanSiteName('Angel City', 'site_69ab7a96dce6e40c7d3abe65')).toBe('Angel City');
  });

  it('keeps a name that merely contains the word site', () => {
    expect(cleanSiteName('Site of the Wreck')).toBe('Site of the Wreck');
  });
});
