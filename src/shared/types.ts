/**
 * Shared type definitions for improved type safety across the application
 */

/**
 * Flexible log data type - accepts common loggable values
 */
export type LogData =
  | string
  | number
  | boolean
  | null
  | undefined
  | Error
  | Record<string, unknown>
  | unknown[];

/**
 * Error-like object that may or may not be a proper Error instance
 */
interface ErrorLike {
  message?: string;
  code?: string;
  stack?: string;
  [key: string]: unknown;
}

/**
 * Type guard for Node.js error with code property
 */
// eslint-disable-next-line no-undef
export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * Type guard for Error instances
 */
function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Type guard for error-like objects
 */
function isErrorLike(value: unknown): value is ErrorLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('message' in value || 'code' in value || 'stack' in value)
  );
}

/**
 * Extract error message from unknown error value
 */
export function getErrorMessage(error: unknown): string {
  if (isError(error)) return error.message;
  if (isErrorLike(error) && error.message) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
