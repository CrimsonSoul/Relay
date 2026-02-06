import { watch, type FSWatcher } from 'chokidar';
import {
  CONTACTS_JSON_FILE,
  SERVERS_JSON_FILE,
  ONCALL_JSON_FILE,
  GROUPS_JSON_FILE,
} from './operations';

type FileType = 'groups' | 'contacts' | 'servers' | 'oncall';

interface WatcherCallbacks {
  onFileChange: (types: Set<FileType>) => void;
  shouldIgnore: () => boolean;
}

// JSON files to watch
const CONTACT_FILES = [CONTACTS_JSON_FILE];
const SERVER_FILES = [SERVERS_JSON_FILE];
const ONCALL_FILES = [ONCALL_JSON_FILE, 'oncall_layout.json'];
const GROUP_FILES = [GROUPS_JSON_FILE];

const FILE_CHANGE_DEBOUNCE_MS = 200;

import { loggers } from './logger';

export function createFileWatcher(rootDir: string, callbacks: WatcherCallbacks): FSWatcher {
  // Watch the root directory
  // usePolling is enabled to ensure detection on network drives (OneDrive) where native events may be dropped
  const watcher = watch(rootDir, {
    ignoreInitial: true,
    depth: 0,
    usePolling: false,
  });

  const pendingUpdates = new Set<FileType>();
  let debounceTimer: NodeJS.Timeout | null = null;

  watcher.on('all', (event, changedPath) => {
    // Always log event to debug sync issues
    const fileName = changedPath.split(/[/\\]/).pop() || '';
    // Only log significant files to avoid spam
    if (fileName.endsWith('.json')) {
      loggers.fileManager.debug(`Event: ${event} on ${fileName}`);
    }

    if (callbacks.shouldIgnore()) {
      loggers.fileManager.debug('Ignoring event (write guard active)');
      return;
    }

    // Explicitly ignore common noise like lock files or temp files
    // Also ignore OneDrive temp files (usually start with ~ or ~$)
    if (
      fileName.endsWith('.lock') ||
      fileName.endsWith('.tmp') ||
      fileName.startsWith('~') ||
      fileName.startsWith('.~')
    )
      return;

    const lowerName = fileName.toLowerCase();

    // Case-insensitive matching
    if (GROUP_FILES.some((f) => f.toLowerCase() === lowerName)) pendingUpdates.add('groups');
    else if (CONTACT_FILES.some((f) => f.toLowerCase() === lowerName))
      pendingUpdates.add('contacts');
    else if (SERVER_FILES.some((f) => f.toLowerCase() === lowerName)) pendingUpdates.add('servers');
    else if (ONCALL_FILES.some((f) => f.toLowerCase() === lowerName)) pendingUpdates.add('oncall');

    if (pendingUpdates.size === 0) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      loggers.fileManager.info(`Triggering reload for: ${Array.from(pendingUpdates).join(', ')}`);
      callbacks.onFileChange(new Set(pendingUpdates));
      pendingUpdates.clear();
    }, FILE_CHANGE_DEBOUNCE_MS);
  });

  // Expose cleanup for the caller to invoke when closing the watcher.
  // Chokidar v5 does not emit a 'close' event, so cleanup must be triggered externally.
  (watcher as FSWatcher & { _cleanup: () => void })._cleanup = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pendingUpdates.clear();
  };

  return watcher;
}

export type { FileType };
