import { describe, it, expect } from 'vitest';
import { sanitizePhoneNumber, formatUSPhone, normalizeUSPhone } from './phoneUtils';

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

describe('formatUSPhone', () => {
    it('formats 10 digit numbers with parentheses and dashes', () => {
        expect(formatUSPhone('5551234567')).toBe('(555) 123-4567');
        expect(formatUSPhone('1234567890')).toBe('(123) 456-7890');
    });

    it('returns non-10-digit numbers unchanged', () => {
        expect(formatUSPhone('123')).toBe('123');
        expect(formatUSPhone('12345678901')).toBe('12345678901');
        expect(formatUSPhone('+15551234567')).toBe('+15551234567');
    });
});

describe('normalizeUSPhone', () => {
    it('identifies 10-digit US numbers', () => {
        const result = normalizeUSPhone('5551234567');
        expect(result.isUS).toBe(true);
        expect(result.digits).toBe('5551234567');
    });

    it('strips leading 1 from 11-digit numbers', () => {
        const result = normalizeUSPhone('15551234567');
        expect(result.isUS).toBe(true);
        expect(result.digits).toBe('5551234567');
    });

    it('strips +1 from international format US numbers', () => {
        const result = normalizeUSPhone('+15551234567');
        expect(result.isUS).toBe(true);
        expect(result.digits).toBe('5551234567');
    });

    it('identifies non-US international numbers', () => {
        const result1 = normalizeUSPhone('+919904918167');
        expect(result1.isUS).toBe(false);
        expect(result1.digits).toBe('+919904918167');

        const result2 = normalizeUSPhone('+447700900077');
        expect(result2.isUS).toBe(false);
        expect(result2.digits).toBe('+447700900077');
    });

    it('handles edge cases', () => {
        const result1 = normalizeUSPhone('123'); // Too short
        expect(result1.isUS).toBe(false);
        expect(result1.digits).toBe('123');

        const result2 = normalizeUSPhone('12345678901234'); // Too long
        expect(result2.isUS).toBe(false);
        expect(result2.digits).toBe('12345678901234');
    });
});
