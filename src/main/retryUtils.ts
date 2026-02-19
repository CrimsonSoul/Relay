/**
 * Retry utilities for handling transient failures
 *
 * Provides exponential backoff and jitter for resilient operations
 */

import { loggers } from './logger';

export type RetryOptions = {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
};

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitter: true,
  shouldRetry: () => true,
  onRetry: () => {},
};

/**
 * Retry an async operation with exponential backoff
 */
export async function retryAsync<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (!opts.shouldRetry(error)) {
        throw error;
      }

      // If this was the last attempt, throw
      if (attempt >= opts.maxAttempts) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const baseDelay = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
        opts.maxDelayMs,
      );

      // Add jitter to prevent thundering herd
      const delay = opts.jitter ? baseDelay * (0.5 + Math.random() * 0.5) : baseDelay;

      // Notify about retry
      opts.onRetry(attempt, error);

      // Wait before retrying
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Check if an error is transient (safe to retry)
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const transientPatterns = [
      'ebusy', // File is busy
      'eagain', // Resource temporarily unavailable
      'etimedout', // Operation timed out
      'econnreset', // Connection reset
      'enotfound', // DNS lookup failed
      'epipe', // Broken pipe
      'locked', // File locked
      'busy', // Generic busy message
    ];

    return transientPatterns.some((pattern) => message.includes(pattern));
  }

  return false;
}

/**
 * Check if an error is a file system error that should be retried
 */
export function isRetryableFileSystemError(error: unknown): boolean {
  if (error instanceof Error && 'code' in error) {
    const code = (error as NodeJS.ErrnoException).code;
    const retryableCodes = [
      'EBUSY', // File is busy
      'EAGAIN', // Resource temporarily unavailable
      'EACCES', // Permission denied (might be temporary)
      'EPERM', // Operation not permitted (might be temporary)
      'EMFILE', // Too many open files
      'ENFILE', // File table overflow
    ];

    return retryableCodes.includes(code || '');
  }

  return isTransientError(error);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a file system operation with appropriate defaults
 */
export async function retryFileOperation<T>(
  operation: () => Promise<T>,
  operationName: string,
): Promise<T> {
  return retryAsync(operation, {
    maxAttempts: 3,
    initialDelayMs: 50,
    maxDelayMs: 1000,
    shouldRetry: isRetryableFileSystemError,
    onRetry: (attempt, error) => {
      loggers.fileManager.warn(`Retrying ${operationName} (attempt ${attempt}/3)`, { error });
    },
  });
}

/**
 * Retry a network operation with appropriate defaults
 */
export async function retryNetworkOperation<T>(
  operation: () => Promise<T>,
  operationName: string,
): Promise<T> {
  return retryAsync(operation, {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    shouldRetry: (error) => {
      // Retry on network errors and 5xx responses
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        // Check for 5xx HTTP status codes (500-599)
        const has5xxError = /\b5\d\d\b/.test(message);
        return (
          isTransientError(error) ||
          message.includes('network') ||
          message.includes('timeout') ||
          has5xxError
        );
      }
      return false;
    },
    onRetry: (attempt, error) => {
      loggers.main.warn(`Retrying ${operationName} (attempt ${attempt}/3)`, { error });
    },
  });
}
