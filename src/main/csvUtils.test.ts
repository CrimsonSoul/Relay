
import { describe, it, expect } from 'vitest';
import { sanitizeCsvContent } from './csvUtils';

describe('sanitizeCsvContent', () => {
  it('strips BOM', () => {
    const input = '\uFEFFheader1,header2\nvalue1,value2';
    const expected = 'header1,header2\nvalue1,value2';
    expect(sanitizeCsvContent(input)).toBe(expected);
  });

  it('normalizes CRLF to LF', () => {
    const input = 'line1\r\nline2\r\nline3';
    const expected = 'line1\nline2\nline3';
    expect(sanitizeCsvContent(input)).toBe(expected);
  });

  it('normalizes CR to LF', () => {
    const input = 'line1\rline2\rline3';
    const expected = 'line1\nline2\nline3';
    expect(sanitizeCsvContent(input)).toBe(expected);
  });

  it('removes null bytes', () => {
    const input = 'va\x00lue1,va\x00lue2';
    const expected = 'value1,value2';
    expect(sanitizeCsvContent(input)).toBe(expected);
  });

  it('handles mixed cases', () => {
    const input = '\uFEFFline1\r\nline2\rline3\x00';
    const expected = 'line1\nline2\nline3';
    expect(sanitizeCsvContent(input)).toBe(expected);
  });

  it('leaves already clean content alone', () => {
    const input = 'header1,header2\nvalue1,value2';
    expect(sanitizeCsvContent(input)).toBe(input);
  });
});
