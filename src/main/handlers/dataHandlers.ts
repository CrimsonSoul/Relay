import { ipcMain, BrowserWindow, dialog } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import { FileManager } from '../FileManager';
import { rateLimiters } from '../rateLimiter';
import { loggers } from '../logger';
import {
  ContactSchema,
  ServerSchema,
  OnCallRowsArraySchema,
  validateIpcDataSafe,
} from '../../shared/ipcValidation';

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

  const handleContactsImport = async (title: string) => {
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
    return fileManager?.importContactsWithMapping(filePaths[0]) ?? false;
  };

  // Contact operations
  ipcMain.handle(IPC_CHANNELS.ADD_CONTACT, async (_, contact) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedContact = validateIpcDataSafe(ContactSchema, contact, 'ADD_CONTACT');
    if (!validatedContact) {
      loggers.ipc.error('Invalid contact data received');
      return { success: false, error: 'Invalid contact data' };
    }
    return getFileManager()?.addContact(validatedContact) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_CONTACT, async (_, email) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof email !== 'string' || !email) {
      loggers.ipc.error('Invalid email parameter');
      return { success: false, error: 'Invalid email' };
    }
    return getFileManager()?.removeContact(email) ?? false;
  });

  // Note: Group operations are now handled in featureHandlers.ts
  // using JSON-based storage (GET_GROUPS, SAVE_GROUP, UPDATE_GROUP, DELETE_GROUP, IMPORT_GROUPS_FROM_CSV)

  // On-Call operations
  ipcMain.handle(IPC_CHANNELS.UPDATE_ONCALL_TEAM, async (_, team, rows) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof team !== 'string' || !team) {
      loggers.ipc.error('Invalid team parameter');
      return { success: false, error: 'Invalid team name' };
    }
    const validatedRows = validateIpcDataSafe(OnCallRowsArraySchema, rows, 'UPDATE_ONCALL_TEAM');
    if (!validatedRows) {
      loggers.ipc.error('Invalid on-call rows data');
      return { success: false, error: 'Invalid on-call data' };
    }
    return getFileManager()?.updateOnCallTeam(team, validatedRows) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_ONCALL_TEAM, async (_, team) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof team !== 'string' || !team) {
      loggers.ipc.error('Invalid team parameter');
      return { success: false, error: 'Invalid team name' };
    }
    return getFileManager()?.removeOnCallTeam(team) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.RENAME_ONCALL_TEAM, async (_, oldName, newName) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof oldName !== 'string' || !oldName || typeof newName !== 'string' || !newName) {
      loggers.ipc.error('Invalid team name parameters');
      return { success: false, error: 'Invalid team names' };
    }
    return getFileManager()?.renameOnCallTeam(oldName, newName) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_ALL_ONCALL, async (_, rows) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedRows = validateIpcDataSafe(OnCallRowsArraySchema, rows, 'SAVE_ALL_ONCALL');
    if (!validatedRows) {
      loggers.ipc.error('Invalid on-call rows data');
      return { success: false, error: 'Invalid on-call data' };
    }
    return getFileManager()?.saveAllOnCall(validatedRows) ?? false;
  });

  // Contact import operations
  ipcMain.handle(IPC_CHANNELS.IMPORT_CONTACTS_WITH_MAPPING, async () => {
    return handleContactsImport('Merge Contacts CSV');
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CONTACTS_FILE, async () => {
    return handleContactsImport('Merge Contacts CSV');
  });

  // Development only
  if (process.env.NODE_ENV === 'development') {
    ipcMain.handle(IPC_CHANNELS.GENERATE_DUMMY_DATA, async () => {
      if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
      return getFileManager()?.generateDummyData() ?? false;
    });
  }

  // Server operations
  ipcMain.handle(IPC_CHANNELS.ADD_SERVER, async (_, server) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedServer = validateIpcDataSafe(ServerSchema, server, 'ADD_SERVER');
    if (!validatedServer) {
      loggers.ipc.error('Invalid server data received');
      return { success: false, error: 'Invalid server data' };
    }
    return getFileManager()?.addServer(validatedServer) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_SERVER, async (_, name) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof name !== 'string' || !name) {
      loggers.ipc.error('Invalid server name parameter');
      return { success: false, error: 'Invalid server name' };
    }
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

  // Data reload
  ipcMain.handle(IPC_CHANNELS.DATA_RELOAD, async () => {
    const rateLimitResult = rateLimiters.dataReload.tryConsume();
    if (!rateLimitResult.allowed) return { success: false, rateLimited: true };
    void getFileManager()?.readAndEmit();
  });
}
