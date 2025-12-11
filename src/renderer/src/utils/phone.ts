export const sanitizePhoneNumber = (phone: string): string => {
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

  return plusIndex !== -1 ? `+${digits}` : digits;
};

export const formatPhoneNumber = (phone: string): string => {
  if (!phone) return '';
  const clean = sanitizePhoneNumber(phone);

  // 10 digits: (XXX) XXX-XXXX
  if (/^\d{10}$/.test(clean)) {
    return `(${clean.slice(0,3)}) ${clean.slice(3,6)}-${clean.slice(6)}`;
  }

  // 11 digits starting with 1: +1 (XXX) XXX-XXXX
  if (/^1\d{10}$/.test(clean)) {
    return `+1 (${clean.slice(1,4)}) ${clean.slice(4,7)}-${clean.slice(7)}`;
  }

  // +1 followed by 10 digits: +1 (XXX) XXX-XXXX
  if (/^\+1\d{10}$/.test(clean)) {
     const nums = clean.slice(2);
     return `+1 (${nums.slice(0,3)}) ${nums.slice(3,6)}-${nums.slice(6)}`;
  }

  // Fallback: return the cleaned number
  return clean;
};
