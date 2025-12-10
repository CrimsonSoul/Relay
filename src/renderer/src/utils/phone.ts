
export function sanitizePhoneNumber(phone: string): string {
    if (!phone) return '';

    let processed = phone;
    const plusIndex = phone.indexOf('+');

    // If there is a '+', assume the number starts there
    if (plusIndex !== -1) {
        processed = phone.slice(plusIndex);
    }

    // Remove all non-numeric characters
    const digits = processed.replace(/[^0-9]/g, '');

    if (!digits) return '';

    // If the original (or sliced) string started with +, prepend it
    // Wait, processed starts with + if plusIndex !== -1.
    // So if plusIndex !== -1, we want +digits.
    // But if processed was just "+" (digits empty), we return empty.

    return plusIndex !== -1 ? `+${digits}` : digits;
}
