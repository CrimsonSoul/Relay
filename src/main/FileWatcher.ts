import chokidar from "chokidar";
import { join } from "path";
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
  const pathsToWatch = [
    ...ALL_GROUP_FILES,
    ...ALL_CONTACT_FILES,
    ...ALL_SERVER_FILES,
    ...ALL_ONCALL_FILES,
  ].map((file) => join(rootDir, file));

  const watcher = chokidar.watch(pathsToWatch, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 100 },
  });

  const pendingUpdates = new Set<FileType>();
  let debounceTimer: NodeJS.Timeout | null = null;

  watcher.on("all", (_event, changedPath) => {
    if (callbacks.shouldIgnore()) return;

    const fileName = changedPath.split(/[/\\]/).pop();
    if (fileName && ALL_GROUP_FILES.includes(fileName)) pendingUpdates.add("groups");
    else if (fileName && ALL_CONTACT_FILES.includes(fileName)) pendingUpdates.add("contacts");
    else if (fileName && ALL_SERVER_FILES.includes(fileName)) pendingUpdates.add("servers");
    else if (fileName && ALL_ONCALL_FILES.includes(fileName)) pendingUpdates.add("oncall");

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      callbacks.onFileChange(new Set(pendingUpdates));
      pendingUpdates.clear();
    }, 100);
  });

  return watcher;
}

export type { FileType };
