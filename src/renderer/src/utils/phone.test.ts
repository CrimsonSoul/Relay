import { describe, it, expect } from 'vitest';
import { sanitizePhoneNumber } from './phone';

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
