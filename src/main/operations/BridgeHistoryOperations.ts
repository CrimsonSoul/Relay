/**
 * BridgeHistoryOperations - Bridge history CRUD operations
 * History entries are stored as JSON
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { BridgeHistoryEntry } from "@shared/ipc";
import { loggers } from "../logger";

const HISTORY_FILE = "bridgeHistory.json";
const MAX_HISTORY_ENTRIES = 100; // Keep last 100 entries
const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateId(): string {
  return `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function getBridgeHistory(rootDir: string): Promise<BridgeHistoryEntry[]> {
  const path = join(rootDir, HISTORY_FILE);
  try {
    if (!existsSync(path)) return [];
    const contents = await fs.readFile(path, "utf-8");
    const data = JSON.parse(contents);
    if (!Array.isArray(data)) return [];

    // Filter out entries older than 30 days
    const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
    const filtered = data.filter((entry: BridgeHistoryEntry) => entry.timestamp > cutoff);

    // Persist the pruning to prevent unbounded file growth
    if (filtered.length < data.length) {
      loggers.fileManager.debug(`[BridgeHistoryOperations] Pruning ${data.length - filtered.length} old history entries`);
      await writeHistory(rootDir, filtered);
    }

    return filtered;
  } catch (e) {
    loggers.fileManager.error("[BridgeHistoryOperations] getBridgeHistory error:", { error: e });
    return [];
  }
}

async function writeHistory(rootDir: string, history: BridgeHistoryEntry[]): Promise<void> {
  const path = join(rootDir, HISTORY_FILE);
  const content = JSON.stringify(history, null, 2);
  await fs.writeFile(`${path}.tmp`, content, "utf-8");
  await fs.rename(`${path}.tmp`, path);
}

export async function addBridgeHistory(
  rootDir: string,
  entry: Omit<BridgeHistoryEntry, "id" | "timestamp">
): Promise<BridgeHistoryEntry | null> {
  try {
    let history = await getBridgeHistory(rootDir);
    const newEntry: BridgeHistoryEntry = {
      id: generateId(),
      timestamp: Date.now(),
      note: entry.note,
      groups: entry.groups,
      contacts: entry.contacts,
      recipientCount: entry.recipientCount,
    };

    // Add to beginning (most recent first)
    history.unshift(newEntry);

    // Trim to max entries
    if (history.length > MAX_HISTORY_ENTRIES) {
      history = history.slice(0, MAX_HISTORY_ENTRIES);
    }

    await writeHistory(rootDir, history);
    loggers.fileManager.info(`[BridgeHistoryOperations] Added history entry: ${newEntry.id}`);
    return newEntry;
  } catch (e) {
    loggers.fileManager.error("[BridgeHistoryOperations] addBridgeHistory error:", { error: e });
    return null;
  }
}

export async function deleteBridgeHistory(rootDir: string, id: string): Promise<boolean> {
  try {
    const history = await getBridgeHistory(rootDir);
    const filtered = history.filter((h) => h.id !== id);
    if (filtered.length === history.length) return false;
    await writeHistory(rootDir, filtered);
    loggers.fileManager.info(`[BridgeHistoryOperations] Deleted history entry: ${id}`);
    return true;
  } catch (e) {
    loggers.fileManager.error("[BridgeHistoryOperations] deleteBridgeHistory error:", { error: e });
    return false;
  }
}

export async function clearBridgeHistory(rootDir: string): Promise<boolean> {
  try {
    await writeHistory(rootDir, []);
    loggers.fileManager.info("[BridgeHistoryOperations] Cleared all history");
    return true;
  } catch (e) {
    loggers.fileManager.error("[BridgeHistoryOperations] clearBridgeHistory error:", { error: e });
    return false;
  }
}
