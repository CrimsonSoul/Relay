import type { LogData } from './types';

const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '[REDACTED_EMAIL]';
const REDACTED_PHONE = '[REDACTED_PHONE]';
const CIRCULAR = '[Circular]';

// Patterns for detecting PII in string values (applied to bounded log data only)
const EMAIL_PATTERN =
  /[a-zA-Z0-9][a-zA-Z0-9._%+-]{0,63}@[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}\.[a-zA-Z]{2,63}/g;
// A phone candidate starts at a digit boundary (not inside a word or digit run) and spans
// digits joined by common phone separators. A single quantifier keeps matching linear.
const PHONE_CANDIDATE_PATTERN = /(?<![\w+])\+?\d[\d\s\-().]*\d/g;
const ISO_DATE_PREFIX_PATTERN = /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))(?=\s|$)/;
// Unix epoch seconds or milliseconds; North American numbers never start with 1 unprefixed.
const EPOCH_TIMESTAMP_PATTERN = /^1(?:\d{9}|\d{12})$/;
const MIN_PHONE_DIGITS = 7;
// E.164 allows at most 15 digits.
const MAX_PHONE_DIGITS = 15;

function redactPhoneCandidate(candidate: string): string {
  const isoDate = ISO_DATE_PREFIX_PATTERN.exec(candidate);
  if (isoDate) {
    const [date = ''] = isoDate;
    return (
      date +
      candidate
        .slice(date.length)
        .replaceAll(PHONE_CANDIDATE_PATTERN, (rest) => redactPhoneCandidate(rest))
    );
  }
  const digitCount = candidate.replaceAll(/\D/g, '').length;
  if (digitCount < MIN_PHONE_DIGITS) return candidate;
  // An unbroken run longer than any phone number is an identifier (for example an 18-digit
  // ticket ID). Runs joined by whitespace stay redacted because they can hold several phones.
  if (digitCount > MAX_PHONE_DIGITS && !/\s/.test(candidate)) return candidate;
  if (EPOCH_TIMESTAMP_PATTERN.test(candidate)) return candidate;
  return REDACTED_PHONE;
}

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /api[_-]?key/i,
  /secret/i,
  /authorization/i,
  /cookie/i,
  /email/i,
  /phone/i,
  /mobile/i,
  /telephone/i,
  /address/i,
];

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function findTokenEnd(value: string, start: number): number {
  let index = start;
  while (index < value.length && !isWhitespace(value[index]!)) {
    index++;
  }
  return index;
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && isWhitespace(value[index]!)) {
    index++;
  }
  return index;
}

function redactPocketBaseSuperuserSecrets(value: string): string {
  const marker = 'superuser upsert ';
  let cursor = 0;
  let output = '';

  while (cursor < value.length) {
    const markerIndex = value.indexOf(marker, cursor);
    if (markerIndex === -1) {
      output += value.slice(cursor);
      break;
    }

    const emailStart = markerIndex + marker.length;
    const emailEnd = findTokenEnd(value, emailStart);
    const secretStart = skipWhitespace(value, emailEnd);
    if (secretStart >= value.length || secretStart === emailEnd) {
      output += value.slice(cursor, emailStart);
      cursor = emailStart;
      continue;
    }

    output += value.slice(cursor, secretStart) + REDACTED;
    // Rendered child-process errors do not preserve argv boundaries. Once a
    // known secret-bearing command is found, retaining any later text could
    // preserve a flag-like or multiline suffix from the same passphrase.
    cursor = value.length;
  }

  return output;
}

export function redactLogString(value: string): string {
  let result = redactPocketBaseSuperuserSecrets(value);
  result = result.replaceAll(EMAIL_PATTERN, REDACTED_EMAIL);
  result = result.replaceAll(PHONE_CANDIDATE_PATTERN, redactPhoneCandidate);
  return result;
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactLogString(value);

  if (typeof value !== 'object') return value;

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogString(value.message),
      stack: value.stack ? redactLogString(value.stack) : undefined,
    };
  }

  if (seen.has(value)) return CIRCULAR;

  if (Array.isArray(value)) {
    const redactedArray: unknown[] = [];
    seen.set(value, redactedArray);
    for (const item of value) {
      redactedArray.push(redactValue(item, seen));
    }
    return redactedArray;
  }

  const redactedObject: Record<string, unknown> = {};
  seen.set(value, redactedObject);

  for (const [key, item] of Object.entries(value)) {
    if (shouldRedactKey(key)) {
      redactedObject[key] = REDACTED;
    } else {
      redactedObject[key] = redactValue(item, seen);
    }
  }

  return redactedObject;
}

export function redactSensitiveData(data: unknown): LogData {
  return redactValue(data, new WeakMap()) as LogData;
}
