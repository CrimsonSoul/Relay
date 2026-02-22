import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import { FileManager } from '../FileManager';
import { rateLimiters } from '../rateLimiter';
import { loggers } from '../logger';
import {
  ContactSchema,
  ServerSchema,
  OnCallRowsArraySchema,
  TeamLayoutSchema,
  validateIpcDataSafe,
} from '@shared/ipcValidation';
import { checkMutationRateLimit, safeMutation } from './ipcHelpers';

export function setupDataHandlers(
  getMainWindow: () => BrowserWindow | null,
  getFileManager: () => FileManager | null,
) {
  // Contact operations
  safeMutation(IPC_CHANNELS.ADD_CONTACT, async (_, contact) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedContact = validateIpcDataSafe(ContactSchema, contact, 'ADD_CONTACT', (m, d) =>
      loggers.ipc.warn(m, d),
    );
    if (!validatedContact) {
      loggers.ipc.error('Invalid contact data received');
      return { success: false, error: 'Invalid contact data' };
    }
    const result = (await getFileManager()?.addContact(validatedContact)) ?? false;
    return { success: result };
  });

  safeMutation(IPC_CHANNELS.REMOVE_CONTACT, async (_, email) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof email !== 'string' || !email) {
      loggers.ipc.error('Invalid email parameter');
      return { success: false, error: 'Invalid email' };
    }
    const result = (await getFileManager()?.removeContact(email)) ?? false;
    return { success: result };
  });

  // On-Call operations
  safeMutation(IPC_CHANNELS.UPDATE_ONCALL_TEAM, async (_, team, rows) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof team !== 'string' || !team) {
      loggers.ipc.error('Invalid team parameter');
      return { success: false, error: 'Invalid team name' };
    }
    const validatedRows = validateIpcDataSafe(
      OnCallRowsArraySchema,
      rows,
      'UPDATE_ONCALL_TEAM',
      (m, d) => loggers.ipc.warn(m, d),
    );
    if (!validatedRows) {
      loggers.ipc.error('Invalid on-call rows data');
      return { success: false, error: 'Invalid on-call data' };
    }
    const result = (await getFileManager()?.updateOnCallTeam(team, validatedRows)) ?? false;
    return { success: result };
  });

  safeMutation(IPC_CHANNELS.REMOVE_ONCALL_TEAM, async (_, team) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof team !== 'string' || !team) {
      loggers.ipc.error('Invalid team parameter');
      return { success: false, error: 'Invalid team name' };
    }
    const result = (await getFileManager()?.removeOnCallTeam(team)) ?? false;
    return { success: result };
  });

  safeMutation(IPC_CHANNELS.RENAME_ONCALL_TEAM, async (_, oldName, newName) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof oldName !== 'string' || !oldName || typeof newName !== 'string' || !newName) {
      loggers.ipc.error('Invalid team name parameters');
      return { success: false, error: 'Invalid team names' };
    }
    const result = (await getFileManager()?.renameOnCallTeam(oldName, newName)) ?? false;
    return { success: result };
  });

  safeMutation(IPC_CHANNELS.REORDER_ONCALL_TEAMS, async (_, teamOrder, layout) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (!Array.isArray(teamOrder) || !teamOrder.every((t) => typeof t === 'string')) {
      loggers.ipc.error('Invalid team order parameter');
      return { success: false, error: 'Invalid team order' };
    }
    const validatedLayout = validateIpcDataSafe(
      TeamLayoutSchema,
      layout,
      'REORDER_ONCALL_TEAMS',
      (m, d) => loggers.ipc.warn(m, d),
    );
    const result =
      (await getFileManager()?.reorderOnCallTeams(teamOrder, validatedLayout ?? undefined)) ??
      false;
    return { success: result };
  });

  safeMutation(IPC_CHANNELS.SAVE_ALL_ONCALL, async (_, rows) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedRows = validateIpcDataSafe(
      OnCallRowsArraySchema,
      rows,
      'SAVE_ALL_ONCALL',
      (m, d) => loggers.ipc.warn(m, d),
    );
    if (!validatedRows) {
      loggers.ipc.error('Invalid on-call rows data');
      return { success: false, error: 'Invalid on-call data' };
    }
    const result = (await getFileManager()?.saveAllOnCall(validatedRows)) ?? false;
    return { success: result };
  });

  // Dummy data generation — only functional in development
  ipcMain.handle(IPC_CHANNELS.GENERATE_DUMMY_DATA, async (): Promise<IpcResult> => {
    const { app } = await import('electron');
    if (app.isPackaged || process.env.NODE_ENV !== 'development') {
      return { success: false, error: 'Not available in production' };
    }
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const success = (await getFileManager()?.generateDummyData()) ?? false;
    return { success };
  });

  // Server operations
  safeMutation(IPC_CHANNELS.ADD_SERVER, async (_, server) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedServer = validateIpcDataSafe(ServerSchema, server, 'ADD_SERVER', (m, d) =>
      loggers.ipc.warn(m, d),
    );
    if (!validatedServer) {
      loggers.ipc.error('Invalid server data received');
      return { success: false, error: 'Invalid server data' };
    }
    const result = (await getFileManager()?.addServer(validatedServer)) ?? false;
    return { success: result };
  });

  safeMutation(IPC_CHANNELS.REMOVE_SERVER, async (_, name) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof name !== 'string' || !name) {
      loggers.ipc.error('Invalid server name parameter');
      return { success: false, error: 'Invalid server name' };
    }
    const result = (await getFileManager()?.removeServer(name)) ?? false;
    return { success: result };
  });

  // Data reload
  ipcMain.handle(IPC_CHANNELS.DATA_RELOAD, async () => {
    const rateLimitResult = rateLimiters.dataReload.tryConsume();
    if (!rateLimitResult.allowed) return { success: false, rateLimited: true };
    await getFileManager()?.readAndEmit();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.DATA_GET_INITIAL, async () => {
    const fileManager = getFileManager();
    if (!fileManager) return null;
    await fileManager.readAndEmit();
    const data = fileManager.getCachedData();
    loggers.ipc.info('DATA_GET_INITIAL served', {
      groups: data.groups.length,
      contacts: data.contacts.length,
      servers: data.servers.length,
      onCall: data.onCall.length,
    });
    return { ...data, lastUpdated: Date.now() };
  });
}
