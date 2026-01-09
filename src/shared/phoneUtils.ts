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
  const digits = processed.replace(/[^0-9]/g, '');

  if (!digits) return '';

  return hasPlus ? `+${digits}` : digits;
};

/**
 * Determines if a sanitized phone number is a US number and returns it
 * in a normalized format (10 digits, no country code).
 *
 * @param clean - A sanitized phone number (digits only, optionally with leading +)
 * @returns Object with isUS flag and normalized digits
 */
export const normalizeUSPhone = (clean: string): { isUS: boolean; digits: string } => {
  // 10 digits: XXXXXXXXXX (US Standard)
  if (/^\d{10}$/.test(clean)) {
    return { isUS: true, digits: clean };
  }

  // 11 digits starting with 1: 1XXXXXXXXXX (US with country code)
  if (/^1\d{10}$/.test(clean)) {
    return { isUS: true, digits: clean.slice(1) };
  }

  // +1 followed by 10 digits: +1XXXXXXXXXX (International format US)
  if (/^\+1\d{10}$/.test(clean)) {
    return { isUS: true, digits: clean.slice(2) };
  }

  return { isUS: false, digits: clean };
};

/**
 * Formats a US phone number (10 digits) with parentheses and dashes.
 * E.g., "5551234567" -> "(555) 123-4567"
 *
 * @param digits - A string of exactly 10 digits
 * @returns Formatted phone number
 */
export const formatUSPhone = (digits: string): string => {
  if (digits.length !== 10) return digits;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

/**
 * Formats a single sanitized phone number for UI display.
 * US numbers: 123-456-7890
 * Extensions: 1234
 * International: +91...
 */
const formatSingleNumber = (phone: string): string => {
    if (!phone) return '';

    // Handle international prefix
    const hasPlus = phone.trim().startsWith('+');
    let clean = phone.replace(/[^0-9]/g, '');

    // Normalize US with 1 prefix
    // Only strip 1 if it's strictly a 10-digit number following it (standard US)
    if (!hasPlus && clean.length === 11 && clean.startsWith('1')) {
        clean = clean.slice(1);
    }

    // Internal Extension: (7) 270-5555
    if (clean.length === 8 && clean.startsWith('7')) {
        return `(7) ${clean.slice(1, 4)}-${clean.slice(4)}`;
    }

    // Format US 10-digit: (XXX) XXX-XXXX
    if (clean.length === 10 && (!hasPlus || (hasPlus && phone.startsWith('+1')))) {
        return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
    }

    // International / Long numbers
    if (hasPlus || clean.length > 10) {
        // If 11 digits and starts with 1 -> +1 (US) -> (1) ...
        if (clean.length === 11 && clean.startsWith('1')) {
            const rest = clean.slice(1);
            return `(1) (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`;
        }

        if (clean.length > 10) {
           if (hasPlus) {
                // Just wrap the prefix in brackets if it exceeds 10 digits.
                const excess = clean.length - 10;
                if (excess > 0 && excess < 4) {
                    const code = clean.slice(0, excess);
                    const rest = clean.slice(excess);
                    const formattedRest = `${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
                    return `(${code}) ${formattedRest}`;
                }
            }
        }
    }

    // Format US 7-digit (local)
    if (clean.length === 7) {
        return `${clean.slice(0, 3)}-${clean.slice(3)}`;
    }

    // Internal Extension (2-6 digits)
    if (clean.length >= 2 && clean.length <= 6) {
        return clean;
    }

    // Fallback
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
            .map(p => formatPhoneNumber(p.trim()))
            .filter(p => !!p)
            .join(', ');
    }

    const input = phone.trim();
    const digitOnly = input.replace(/[^0-9]/g, '');

    // Handle "Run-on" numbers (concatenated 10-digit numbers) without separators
    // e.g. 55555555551111111111 -> split
    if (digitOnly.length >= 20 && digitOnly.length % 10 === 0 && /^\d+$/.test(digitOnly) && !input.startsWith('+')) {
        const subParts: string[] = [];
        for (let i = 0; i < digitOnly.length; i += 10) {
            subParts.push(digitOnly.slice(i, i + 10));
        }
        return subParts.map(formatSingleNumber).join(', ');
    }

    return formatSingleNumber(input);
};

/**
 * Cleans and formats phone numbers from CSV data.
 * Handles messy strings with labels like "Office:", "Ext:", etc.
 * Splits multiple numbers and formats them nicely.
 *
 * @param input - Raw phone number string from CSV
 * @returns Formatted, deduplicated phone numbers separated by ", "
 */
export const cleanAndFormatPhoneNumber = (input: string): string => {
  if (!input) return '';

  // Normalize: Replace known separators with a unique token '|'
  let normalized = input.replace(/(?:Office|Ext|Home|Work|Cell|Fax|Tel|Phone|[:;x])/gi, ' | ');

  // Split by '|' or ','
  const rawParts = normalized.split(/[|,]/).map(s => s.trim()).filter(s => s);

  const cleanedParts: string[] = [];

  for (const part of rawParts) {
      // Sanitize using shared utility
      const sanitized = sanitizePhoneNumber(part);
      if (!sanitized || sanitized.length < 3) continue;

      // Use the advanced formatter
      const formatted = formatSingleNumber(sanitized);
      cleanedParts.push(formatted);
  }

  // Deduplicate
  return Array.from(new Set(cleanedParts)).join(', ');
};
