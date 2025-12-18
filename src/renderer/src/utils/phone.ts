import { sanitizePhoneNumber as sharedSanitizePhoneNumber, normalizeUSPhone } from '../../../shared/phoneUtils';

/**
 * Re-export the shared sanitizePhoneNumber utility for backward compatibility
 */
export const sanitizePhoneNumber = sharedSanitizePhoneNumber;

/**
 * Formats a single sanitized phone number for UI display.
 * US numbers are normalized to 10 digits (no formatting).
 * International numbers keep their + prefix.
 */
const formatSingleNumber = (clean: string): string => {
    const { isUS, digits } = normalizeUSPhone(clean);

    if (isUS) {
        return digits; // Return raw 10 digits for US numbers
    }

    // International: Keep as-is with + prefix
    return clean;
};

/**
 * Formats a phone number for UI display.
 * Handles run-on numbers (concatenated 10-digit numbers).
 *
 * @param phone - Raw phone number string
 * @returns Formatted phone number
 */
export const formatPhoneNumber = (phone: string): string => {
    if (!phone) return '';
    const clean = sanitizePhoneNumber(phone);

    // Check for "Run-on" numbers (concatenated 10-digit numbers)
    // e.g. 55555555551111111111 (20 digits) -> split
    // Logic: multiple of 10 digits, > 10
    if (/^\d+$/.test(clean) && clean.length > 10 && clean.length % 10 === 0) {
        const parts: string[] = [];
        for (let i = 0; i < clean.length; i += 10) {
            parts.push(clean.slice(i, i + 10));
        }
        return parts.map(formatSingleNumber).join(', ');
    }

    return formatSingleNumber(clean);
};
