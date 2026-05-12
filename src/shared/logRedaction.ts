import type { LogData } from './types';

const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '[REDACTED_EMAIL]';
const REDACTED_PHONE = '[REDACTED_PHONE]';
const CIRCULAR = '[Circular]';

// Patterns for detecting PII in string values (applied to bounded log data only)
const EMAIL_PATTERN =
  // eslint-disable-next-line sonarjs/slow-regex -- applied to short, bounded log strings; backtracking risk is negligible
  /[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]\.[a-zA-Z]{2,6}/g;
const PHONE_PATTERN = /(?:\+?\d(?:[\d\s\-().]*\d){6,})/g;

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

function findSecretEnd(value: string, start: number): number {
  const nextFlag = value.indexOf(' --', start);
  const lineEnd = value.indexOf('\n', start);

  if (nextFlag === -1 && lineEnd === -1) return value.length;
  if (nextFlag === -1) return lineEnd;
  if (lineEnd === -1) return nextFlag;
  return Math.min(nextFlag, lineEnd);
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

    const secretEnd = findSecretEnd(value, secretStart);
    output += value.slice(cursor, secretStart) + REDACTED;
    cursor = secretEnd;
  }

  return output;
}

export function redactLogString(value: string): string {
  let result = redactPocketBaseSuperuserSecrets(value);
  result = result.replaceAll(EMAIL_PATTERN, REDACTED_EMAIL);
  result = result.replaceAll(PHONE_PATTERN, REDACTED_PHONE);
  return result;
}

/** Redact PII patterns (emails, phone numbers) found in string values. */
function redactPiiInString(value: string): string {
  return redactLogString(value);
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactPiiInString(value);

  if (typeof value !== 'object') return value;

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactPiiInString(value.message),
      stack: value.stack ? redactPiiInString(value.stack) : undefined,
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

export function redactSensitiveData(data: LogData): LogData {
  return redactValue(data, new WeakMap()) as LogData;
}
