/** CSV data validation utilities */

/** Validate email format */
export function isValidEmail(email: string): boolean {
  if (!email?.trim()) return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  if (trimmed.includes('..')) return false;

  const localPart = trimmed.split('@')[0];
  if (!localPart || localPart.startsWith('.') || localPart.endsWith('.')) return false;

  // eslint-disable-next-line sonarjs/slow-regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return emailRegex.test(trimmed);
}

/** Validate phone number format (7-15 digits, E.164 standard) */
export function isValidPhone(phone: string): boolean {
  if (!phone?.trim()) return true; // Phone is optional

  // Handle multiple numbers separated by comma
  const parts = phone.split(',');

  return parts.every((part) => {
    const trimmed = part.trim();
    if (!trimmed) return false;

    // Check for base standard chars, without complex suffix
    // eslint-disable-next-line sonarjs/slow-regex
    const withoutExt = trimmed.replace(/\s*(?:x|ext\.?)\s*\d+$/i, '');
    if (!/^[0-9+\-().\s]+$/.test(withoutExt)) return false;

    const digits = trimmed.replaceAll(/\D/g, '');
    // Allow short internal extensions (3+ digits) or full numbers up to 15
    return digits.length >= 3 && digits.length <= 15;
  });
}
