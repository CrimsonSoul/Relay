import { ipcMain, BrowserWindow, dialog } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '../../shared/ipc';
import { FileManager } from '../FileManager';
import { rateLimiters } from '../rateLimiter';
import { loggers } from '../logger';
import {
  ContactSchema,
  ServerSchema,
  OnCallRowsArraySchema,
  TeamLayoutSchema,
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

  const handleContactsImport = async (title: string): Promise<IpcResult> => {
    const rateLimitResult = rateLimiters.fileImport.tryConsume();
    if (!rateLimitResult.allowed) {
      loggers.ipc.warn(`Import blocked, retry after ${rateLimitResult.retryAfterMs}ms`);
      return { success: false, rateLimited: true };
    }

    const mainWindow = getMainWindow();
    const fileManager = getFileManager();
    if (!mainWindow) return { success: false, error: 'Main window not found' };

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };
    const success = await fileManager?.importContactsWithMapping(filePaths[0]) ?? false;
    return { success };
  };

  // Contact operations
  ipcMain.handle(IPC_CHANNELS.ADD_CONTACT, async (_, contact): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedContact = validateIpcDataSafe(ContactSchema, contact, 'ADD_CONTACT');
    if (!validatedContact) {
      loggers.ipc.error('Invalid contact data received');
      return { success: false, error: 'Invalid contact data' };
    }
    const result = await getFileManager()?.addContact(validatedContact) ?? false;
    return { success: result };
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_CONTACT, async (_, email): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof email !== 'string' || !email) {
      loggers.ipc.error('Invalid email parameter');
      return { success: false, error: 'Invalid email' };
    }
    const result = await getFileManager()?.removeContact(email) ?? false;
    return { success: result };
  });

  // Note: Group operations are now handled in featureHandlers.ts
  // using JSON-based storage (GET_GROUPS, SAVE_GROUP, UPDATE_GROUP, DELETE_GROUP, IMPORT_GROUPS_FROM_CSV)

  // On-Call operations
  ipcMain.handle(IPC_CHANNELS.UPDATE_ONCALL_TEAM, async (_, team, rows): Promise<IpcResult> => {
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
    const result = await getFileManager()?.updateOnCallTeam(team, validatedRows) ?? false;
    return { success: result };
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_ONCALL_TEAM, async (_, team): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof team !== 'string' || !team) {
      loggers.ipc.error('Invalid team parameter');
      return { success: false, error: 'Invalid team name' };
    }
    const result = await getFileManager()?.removeOnCallTeam(team) ?? false;
    return { success: result };
  });

  ipcMain.handle(IPC_CHANNELS.RENAME_ONCALL_TEAM, async (_, oldName, newName): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof oldName !== 'string' || !oldName || typeof newName !== 'string' || !newName) {
      loggers.ipc.error('Invalid team name parameters');
      return { success: false, error: 'Invalid team names' };
    }
    const result = await getFileManager()?.renameOnCallTeam(oldName, newName) ?? false;
    return { success: result };
  });

  ipcMain.handle(IPC_CHANNELS.REORDER_ONCALL_TEAMS, async (_, teamOrder, layout): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (!Array.isArray(teamOrder) || !teamOrder.every(t => typeof t === 'string')) {
      loggers.ipc.error('Invalid team order parameter');
      return { success: false, error: 'Invalid team order' };
    }
    const validatedLayout = validateIpcDataSafe(TeamLayoutSchema, layout, 'REORDER_ONCALL_TEAMS');
    const result = await getFileManager()?.reorderOnCallTeams(teamOrder, validatedLayout ?? undefined) ?? false;
    return { success: result };
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_ALL_ONCALL, async (_, rows): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedRows = validateIpcDataSafe(OnCallRowsArraySchema, rows, 'SAVE_ALL_ONCALL');
    if (!validatedRows) {
      loggers.ipc.error('Invalid on-call rows data');
      return { success: false, error: 'Invalid on-call data' };
    }
    const result = await getFileManager()?.saveAllOnCall(validatedRows) ?? false;
    return { success: result };
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
    ipcMain.handle(IPC_CHANNELS.GENERATE_DUMMY_DATA, async (): Promise<IpcResult> => {
      if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
      const success = await getFileManager()?.generateDummyData() ?? false;
      return { success };
    });
  }

  // Server operations
  ipcMain.handle(IPC_CHANNELS.ADD_SERVER, async (_, server): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedServer = validateIpcDataSafe(ServerSchema, server, 'ADD_SERVER');
    if (!validatedServer) {
      loggers.ipc.error('Invalid server data received');
      return { success: false, error: 'Invalid server data' };
    }
    const result = await getFileManager()?.addServer(validatedServer) ?? false;
    return { success: result };
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_SERVER, async (_, name): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof name !== 'string' || !name) {
      loggers.ipc.error('Invalid server name parameter');
      return { success: false, error: 'Invalid server name' };
    }
    const result = await getFileManager()?.removeServer(name) ?? false;
    return { success: result };
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_SERVERS_FILE, async (): Promise<IpcResult> => {
    const rateLimitResult = rateLimiters.fileImport.tryConsume();
    if (!rateLimitResult.allowed) return { success: false, rateLimited: true };

    const mainWindow = getMainWindow();
    const fileManager = getFileManager();
    if (!mainWindow) return { success: false, error: 'Main window not found' };

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Servers CSV',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };
    const result = await fileManager?.importServersWithMapping(filePaths[0]);
    if (result && typeof result === 'object' && 'success' in result) {
        return result as IpcResult;
    }
    return { success: !!result };
  });

  // Data reload
  ipcMain.handle(IPC_CHANNELS.DATA_RELOAD, async () => {
    const rateLimitResult = rateLimiters.dataReload.tryConsume();
    if (!rateLimitResult.allowed) return { success: false, rateLimited: true };
    void getFileManager()?.readAndEmit();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.DATA_GET_INITIAL, async () => {
    if (!rateLimiters.dataReload.tryConsume().allowed) {
      loggers.ipc.warn('Initial data request blocked by rate limit');
      return null;
    }
    const fileManager = getFileManager();
    if (!fileManager) return null;
    const data = fileManager.getCachedData();
    return { ...data, lastUpdated: Date.now() };
  });
}
