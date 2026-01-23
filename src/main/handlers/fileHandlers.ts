import { ipcMain, shell } from 'electron';
import { join } from 'path';
import { IPC_CHANNELS, type IpcResult } from '../../shared/ipc';
import { validatePath } from '../utils/pathSafety';
import { loggers } from '../logger';
import { importGroupsFromCsv } from '../operations';
import { rateLimiters } from '../rateLimiter';

export function setupFileHandlers(getDataRoot: () => string) {
  const getContactsFilePath = () => {
    const root = getDataRoot();
    const fullPath = join(root, 'contacts.csv');
    return fullPath;
  };

  ipcMain.handle(IPC_CHANNELS.OPEN_PATH, async (_event, path: string) => {
    if (!rateLimiters.fsOperations.tryConsume().allowed) return;
    if (!await validatePath(path, getDataRoot())) {
      loggers.security.error(`Blocked access to path outside data root: ${path}`);
      return;
    }
    await shell.openPath(path);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_CONTACTS_FILE, async () => {
    if (!rateLimiters.fsOperations.tryConsume().allowed) return;
    const filePath = getContactsFilePath();
    if (!await validatePath('contacts.csv', getDataRoot())) {
      loggers.security.error('Blocked contacts file access - path validation failed');
      return;
    }
    await shell.openPath(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_event, url: string) => {
    if (!rateLimiters.fsOperations.tryConsume().allowed) return;
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

  ipcMain.handle(IPC_CHANNELS.IMPORT_GROUPS_FROM_CSV, async (): Promise<IpcResult> => {
    const success = await importGroupsFromCsv(getDataRoot());
    return { success };
  });
}
