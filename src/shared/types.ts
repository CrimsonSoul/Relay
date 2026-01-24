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
export interface ErrorLike {
    message?: string;
    code?: string;
    stack?: string;
    [key: string]: unknown;
}

/**
 * Type guard for Node.js error with code property
 */
export function isNodeError(err: unknown): err is NodeJS.ErrnoException { // eslint-disable-line no-undef
    return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * Type guard for Error instances
 */
export function isError(value: unknown): value is Error {
    return value instanceof Error;
}

/**
 * Type guard for error-like objects
 */
export function isErrorLike(value: unknown): value is ErrorLike {
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

/**
 * Extract error code from unknown error value
 */
export function getErrorCode(error: unknown): string | undefined {
    if (isError(error)) return (error as NodeJS.ErrnoException).code; // eslint-disable-line no-undef
    if (isErrorLike(error)) return error.code;
    return undefined;
}
