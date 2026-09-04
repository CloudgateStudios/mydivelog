import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectFormat } from './detect.ts';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)), 'utf8');

describe('detectFormat', () => {
  it('recognises the real UDDF export', () => {
    expect(detectFormat(fixture('uddf-sample.uddf')).format).toBe('uddf');
  });

  it('recognises the real spreadsheet', () => {
    expect(detectFormat(fixture('spreadsheet-sample.csv')).format).toBe('spreadsheet');
  });

  it('recognises a MyDiveLog export', () => {
    expect(detectFormat('{"format":"mydivelog-logbook-v1","dives":[]}').format).toBe('mydivelog');
  });

  it('sniffs content over extension', () => {
    // A diver exporting from a tool they do not fully understand ends up with
    // XML in a .txt. Refusing that teaches them the product is fussy.
    expect(detectFormat(fixture('uddf-sample.uddf'), 'divelog.txt').format).toBe('uddf');
    expect(detectFormat('a,b,c\n1,2,3', 'export.uddf').format).toBe('spreadsheet');
  });

  it('reads a tab-separated file as tabular', () => {
    expect(detectFormat('Dive\tDate\tDepth\n1\t2026-01-01\t18').format).toBe('spreadsheet');
  });

  it('falls back to the extension when the content says nothing', () => {
    const d = detectFormat('<?xml version="1.0"?><something/>', 'export.uddf');
    expect(d.format).toBe('uddf');
    expect(d.reason).toContain('extension');
  });

  it('says unknown rather than guessing', () => {
    const d = detectFormat('just some prose with no structure', 'notes.txt');
    expect(d.format).toBe('unknown');
    expect(d.reason).toContain('Nothing in the content');
  });

  it('explains itself', () => {
    expect(detectFormat(fixture('uddf-sample.uddf')).reason).toContain('<uddf>');
  });

  it('does not read a one-column file as tabular', () => {
    expect(detectFormat('depth\n18\n22').format).toBe('unknown');
  });
});
