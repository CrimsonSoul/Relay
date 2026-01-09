import { ipcMain, BrowserWindow, dialog } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import { FileManager } from '../FileManager';
import { rateLimiters } from '../rateLimiter';
import { loggers } from '../logger';

export function setupDataHandlers(
  getMainWindow: () => BrowserWindow | null,
  getFileManager: () => FileManager | null
) {
  const checkMutationRateLimit = () => {
    const result = rateLimiters.dataMutation.tryConsume();
    if (!result.allowed) {
      loggers.ipc.warn(`Data mutation blocked, retry after ${result.retryAfterMs}ms`);
    }
    return result.allowed;
  };

  const handleMergeImport = async (type: 'groups' | 'contacts', title: string) => {
    const rateLimitResult = rateLimiters.fileImport.tryConsume();
    if (!rateLimitResult.allowed) {
      loggers.ipc.warn(`Import blocked, retry after ${rateLimitResult.retryAfterMs}ms`);
      return { success: false, rateLimited: true };
    }

    const mainWindow = getMainWindow();
    const fileManager = getFileManager();
    if (!mainWindow) return false;

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return false;

    if (type === 'contacts') {
      return fileManager?.importContactsWithMapping(filePaths[0]) ?? false;
    } else {
      return fileManager?.importGroupsWithMapping(filePaths[0]) ?? false;
    }
  };

  ipcMain.handle(IPC_CHANNELS.ADD_CONTACT, async (_, contact) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.addContact(contact) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_CONTACT, async (_, email) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.removeContact(email) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.ADD_GROUP, async (_, groupName) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.addGroup(groupName) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.ADD_CONTACT_TO_GROUP, async (_, groupName, email) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.updateGroupMembership(groupName, email, false) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_CONTACT_FROM_GROUP, async (_, groupName, email) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.updateGroupMembership(groupName, email, true) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_GROUP, async (_, groupName) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.removeGroup(groupName) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.RENAME_GROUP, async (_, oldName, newName) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.renameGroup(oldName, newName) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_ONCALL_TEAM, async (_, team, rows) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.updateOnCallTeam(team, rows) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_ONCALL_TEAM, async (_, team) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.removeOnCallTeam(team) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.RENAME_ONCALL_TEAM, async (_, oldName, newName) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.renameOnCallTeam(oldName, newName) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_ALL_ONCALL, async (_, rows) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.saveAllOnCall(rows) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CONTACTS_WITH_MAPPING, async () => {
    return handleMergeImport('contacts', 'Merge Contacts CSV');
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CONTACTS_FILE, async () => {
    return handleMergeImport('contacts', 'Merge Contacts CSV');
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_GROUPS_FILE, async () => {
    return handleMergeImport('groups', 'Merge Groups CSV');
  });

  ipcMain.handle(IPC_CHANNELS.GENERATE_DUMMY_DATA, async () => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.generateDummyData() ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.ADD_SERVER, async (_, server) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.addServer(server) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_SERVER, async (_, name) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.removeServer(name) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_SERVERS_FILE, async () => {
    const rateLimitResult = rateLimiters.fileImport.tryConsume();
    if (!rateLimitResult.allowed) return { success: false, rateLimited: true };

    const mainWindow = getMainWindow();
    const fileManager = getFileManager();
    if (!mainWindow) return { success: false, message: 'Main window not found' };

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Servers CSV',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return { success: false, message: 'Cancelled' };
    return fileManager?.importServersWithMapping(filePaths[0]) ?? { success: false, message: 'File Manager not initialized' };
  });

  ipcMain.handle(IPC_CHANNELS.DATA_RELOAD, async () => {
    const rateLimitResult = rateLimiters.dataReload.tryConsume();
    if (!rateLimitResult.allowed) return { success: false, rateLimited: true };
    getFileManager()?.readAndEmit();
  });
}
