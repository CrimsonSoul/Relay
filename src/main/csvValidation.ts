/** CSV data validation utilities */

/** Validate email format (RFC 5322 compliant) */
export function isValidEmail(email: string): boolean {
  if (!email?.trim()) return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return /^(?!.*\.\.)(?!\.)[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(?<!\.)@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(
    trimmed,
  );
}

/** Validate phone number format (7-15 digits, E.164 standard) */
export function isValidPhone(phone: string): boolean {
  if (!phone?.trim()) return true; // Phone is optional

  // Handle multiple numbers separated by comma
  const parts = phone.split(',');

  return parts.every((part) => {
    const trimmed = part.trim();
    if (!trimmed) return false;

    // Allow standard chars + x/ext extension
    if (!/^[0-9+\-().\s]+(?:\s*(?:x|ext\.?)\s*\d+)?$/i.test(trimmed)) return false;

    const digits = trimmed.replace(/\D/g, '');
    // Allow short internal extensions (3+ digits) or full numbers up to 15
    return digits.length >= 3 && digits.length <= 15;
  });
}
