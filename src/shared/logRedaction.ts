import type { LogData } from './types';

const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /api[_-]?key/i,
  /secret/i,
  /authorization/i,
  /cookie/i,
];

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || value === undefined) return value;

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
