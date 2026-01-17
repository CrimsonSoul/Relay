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

export function createFileWatcher(rootDir: string, callbacks: WatcherCallbacks): chokidar.FSWatcher {
  // Watch the root directory instead of specific files to handle atomic renames/overwrites better
  const watcher = chokidar.watch(rootDir, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 100 },
  });

  const pendingUpdates = new Set<FileType>();
  let debounceTimer: NodeJS.Timeout | null = null;

  watcher.on("all", (_event, changedPath) => {
    if (callbacks.shouldIgnore()) return;

    const fileName = changedPath.split(/[/\\]/).pop() || "";
    
    // Explicitly ignore common noise like lock files or temp files
    if (fileName.endsWith('.lock') || fileName.endsWith('.tmp')) return;

    if (ALL_GROUP_FILES.includes(fileName)) pendingUpdates.add("groups");
    else if (ALL_CONTACT_FILES.includes(fileName)) pendingUpdates.add("contacts");
    else if (ALL_SERVER_FILES.includes(fileName)) pendingUpdates.add("servers");
    else if (ALL_ONCALL_FILES.includes(fileName)) pendingUpdates.add("oncall");

    if (pendingUpdates.size === 0) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      callbacks.onFileChange(new Set(pendingUpdates));
      pendingUpdates.clear();
    }, 100);
  });

  return watcher;
}

export type { FileType };
