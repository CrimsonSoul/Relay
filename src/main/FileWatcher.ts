import chokidar from "chokidar";
import { join } from "path";
import { GROUP_FILES, CONTACT_FILES, SERVER_FILES, ONCALL_FILES } from "./operations";

type FileType = "groups" | "contacts" | "servers" | "oncall";

interface WatcherCallbacks {
  onFileChange: (fileTypes: Set<FileType>) => void;
  shouldIgnore: () => boolean;
}

export function createFileWatcher(rootDir: string, callbacks: WatcherCallbacks): chokidar.FSWatcher {
  const pathsToWatch = [...GROUP_FILES, ...CONTACT_FILES, ...SERVER_FILES, ...ONCALL_FILES].map((file) => join(rootDir, file));

  const watcher = chokidar.watch(pathsToWatch, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 100 },
  });

  const pendingUpdates = new Set<FileType>();
  let debounceTimer: NodeJS.Timeout | null = null;

  watcher.on("all", (_event, changedPath) => {
    if (callbacks.shouldIgnore()) return;

    const fileName = changedPath.split(/[/\\]/).pop() || "";
    if (GROUP_FILES.includes(fileName)) pendingUpdates.add("groups");
    else if (CONTACT_FILES.includes(fileName)) pendingUpdates.add("contacts");
    else if (SERVER_FILES.includes(fileName)) pendingUpdates.add("servers");
    else if (ONCALL_FILES.includes(fileName)) pendingUpdates.add("oncall");

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      callbacks.onFileChange(new Set(pendingUpdates));
      pendingUpdates.clear();
    }, 100);
  });

  return watcher;
}

export type { FileType };
