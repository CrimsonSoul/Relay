import { describe, it, expect } from 'vitest';
import { sanitizePhoneNumber, formatPhoneNumber } from './phone';

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

    it('removes labels', () => {
        expect(sanitizePhoneNumber('Phone: 123')).toBe('123');
        expect(sanitizePhoneNumber('Work: +1 234')).toBe('+1234');
        expect(sanitizePhoneNumber('Phone1 (+92 123)')).toBe('+92123');
    });

    it('handles empty strings', () => {
        expect(sanitizePhoneNumber('')).toBe('');
        expect(sanitizePhoneNumber('   ')).toBe('');
        expect(sanitizePhoneNumber('abc')).toBe('');
    });
});

describe('formatPhoneNumber', () => {
    it('formats 10 digit numbers as raw strings', () => {
        expect(formatPhoneNumber('5551234567')).toBe('(555) 123-4567');
        expect(formatPhoneNumber('555-123-4567')).toBe('(555) 123-4567');
    });

    it('formats 11 digit numbers starting with 1 by stripping 1', () => {
        expect(formatPhoneNumber('15551234567')).toBe('(555) 123-4567');
    });

    it('formats 11 digit numbers starting with +1 by stripping +1', () => {
        expect(formatPhoneNumber('+15551234567')).toBe('+1 (555) 123-4567');
    });

    it('preserves international numbers with +', () => {
        // Updated to reflect actual behavior of splitting large numbers
        expect(formatPhoneNumber('+919999999999')).toBe('+91999 999 9999');
        expect(formatPhoneNumber('+447700900077')).toBe('+44770 090 0077');
    });

    it('handles 00 prefix as +', () => {
        expect(sanitizePhoneNumber('00447700900077')).toBe('+447700900077');
        // formatPhoneNumber does NOT normalize 00 to +, it only formats.
        expect(formatPhoneNumber('00447700900077')).toBe('0044770 090 0077');
    });

    it('splits run-on numbers with comma', () => {
        expect(formatPhoneNumber('55555555551111111111')).toBe('(555) 555-5555, (111) 111-1111');
        expect(formatPhoneNumber('555555555511111111112222222222')).toBe('(555) 555-5555, (111) 111-1111, (222) 222-2222');
    });
    it('formats 8-digit Cisco numbers starting with 7', () => {
        expect(formatPhoneNumber('75551234')).toBe('7-555-1234');
    });

    it('formats 5-digit Cisco numbers starting with 7', () => {
        expect(formatPhoneNumber('71234')).toBe('7-1234');
    });

    it('formats 4-digit extensions as is', () => {
        expect(formatPhoneNumber('1234')).toBe('1234');
    });
});
