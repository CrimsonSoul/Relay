/**
 * Shared IPC handler utilities
 * Extracted from duplicated code in dataHandlers, featureHandlers, and dataRecordHandlers.
 */

import { ipcMain } from 'electron';
import type { IpcResult } from '@shared/ipc';
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
 * Wraps a mutation handler with outer try/catch to prevent unhandled rejections.
 * Registers the handler on ipcMain.handle with standardized error handling.
 */
export function safeMutation(
  channel: string,
  handler: (...args: unknown[]) => Promise<IpcResult>,
): void {
  ipcMain.handle(channel, async (...args) => {
    try {
      return await handler(...args);
    } catch (e) {
      const msg = getErrorMessage(e);
      loggers.ipc.error(`${channel} failed`, { error: msg });
      return { success: false, error: msg } as IpcResult;
    }
  });
}
