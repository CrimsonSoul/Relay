/**
 * AlertHistoryOperations - Alert history CRUD operations
 * History entries are stored as JSON
 * Uses cross-process file locking for multi-instance synchronization.
 */

import { join } from 'node:path';
import type { AlertHistoryEntry } from '@shared/ipc';
import { isNodeError } from '@shared/types';
import { loggers } from '../logger';
import { modifyJsonWithLock, readWithLock } from '../fileLock';
import { generateId } from './idUtils';

const HISTORY_FILE = 'alertHistory.json';
const HISTORY_FILE_PATH = (rootDir: string) => join(rootDir, HISTORY_FILE);
const MAX_HISTORY_ENTRIES = 50;
const MAX_PINNED_ENTRIES = 100;
const MAX_HISTORY_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export async function getAlertHistory(rootDir: string): Promise<AlertHistoryEntry[]> {
  const path = HISTORY_FILE_PATH(rootDir);
  try {
    const contents = await readWithLock(path);
    if (!contents) return [];

    try {
      const data = JSON.parse(contents);
      if (!Array.isArray(data)) return [];

      const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
      const pinned = data.filter((entry: AlertHistoryEntry) => entry.pinned);
      const unpinned = data
        .filter((entry: AlertHistoryEntry) => !entry.pinned && entry.timestamp > cutoff)
        .slice(0, MAX_HISTORY_ENTRIES);
      return [...pinned.slice(0, MAX_PINNED_ENTRIES), ...unpinned];
    } catch (parseError) {
      loggers.fileManager.error('[AlertHistoryOperations] JSON parse error:', {
        error: parseError,
        path,
      });
      return [];
    }
  } catch (e) {
    if (isNodeError(e) && e.code === 'ENOENT') return [];
    loggers.fileManager.error('[AlertHistoryOperations] getAlertHistory error:', { error: e });
    throw e;
  }
}

export async function addAlertHistory(
  rootDir: string,
  entry: Omit<AlertHistoryEntry, 'id' | 'timestamp'>,
): Promise<AlertHistoryEntry | null> {
  try {
    let result: AlertHistoryEntry | null = null;
    const path = HISTORY_FILE_PATH(rootDir);

    await modifyJsonWithLock<AlertHistoryEntry[]>(
      path,
      (history) => {
        const now = Date.now();
        const newEntry: AlertHistoryEntry = {
          id: generateId('alerthist'),
          timestamp: now,
          severity: entry.severity,
          subject: entry.subject,
          bodyHtml: entry.bodyHtml,
          sender: entry.sender,
          recipient: entry.recipient ?? '',
          ...(entry.pinned ? { pinned: true } : {}),
          ...(entry.label ? { label: entry.label } : {}),
        };

        history.unshift(newEntry);

        const cutoff = now - MAX_HISTORY_AGE_MS;
        let pinned = history.filter((h) => h.pinned);
        let unpinned = history.filter((h) => !h.pinned && h.timestamp > cutoff);

        if (pinned.length > MAX_PINNED_ENTRIES) {
          pinned = pinned.slice(0, MAX_PINNED_ENTRIES);
        }
        if (unpinned.length > MAX_HISTORY_ENTRIES) {
          unpinned = unpinned.slice(0, MAX_HISTORY_ENTRIES);
        }

        result = newEntry;
        loggers.fileManager.info(`[AlertHistoryOperations] Added history entry: ${newEntry.id}`);
        return [...pinned, ...unpinned].sort((a, b) => {
          // Pinned first, then by timestamp descending
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return b.timestamp - a.timestamp;
        });
      },
      [],
    );

    return result;
  } catch (e) {
    loggers.fileManager.error('[AlertHistoryOperations] addAlertHistory error:', { error: e });
    return null;
  }
}

export async function deleteAlertHistory(rootDir: string, id: string): Promise<boolean> {
  try {
    let deleted = false;
    const path = HISTORY_FILE_PATH(rootDir);

    await modifyJsonWithLock<AlertHistoryEntry[]>(
      path,
      (history) => {
        const initialLength = history.length;
        const filtered = history.filter((h) => h.id !== id);
        if (filtered.length === initialLength) return history;

        deleted = true;
        loggers.fileManager.info(`[AlertHistoryOperations] Deleted history entry: ${id}`);
        return filtered;
      },
      [],
    );

    return deleted;
  } catch (e) {
    loggers.fileManager.error('[AlertHistoryOperations] deleteAlertHistory error:', { error: e });
    return false;
  }
}

export async function clearAlertHistory(rootDir: string): Promise<boolean> {
  try {
    const path = HISTORY_FILE_PATH(rootDir);
    await modifyJsonWithLock<AlertHistoryEntry[]>(path, () => [], []);
    loggers.fileManager.info('[AlertHistoryOperations] Cleared all history');
    return true;
  } catch (e) {
    loggers.fileManager.error('[AlertHistoryOperations] clearAlertHistory error:', { error: e });
    return false;
  }
}

export async function pinAlertHistory(
  rootDir: string,
  id: string,
  pinned: boolean,
): Promise<boolean> {
  try {
    let updated = false;
    const path = HISTORY_FILE_PATH(rootDir);

    await modifyJsonWithLock<AlertHistoryEntry[]>(
      path,
      (history) => {
        const entry = history.find((h) => h.id === id);
        if (!entry) return history;

        entry.pinned = pinned || undefined;
        if (!pinned) delete entry.label;
        updated = true;
        loggers.fileManager.info(
          `[AlertHistoryOperations] ${pinned ? 'Pinned' : 'Unpinned'} entry: ${id}`,
        );
        return [...history];
      },
      [],
    );

    return updated;
  } catch (e) {
    loggers.fileManager.error('[AlertHistoryOperations] pinAlertHistory error:', { error: e });
    return false;
  }
}

export async function updateAlertHistoryLabel(
  rootDir: string,
  id: string,
  label: string,
): Promise<boolean> {
  try {
    let updated = false;
    const path = HISTORY_FILE_PATH(rootDir);

    await modifyJsonWithLock<AlertHistoryEntry[]>(
      path,
      (history) => {
        const entry = history.find((h) => h.id === id);
        if (!entry) return history;

        entry.label = label || undefined;
        updated = true;
        loggers.fileManager.info(`[AlertHistoryOperations] Updated label for entry: ${id}`);
        return [...history];
      },
      [],
    );

    return updated;
  } catch (e) {
    loggers.fileManager.error('[AlertHistoryOperations] updateAlertHistoryLabel error:', {
      error: e,
    });
    return false;
  }
}
