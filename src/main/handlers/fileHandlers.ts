import { ipcMain, shell } from 'electron';
import { join, extname } from 'path';
import { IPC_CHANNELS, type IpcResult } from '../../shared/ipc';
import { validatePath } from '../utils/pathSafety';
import { loggers } from '../logger';
import { importGroupsFromCsv } from '../operations';
import { rateLimiters } from '../rateLimiter';

/** Safe file extensions allowed for shell.openPath */
const SAFE_OPEN_EXTENSIONS = new Set([
  '.csv', '.json', '.txt', '.log', '.md', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg'
]);

export function setupFileHandlers(getDataRoot: () => Promise<string>) {
  const getContactsFilePath = async () => {
    const root = await getDataRoot();
    return join(root, 'contacts.csv');
  };

  ipcMain.handle(IPC_CHANNELS.OPEN_PATH, async (_event, path: string) => {
    if (!rateLimiters.fsOperations.tryConsume().allowed) return;
    const root = await getDataRoot();
    if (!await validatePath(path, root)) {
      loggers.security.error(`Blocked access to path outside data root: ${path}`);
      return;
    }
    // Restrict to safe file extensions to prevent arbitrary code execution
    const ext = extname(path).toLowerCase();
    if (!SAFE_OPEN_EXTENSIONS.has(ext)) {
      loggers.security.error(`Blocked opening file with unsafe extension: ${path}`);
      return;
    }
    await shell.openPath(path);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_CONTACTS_FILE, async () => {
    if (!rateLimiters.fsOperations.tryConsume().allowed) return;
    const filePath = await getContactsFilePath();
    const root = await getDataRoot();
    if (!await validatePath('contacts.csv', root)) {
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
    if (!rateLimiters.fsOperations.tryConsume().allowed) return { success: false };
    const root = await getDataRoot();
    const success = await importGroupsFromCsv(root);
    return { success };
  });
}
