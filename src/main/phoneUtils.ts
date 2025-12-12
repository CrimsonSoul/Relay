import { sanitizePhoneNumber, formatUSPhone, normalizeUSPhone } from '../shared/phoneUtils';

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
  // This splits strings like "Office:79984456 Ext:877-273-9002" into separate numbers
  let normalized = input.replace(/(?:Office|Ext|Home|Work|Cell|Fax|Tel|Phone|[:;])/gi, ' | ');

  // Split by '|' or ','
  const rawParts = normalized.split(/[|,]/).map(s => s.trim()).filter(s => s);

  const cleanedParts: string[] = [];

  for (const part of rawParts) {
      // Sanitize using shared utility
      const sanitized = sanitizePhoneNumber(part);
      if (!sanitized || sanitized.length < 3) continue; // Ignore tiny fragments like "1" or "0"

      // Format using shared utility
      const formatted = formatPhoneForDisplay(sanitized);
      cleanedParts.push(formatted);
  }

  // Deduplicate
  return Array.from(new Set(cleanedParts)).join(', ');
};

/**
 * Formats a sanitized phone number for display in CSV data.
 * US numbers get formatted with parentheses: (555) 123-4567
 * International numbers are kept as-is with their + prefix.
 */
const formatPhoneForDisplay = (clean: string): string => {
    const { isUS, digits } = normalizeUSPhone(clean);

    if (isUS) {
        return formatUSPhone(digits);
    }

    // International or other: Keep as-is
    return clean;
};
