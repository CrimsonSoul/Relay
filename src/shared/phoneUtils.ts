/**
 * Shared phone number utilities for both main and renderer processes.
 * These utilities handle sanitization and basic formatting of phone numbers.
 */

/**
 * Sanitizes a phone number string by removing all non-numeric characters
 * except for a leading '+' sign (for international numbers).
 *
 * Handles '00' prefix as '+' (common international standard).
 *
 * @param phone - The phone number string to sanitize
 * @returns A sanitized string containing only digits and optionally a leading '+'
 */
export const sanitizePhoneNumber = (phone: string): string => {
  if (!phone) return '';

  let processed = phone.trim();

  // Handle '00' prefix as '+' (common international standard)
  if (processed.startsWith('00')) {
    processed = '+' + processed.slice(2);
  }

  const plusIndex = processed.indexOf('+');

  // If there is a '+', assume the number starts there
  if (plusIndex !== -1) {
    processed = processed.slice(plusIndex);
  }

  // Remove all non-numeric characters, except the leading +
  const hasPlus = processed.startsWith('+');
  const digits = processed.replaceAll(/\D/g, '');

  if (!digits) return '';

  return hasPlus ? `+${digits}` : digits;
};

/**
 * Formats a single sanitized phone number for UI display.
 * US numbers: 123-456-7890
 * Extensions: 1234
 * International: +91...
 */
const formatUSOrExtension = (clean: string, hasPlus: boolean, phone: string): string | null => {
  // Normalize US with 1 prefix
  if (!hasPlus && clean.length === 11 && clean.startsWith('1')) {
    clean = clean.slice(1);
  }

  // Internal Extension: (7) 270-5555
  if (clean.length === 8 && clean.startsWith('7')) {
    return `(7) ${clean.slice(1, 4)}-${clean.slice(4)}`;
  }

  // Format US 10-digit: (XXX) XXX-XXXX
  if (clean.length === 10 && (!hasPlus || phone.startsWith('+1'))) {
    return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
  }

  // Format US 7-digit (local)
  if (clean.length === 7) {
    return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  }

  // Internal Extension (2-6 digits)
  if (clean.length >= 2 && clean.length <= 6) {
    return clean;
  }

  return null;
};

const formatInternational = (clean: string, hasPlus: boolean): string | null => {
  if (hasPlus || clean.length > 10) {
    if (clean.length === 11 && clean.startsWith('1')) {
      const rest = clean.slice(1);
      return `(1) (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`;
    }

    if (clean.length > 10 && hasPlus) {
      const excess = clean.length - 10;
      if (excess > 0 && excess < 4) {
        const code = clean.slice(0, excess);
        const rest = clean.slice(excess);
        const formattedRest = `${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
        return `(${code}) ${formattedRest}`;
      }
    }
  }

  return null;
};

/**
 * Formats a single sanitized phone number for UI display.
 * US numbers: 123-456-7890
 * Extensions: 1234
 * International: +91...
 */
const formatSingleNumber = (phone: string): string => {
  if (!phone) return '';

  const hasPlus = phone.trim().startsWith('+');
  const clean = phone.replaceAll(/\D/g, '');

  const intl = formatInternational(clean, hasPlus);
  if (intl) return intl;

  const usOrExt = formatUSOrExtension(clean, hasPlus, phone);
  if (usOrExt) return usOrExt;

  return hasPlus ? '+' + clean : clean;
};

/**
 * Formats a phone number for UI display.
 * Handles run-on numbers and multiple numbers separated by punctuation.
 *
 * @param phone - Raw phone number string
 * @returns Formatted phone number(s)
 */
export const formatPhoneNumber = (phone: string): string => {
  if (!phone) return '';

  // Split by common separators (comma, semicolon, slash, pipe)
  const parts = phone.split(/[,;/|]/);

  if (parts.length > 1) {
    return parts
      .map((p) => formatPhoneNumber(p.trim()))
      .filter((p) => !!p)
      .join(', ');
  }

  const input = phone.trim();
  const digitOnly = input.replaceAll(/\D/g, '');

  // Handle "Run-on" numbers (concatenated 10-digit numbers) without separators
  // e.g. 55555555551111111111 -> split
  if (
    digitOnly.length >= 20 &&
    digitOnly.length % 10 === 0 &&
    /^\d+$/.test(digitOnly) &&
    !input.startsWith('+')
  ) {
    const subParts: string[] = [];
    for (let i = 0; i < digitOnly.length; i += 10) {
      subParts.push(digitOnly.slice(i, i + 10));
    }
    return subParts.map(formatSingleNumber).join(', ');
  }

  return formatSingleNumber(input);
};
