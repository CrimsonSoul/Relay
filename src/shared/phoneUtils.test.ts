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
});
