import { ipcMain, shell } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { IPC_CHANNELS } from '../../shared/ipc';
import { validatePath } from '../utils/pathSafety';
import { loggers } from '../logger';

export function setupFileHandlers(getDataRoot: () => string) {
  const getGroupsFilePath = () => {
    const root = getDataRoot();
    const fullPath = join(root, 'groups.csv');
    return existsSync(fullPath) ? fullPath : fullPath;
  };

  const getContactsFilePath = () => {
    const root = getDataRoot();
    const fullPath = join(root, 'contacts.csv');
    return existsSync(fullPath) ? fullPath : fullPath;
  };

  ipcMain.handle(IPC_CHANNELS.OPEN_PATH, async (_event, path: string) => {
    if (!await validatePath(path, getDataRoot())) {
      loggers.security.error(`Blocked access to path outside data root: ${path}`);
      return;
    }
    await shell.openPath(path);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_GROUPS_FILE, async () => {
    await shell.openPath(getGroupsFilePath());
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_CONTACTS_FILE, async () => {
    await shell.openPath(getContactsFilePath());
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        await shell.openExternal(url);
      } else {
        loggers.security.error(`Blocked opening external URL with unsafe protocol: ${url}`);
      }
    } catch {
      loggers.security.error(`Invalid URL provided to openExternal: ${url}`);
    }
  });
}
