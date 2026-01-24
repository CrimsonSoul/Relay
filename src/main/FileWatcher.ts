import chokidar from "chokidar";
import {
  GROUP_FILES,
  CONTACT_FILES,
  SERVER_FILES,
  ONCALL_FILES,
  CONTACTS_JSON_FILE,
  SERVERS_JSON_FILE,
  ONCALL_JSON_FILE,
  GROUPS_JSON_FILE,
} from "./operations";

type FileType = "groups" | "contacts" | "servers" | "oncall";

interface WatcherCallbacks {
  onFileChange: (types: Set<FileType>) => void;
  shouldIgnore: () => boolean;
}

// All files to watch (both CSV and JSON)
const ALL_CONTACT_FILES = [...CONTACT_FILES, CONTACTS_JSON_FILE];
const ALL_SERVER_FILES = [...SERVER_FILES, SERVERS_JSON_FILE];
const ALL_ONCALL_FILES = [...ONCALL_FILES, ONCALL_JSON_FILE];
const ALL_GROUP_FILES = [...GROUP_FILES, GROUPS_JSON_FILE];

// File watcher configuration constants
const FILE_CHANGE_DEBOUNCE_MS = 200; // Debounce delay for file change events

import { loggers } from "./logger";

// ...

/**
 * Creates a file watcher for monitoring changes to data files.
 * Uses debouncing to batch multiple rapid changes into a single reload event.
 * 
 * @param rootDir - Root directory to watch for file changes
 * @param callbacks - Callbacks for handling file changes
 * @returns Chokidar watcher instance
 */
export function createFileWatcher(rootDir: string, callbacks: WatcherCallbacks): chokidar.FSWatcher {
  // Watch the root directory
  // usePolling is enabled to ensure detection on network drives (OneDrive) where native events may be dropped
  const watcher = chokidar.watch(rootDir, {
    ignoreInitial: true,
    depth: 0,
    usePolling: false
  });

  const pendingUpdates = new Set<FileType>();
  let debounceTimer: NodeJS.Timeout | null = null;

  watcher.on("all", (event, changedPath) => {
    // Always log event to debug sync issues
    const fileName = changedPath.split(/[/\\]/).pop() || "";
    // Only log significant files to avoid spam
    if (fileName.endsWith('.json') || fileName.endsWith('.csv')) {
       loggers.fileManager.debug(`[FileWatcher] Event: ${event} on ${fileName}`);
    }

    if (callbacks.shouldIgnore()) {
        loggers.fileManager.debug(`[FileWatcher] Ignoring event (write guard active)`);
        return;
    }

    // Explicitly ignore common noise like lock files or temp files
    // Also ignore OneDrive temp files (usually start with ~ or ~$)
    if (fileName.endsWith('.lock') || 
        fileName.endsWith('.tmp') || 
        fileName.startsWith('~') || 
        fileName.startsWith('.~')) return;

    const lowerName = fileName.toLowerCase();
    
    // Case-insensitive matching
    if (ALL_GROUP_FILES.some(f => f.toLowerCase() === lowerName)) pendingUpdates.add("groups");
    else if (ALL_CONTACT_FILES.some(f => f.toLowerCase() === lowerName)) pendingUpdates.add("contacts");
    else if (ALL_SERVER_FILES.some(f => f.toLowerCase() === lowerName)) pendingUpdates.add("servers");
    else if (ALL_ONCALL_FILES.some(f => f.toLowerCase() === lowerName)) pendingUpdates.add("oncall");

    if (pendingUpdates.size === 0) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      loggers.fileManager.info(`[FileWatcher] Triggering reload for: ${Array.from(pendingUpdates).join(', ')}`);
      callbacks.onFileChange(new Set(pendingUpdates));
      pendingUpdates.clear();
    }, FILE_CHANGE_DEBOUNCE_MS);
  });

  return watcher;
}

export type { FileType };
