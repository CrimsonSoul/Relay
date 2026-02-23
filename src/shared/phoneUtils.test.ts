import { describe, it, expect } from 'vitest';
import { sanitizePhoneNumber, formatPhoneNumber } from './phoneUtils';

describe('sanitizePhoneNumber', () => {
  it('strips non-numeric characters', () => {
    expect(sanitizePhoneNumber('123-456')).toBe('123456');
    expect(sanitizePhoneNumber('(555) 123')).toBe('555123');
    expect(sanitizePhoneNumber('123 456')).toBe('123456');
  });

  it('preserves leading +', () => {
    expect(sanitizePhoneNumber('+1-555-123')).toBe('+1555123');
    expect(sanitizePhoneNumber('+92 123')).toBe('+92123');
  });

  it('removes labels and extracts number starting from +', () => {
    expect(sanitizePhoneNumber('Phone: 123')).toBe('123');
    expect(sanitizePhoneNumber('Work: +1 234')).toBe('+1234');
    expect(sanitizePhoneNumber('Phone1 (+92 123)')).toBe('+92123');
  });

  it('handles 00 prefix as international +', () => {
    expect(sanitizePhoneNumber('00447700900077')).toBe('+447700900077');
    expect(sanitizePhoneNumber('0091 99049 18167')).toBe('+919904918167');
  });

  it('handles empty strings', () => {
    expect(sanitizePhoneNumber('')).toBe('');
    expect(sanitizePhoneNumber('   ')).toBe('');
    expect(sanitizePhoneNumber('abc')).toBe('');
  });

  it('extracts number from middle of text', () => {
    expect(sanitizePhoneNumber('Call me at +1 555 1234')).toBe('+15551234');
  });
});

describe('formatPhoneNumber', () => {
  it('formats 10 digit US numbers', () => {
    expect(formatPhoneNumber('5551234567')).toBe('(555) 123-4567');
    expect(formatPhoneNumber('1234567890')).toBe('(123) 456-7890');
  });

  it('formats 7 digit local numbers', () => {
    expect(formatPhoneNumber('5551234')).toBe('555-1234');
  });

  it('handles international numbers', () => {
    expect(formatPhoneNumber('+919904918167')).toBe('(91) 990 491 8167');
  });

  it('handles empty string', () => {
    expect(formatPhoneNumber('')).toBe('');
  });

  it('formats 11-digit US number with leading 1 as international', () => {
    // The international formatter catches 11-digit numbers starting with 1 before
    // the US formatter strips the leading 1
    expect(formatPhoneNumber('15551234567')).toBe('(1) (555) 123-4567');
  });

  it('formats 11-digit international number starting with 1 (with +)', () => {
    expect(formatPhoneNumber('+15551234567')).toBe('(1) (555) 123-4567');
  });

  it('formats 8-digit internal extension starting with 7', () => {
    expect(formatPhoneNumber('72705555')).toBe('(7) 270-5555');
  });

  it('formats 2-6 digit short extensions as-is', () => {
    expect(formatPhoneNumber('12')).toBe('12');
    expect(formatPhoneNumber('12345')).toBe('12345');
    expect(formatPhoneNumber('123456')).toBe('123456');
  });

  it('handles multiple numbers separated by commas', () => {
    const result = formatPhoneNumber('5551234567,5559876543');
    expect(result).toBe('(555) 123-4567, (555) 987-6543');
  });

  it('handles multiple numbers separated by semicolons', () => {
    const result = formatPhoneNumber('5551234567;5559876543');
    expect(result).toBe('(555) 123-4567, (555) 987-6543');
  });

  it('handles multiple numbers separated by slashes', () => {
    const result = formatPhoneNumber('5551234567/5559876543');
    expect(result).toBe('(555) 123-4567, (555) 987-6543');
  });

  it('handles multiple numbers separated by pipes', () => {
    const result = formatPhoneNumber('5551234567|5559876543');
    expect(result).toBe('(555) 123-4567, (555) 987-6543');
  });

  it('handles run-on numbers (20+ digits divisible by 10)', () => {
    const runOn = '55512345675559876543';
    const result = formatPhoneNumber(runOn);
    expect(result).toBe('(555) 123-4567, (555) 987-6543');
  });

  it('handles run-on numbers (30 digits)', () => {
    const runOn = '555123456755598765431112223333';
    const result = formatPhoneNumber(runOn);
    expect(result).toContain('(555) 123-4567');
    expect(result).toContain('(555) 987-6543');
    expect(result).toContain('(111) 222-3333');
  });

  it('falls back to raw digits for unrecognized format', () => {
    // 9-digit number that doesn't fit known formats
    const result = formatPhoneNumber('123456789');
    expect(result).toBe('123456789');
  });

  it('falls back to short extension for short international-prefixed number', () => {
    // +12345 → clean='12345' (5 digits) matches the 2-6 digit extension rule
    const result = formatPhoneNumber('+12345');
    expect(result).toBe('12345');
  });
});
