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
        return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    // Handles Internal numbers / Short codes (e.g. 5555)
    if (clean.length > 0 && clean.length <= 5 && !clean.startsWith('+')) {
        return clean;
    }

    // International / Extensions: Keep as-is with prefix but make sure + is there if needed
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

    // Split by common separators if they exist
    const parts = phone.split(/[,;/]/).map(p => p.trim()).filter(p => p);

    const formattedParts = parts.map(part => {
        const clean = sanitizePhoneNumber(part);

        // Check for "Run-on" numbers (concatenated 10-digit numbers)
        // e.g. 55555555551111111111 (20 digits) -> split
        if (/^\d+$/.test(clean) && clean.length > 10 && clean.length % 10 === 0) {
            const subparts: string[] = [];
            for (let i = 0; i < clean.length; i += 10) {
                subparts.push(clean.slice(i, i + 10));
            }
            return subparts.map(formatSingleNumber).join(', ');
        }

        return formatSingleNumber(clean);
    });

    return formattedParts.join(' | '); // Use pipe for cleaner visual separation of multiple numbers
};
