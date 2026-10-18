import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isBuildId,
  isDirectChild,
  isWindowsExecutableHeader,
  parseExactIniSection,
  parseIniSections,
} from './recoveryFormat';

describe('parseIniSections', () => {
  const catalog = {
    maximumBytes: 1_024,
    maximumLineLength: 4_096,
    comments: true,
    rejectCarriageReturn: true,
  };
  const request = { maximumBytes: 1_024, maximumLineLength: 4_096, comments: false };

  it('reads unique sections and trims keys and values', () => {
    expect(
      parseIniSections('[Relay]\r\n key = value \r\n\r\n[Build.a]\r\nx=1\r\n', catalog),
    ).toEqual(
      new Map([
        ['Relay', new Map([['key', 'value']])],
        ['Build.a', new Map([['x', '1']])],
      ]),
    );
  });

  it.each([
    ['a duplicate section', '[Relay]\n[Relay]\n'],
    ['a duplicate key', '[Relay]\na=1\na=2\n'],
    ['an entry before any section', 'a=1\n'],
    ['an empty section name', '[]\n'],
    ['a line without a key', '[Relay]\n=1\n'],
    ['a NUL byte', '[Relay]\na=\0\n'],
  ])('rejects %s', (_label, text) => {
    expect(parseIniSections(text, catalog)).toBeNull();
    expect(parseIniSections(text, request)).toBeNull();
  });

  it('applies each file dialect', () => {
    const commented = '; native note\n[Relay]\n# another\na=1\n';
    expect(parseIniSections(commented, catalog)?.get('Relay')?.get('a')).toBe('1');
    expect(parseIniSections(commented, request)).toBeNull();

    const strayReturn = '[Relay]\na=1\r2\n';
    expect(parseIniSections(strayReturn, catalog)).toBeNull();
    expect(parseIniSections(strayReturn, request)?.get('Relay')?.get('a')).toBe('1\r2');

    const longLine = `[Relay]\na=${'x'.repeat(4_096)}\n`;
    expect(parseIniSections(longLine, { ...request, maximumBytes: 8_192 })).toBeNull();
    expect(parseIniSections(longLine, { maximumBytes: 8_192, comments: true })).not.toBeNull();

    expect(parseIniSections('[Relay]\na=1\n', { ...request, maximumBytes: 4 })).toBeNull();
  });
});

describe('parseExactIniSection', () => {
  it('requires the one named section with exactly the expected keys', () => {
    expect(
      parseExactIniSection('[Request]\r\na=1\r\nb=2\r\n', 'Request', ['a', 'b'], 1_024),
    ).toEqual(
      new Map([
        ['a', '1'],
        ['b', '2'],
      ]),
    );
    for (const text of [
      '[Request]\na=1\n',
      '[Request]\na=1\nb=2\nc=3\n',
      '[Other]\na=1\nb=2\n',
      '[Request]\na=1\n[Request]\nb=2\n',
      '; note\n[Request]\na=1\nb=2\n',
      '[Request]\na=1\na=1\nb=2\n',
    ]) {
      expect(parseExactIniSection(text, 'Request', ['a', 'b'], 1_024)).toBeNull();
    }
  });
});

describe('recovery names and paths', () => {
  it('accepts only build IDs that are safe Windows directory names', () => {
    expect(isBuildId('r2-abc.1')).toBe(true);
    for (const value of ['con', 'COM1', 'lpt9.x', 'build.', '-build', 'Upper']) {
      expect(isBuildId(value)).toBe(false);
    }
  });

  it('matches only the expected direct child', () => {
    const parent = join('C:', 'Relay');
    expect(isDirectChild(parent, join(parent, 'Recovery'), 'Recovery')).toBe(true);
    expect(isDirectChild(parent, join(parent, 'Other'), 'Recovery')).toBe(false);
    expect(isDirectChild(parent, join('C:', 'Recovery'), 'Recovery')).toBe(false);
  });

  it('recognizes the Windows executable header', () => {
    expect(isWindowsExecutableHeader(Buffer.from('MZ'))).toBe(true);
    expect(isWindowsExecutableHeader(Buffer.from('M'))).toBe(false);
    expect(isWindowsExecutableHeader(Buffer.from('ZM'))).toBe(false);
  });
});
