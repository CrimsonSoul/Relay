/**
 * BridgeHistoryOperations - Bridge history CRUD operations
 * History entries are stored as JSON
 * Uses cross-process file locking for multi-instance synchronization.
 */

import { join } from 'node:path';
import type { BridgeHistoryEntry } from '@shared/ipc';
import { isNodeError } from '@shared/types';
import { loggers } from '../logger';
import { modifyJsonWithLock, readWithLock } from '../fileLock';
import { generateId } from './idUtils';

const HISTORY_FILE = 'bridgeHistory.json';
const HISTORY_FILE_PATH = (rootDir: string) => join(rootDir, HISTORY_FILE);
const MAX_HISTORY_ENTRIES = 100; // Keep last 100 entries
const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function getBridgeHistory(rootDir: string): Promise<BridgeHistoryEntry[]> {
  const path = HISTORY_FILE_PATH(rootDir);
  try {
    const contents = await readWithLock(path);
    if (!contents) return [];

    try {
      const data = JSON.parse(contents);
      if (!Array.isArray(data)) return [];

      // Filter out entries older than 30 days (read-only for this function)
      const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
      return data.filter((entry: BridgeHistoryEntry) => entry.timestamp > cutoff);
    } catch (parseError) {
      loggers.fileManager.error('[BridgeHistoryOperations] JSON parse error:', {
        error: parseError,
        path,
      });
      return [];
    }
  } catch (e) {
    if (isNodeError(e) && e.code === 'ENOENT') return [];
    loggers.fileManager.error('[BridgeHistoryOperations] getBridgeHistory error:', { error: e });
    throw e;
  }
}

export async function addBridgeHistory(
  rootDir: string,
  entry: Omit<BridgeHistoryEntry, 'id' | 'timestamp'>,
): Promise<BridgeHistoryEntry | null> {
  try {
    let result: BridgeHistoryEntry | null = null;
    const path = HISTORY_FILE_PATH(rootDir);

    await modifyJsonWithLock<BridgeHistoryEntry[]>(
      path,
      (history) => {
        const now = Date.now();
        const newEntry: BridgeHistoryEntry = {
          id: generateId('history'),
          timestamp: now,
          note: entry.note,
          groups: entry.groups,
          contacts: entry.contacts,
          recipientCount: entry.recipientCount,
        };

        // Add to beginning (most recent first)
        history.unshift(newEntry);

        // Prune entries older than 30 days
        const cutoff = now - MAX_HISTORY_AGE_MS;
        let filtered = history.filter((h) => h.timestamp > cutoff);

        // Trim to max entries
        if (filtered.length > MAX_HISTORY_ENTRIES) {
          filtered = filtered.slice(0, MAX_HISTORY_ENTRIES);
        }

        result = newEntry;
        loggers.fileManager.info(`[BridgeHistoryOperations] Added history entry: ${newEntry.id}`);
        return filtered;
      },
      [],
    );

    return result;
  } catch (e) {
    loggers.fileManager.error('[BridgeHistoryOperations] addBridgeHistory error:', { error: e });
    return null;
  }
}

export async function deleteBridgeHistory(rootDir: string, id: string): Promise<boolean> {
  try {
    let deleted = false;
    const path = HISTORY_FILE_PATH(rootDir);

    await modifyJsonWithLock<BridgeHistoryEntry[]>(
      path,
      (history) => {
        const initialLength = history.length;
        const filtered = history.filter((h) => h.id !== id);
        if (filtered.length === initialLength) return history;

        deleted = true;
        loggers.fileManager.info(`[BridgeHistoryOperations] Deleted history entry: ${id}`);
        return filtered;
      },
      [],
    );

    return deleted;
  } catch (e) {
    loggers.fileManager.error('[BridgeHistoryOperations] deleteBridgeHistory error:', { error: e });
    return false;
  }
}

export async function clearBridgeHistory(rootDir: string): Promise<boolean> {
  try {
    const path = HISTORY_FILE_PATH(rootDir);
    await modifyJsonWithLock<BridgeHistoryEntry[]>(path, () => [], []);
    loggers.fileManager.info('[BridgeHistoryOperations] Cleared all history');
    return true;
  } catch (e) {
    loggers.fileManager.error('[BridgeHistoryOperations] clearBridgeHistory error:', { error: e });
    return false;
  }
}
