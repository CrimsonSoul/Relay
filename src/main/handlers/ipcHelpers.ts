/**
 * Shared IPC handler utilities
 * Extracted from duplicated code in dataHandlers, featureHandlers, and dataRecordHandlers.
 */

import { ipcMain } from 'electron';
import type { IpcResult } from '@shared/ipc';
import { getErrorMessage } from '@shared/types';
import { validateIpcDataSafe } from '@shared/ipcValidation';
import { rateLimiters } from '../rateLimiter';
import { loggers } from '../logger';
import type { z } from 'zod';

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

/**
 * Handler factory that encapsulates the repeated pattern:
 *   1. Check mutation rate limit
 *   2. Validate input against a Zod schema
 *   3. Call an async operation with the validated data
 *   4. Return a standardized IpcResult
 *
 * Wraps everything in safeMutation for outer try/catch and ipcMain registration.
 *
 * @param channel - IPC channel name
 * @param schema - Zod schema to validate the first data argument
 * @param operation - Async function receiving (dataRoot, validatedData) and returning the result
 * @param getDataRoot - Async function to resolve the data directory path
 * @param options.errorLabel - Human-readable label for validation error messages (e.g. "contact data")
 * @param options.mapResult - Optional function to transform the operation result into an IpcResult.
 *                            Defaults to `{ success: !!result, data: result || undefined }`.
 */
export function safeMutationWithValidation<TSchema, TResult = unknown>(
  channel: string,
  schema: z.ZodType<TSchema>,
  operation: (dataRoot: string, validated: TSchema) => Promise<TResult>,
  getDataRoot: () => Promise<string>,
  options?: {
    errorLabel?: string;
    mapResult?: (result: TResult) => IpcResult;
  },
): void {
  const errorLabel = options?.errorLabel ?? 'Invalid data';
  const mapResult =
    options?.mapResult ??
    ((result: TResult): IpcResult => ({
      success: !!result,
      data: (result || undefined) as IpcResult['data'],
    }));

  safeMutation(channel, async (_, data) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };

    const validated = validateIpcDataSafe(schema, data, channel, (m, d) => loggers.ipc.warn(m, d));
    if (!validated) return { success: false, error: errorLabel };

    const result = await operation(await getDataRoot(), validated);
    return mapResult(result);
  });
}
