/**
 * Shared IPC handler utilities
 * Extracted from duplicated code in dataHandlers, featureHandlers, and dataRecordHandlers.
 */

import { getErrorMessage } from '@shared/types';
import { rateLimiters } from '../rateLimiter';
import { loggers } from '../logger';

/**
 * Check the data mutation rate limit.
 * Returns true if the operation is allowed, false if rate limited.
 */
export function checkMutationRateLimit(): boolean {
  const result = rateLimiters.dataMutation.tryConsume();
  if (!result.allowed) {
    loggers.ipc.warn(`Data mutation blocked, retry after ${result.retryAfterMs}ms`);
  }
  return result.allowed;
}

/**
 * Converts an unknown error to a truncated string message.
 * Used across handlers for consistent error logging.
 */
export function truncateError(err: unknown, maxLength = 500): string {
  return String(getErrorMessage(err)).slice(0, maxLength);
}
