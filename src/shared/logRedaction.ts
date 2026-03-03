import type { LogData } from './types';

const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '[REDACTED_EMAIL]';
const REDACTED_PHONE = '[REDACTED_PHONE]';
const CIRCULAR = '[Circular]';

// Patterns for detecting PII in string values (applied to bounded log data only)
const EMAIL_PATTERN =
  // eslint-disable-next-line sonarjs/slow-regex -- applied to short, bounded log strings; backtracking risk is negligible
  /[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]\.[a-zA-Z]{2,6}/g;
const PHONE_PATTERN = /(?:\+?\d[\d\s\-().]{5,}\d)/g;

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

/** Redact PII patterns (emails, phone numbers) found in string values. */
function redactPiiInString(value: string): string {
  let result = value.replaceAll(EMAIL_PATTERN, REDACTED_EMAIL);
  result = result.replaceAll(PHONE_PATTERN, REDACTED_PHONE);
  return result;
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactPiiInString(value);

  if (typeof value !== 'object') return value;

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
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

// eslint-disable-next-line sonarjs/function-return-type
export function redactSensitiveData(data: LogData): LogData {
  const redacted = redactValue(data, new WeakMap());
  return redacted !== null && typeof redacted === 'object' ? (redacted as LogData) : data;
}
