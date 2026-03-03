/**
 * jsonCrudHelper - Generic JSON CRUD utilities to eliminate duplication
 * across *JsonOperations files.
 *
 * All functions use the same file locking mechanism (modifyJsonWithLock / readWithLock)
 * and ENOENT handling as the original operation files.
 */

import { join } from 'node:path';
import type { ZodType } from 'zod';
import { isNodeError } from '@shared/types';
import { loggers } from '../logger';
import { modifyJsonWithLock, readWithLock } from '../fileLock';
import { generateId } from './idUtils';

// ── Configuration ────────────────────────────────────────────────────

export interface JsonCrudConfig {
  /** JSON filename (e.g. 'contacts.json') */
  fileName: string;
  /** Log prefix for messages (e.g. '[ContactJsonOperations]') */
  logPrefix: string;
  /** Optional Zod schema to validate each record on read. Invalid records are filtered out with a warning. */
  recordSchema?: ZodType;
}

// ── Read helpers ─────────────────────────────────────────────────────

/** Validate an array of items against a Zod schema, filtering out invalid records. */
function validateRecords<T>(
  data: unknown[],
  schema: ZodType,
  logPrefix: string,
  path: string,
): T[] {
  const valid: T[] = [];
  let skipped = 0;
  for (const item of data) {
    const result = schema.safeParse(item);
    if (result.success) {
      valid.push(result.data as T);
    } else {
      skipped++;
    }
  }
  if (skipped > 0) {
    loggers.fileManager.warn(`${logPrefix} Skipped ${skipped} invalid record(s) during read`, {
      path,
      skipped,
      total: data.length,
    });
  }
  return valid;
}

/**
 * Read all items from a JSON array file.
 * Handles ENOENT gracefully (returns []), re-throws other errors,
 * and returns [] for invalid JSON or non-array data.
 */
export async function readAll<T>(rootDir: string, config: JsonCrudConfig): Promise<T[]> {
  const path = join(rootDir, config.fileName);
  try {
    const contents = await readWithLock(path);
    if (!contents) return [];

    const data = JSON.parse(contents);
    if (!Array.isArray(data)) return [];

    if (config.recordSchema) {
      return validateRecords<T>(data, config.recordSchema, config.logPrefix, path);
    }

    return data;
  } catch (e) {
    if (isNodeError(e) && e.code === 'ENOENT') return [];
    loggers.fileManager.error(`${config.logPrefix} read error:`, { error: e });
    throw e;
  }
}

// ── Modify helper ────────────────────────────────────────────────────

/**
 * Wraps modifyJsonWithLock with path resolution and the standard
 * empty-array default. Domain-specific logic goes in the modifier callback.
 *
 * Returns the result produced by the modifier via the `capture` callback,
 * or `fallback` if an error is thrown.
 */
export async function modifyItems<TItem, TResult>(
  rootDir: string,
  config: JsonCrudConfig,
  modifier: (items: TItem[]) => TItem[],
  capture: () => TResult,
  fallback: TResult,
  errorAction: string,
): Promise<TResult> {
  try {
    const path = join(rootDir, config.fileName);
    await modifyJsonWithLock<TItem[]>(path, modifier, []);
    return capture();
  } catch (e) {
    loggers.fileManager.error(`${config.logPrefix} ${errorAction} error:`, { error: e });
    return fallback;
  }
}

// ── Standard CRUD operations ─────────────────────────────────────────

/**
 * Delete an item by id from a JSON array file.
 * Returns true if the item was found and removed.
 */
export async function deleteById<TItem extends { id: string }>(
  rootDir: string,
  config: JsonCrudConfig,
  id: string,
  logLabel: string,
): Promise<boolean> {
  let deleted = false;

  return modifyItems<TItem, boolean>(
    rootDir,
    config,
    (items) => {
      const initialLength = items.length;
      const filtered = items.filter((item) => item.id !== id);
      if (filtered.length === initialLength) return items;

      deleted = true;
      loggers.fileManager.info(`${config.logPrefix} Deleted ${logLabel}: ${id}`);
      return filtered;
    },
    () => deleted,
    false,
    `delete${logLabel.charAt(0).toUpperCase() + logLabel.slice(1)}`,
  );
}

/**
 * Update an item by id, merging partial updates and setting updatedAt.
 * Returns true if the item was found and updated.
 */
export async function updateById<TItem extends { id: string; updatedAt: number }>(
  rootDir: string,
  config: JsonCrudConfig,
  id: string,
  updates: Partial<TItem>,
  logField: (item: TItem) => string,
  logLabel: string,
): Promise<boolean> {
  let found = false;

  return modifyItems<TItem, boolean>(
    rootDir,
    config,
    (items) => {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return items;

      items[index] = {
        ...items[index],
        ...updates,
        updatedAt: Date.now(),
      };
      found = true;
      loggers.fileManager.info(
        `${config.logPrefix} Updated ${logLabel}: ${logField(items[index])}`,
      );
      return items;
    },
    () => found,
    false,
    `update${logLabel.charAt(0).toUpperCase() + logLabel.slice(1)}`,
  );
}

type ManagedFields = 'id' | 'createdAt' | 'updatedAt';

/**
 * Bulk upsert items using a dedup key extractor.
 * For each incoming item, if a record with the same key exists it is updated;
 * otherwise a new record is created with a generated id and timestamps.
 */
export async function bulkUpsert<
  TItem extends { id: string; createdAt: number; updatedAt: number },
>(
  rootDir: string,
  config: JsonCrudConfig,
  newItems: Omit<TItem, ManagedFields>[],
  idPrefix: string,
  keyExtractor: (item: Omit<TItem, ManagedFields>) => string,
  existingKeyExtractor: (item: TItem) => string,
  itemLabel: (item: Omit<TItem, ManagedFields>) => string,
): Promise<{ imported: number; updated: number; errors: string[] }> {
  const result = { imported: 0, updated: 0, errors: [] as string[] };
  const path = join(rootDir, config.fileName);

  try {
    await modifyJsonWithLock<TItem[]>(
      path,
      (items) => {
        const itemMap = new Map(items.map((item) => [existingKeyExtractor(item), item]));
        const now = Date.now();

        for (const newItem of newItems) {
          try {
            const key = keyExtractor(newItem);
            const existing = itemMap.get(key);

            if (existing) {
              const updated = {
                ...existing,
                ...newItem,
                updatedAt: now,
              } as TItem;
              itemMap.set(key, updated);
              result.updated++;
            } else {
              const record = {
                id: generateId(idPrefix),
                ...newItem,
                createdAt: now,
                updatedAt: now,
              } as TItem;
              itemMap.set(key, record);
              result.imported++;
            }
          } catch (e) {
            result.errors.push(`Failed to process ${itemLabel(newItem)}: ${e}`);
          }
        }

        loggers.fileManager.info(
          `${config.logPrefix} Bulk upsert: ${result.imported} imported, ${result.updated} updated`,
        );
        return Array.from(itemMap.values());
      },
      [],
    );
  } catch (e) {
    result.errors.push(`Bulk upsert failed: ${e}`);
    loggers.fileManager.error(`${config.logPrefix} bulkUpsert error:`, { error: e });
  }

  return result;
}
