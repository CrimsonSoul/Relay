/**
 * Feature Handlers - IPC handlers for groups, history, notes, and saved locations
 */

import { ipcMain } from "electron";
import { IPC_CHANNELS, type IpcResult, type BridgeGroup, type BridgeHistoryEntry, type SavedLocation } from "../../shared/ipc";
import {
  GroupSchema,
  GroupUpdateSchema,
  BridgeHistoryEntrySchema,
  SavedLocationSchema,
  LocationUpdateSchema,
  validateIpcDataSafe,
  NotesTagsSchema,
} from "../../shared/ipcValidation";
import {
  getGroups,
  saveGroup,
  updateGroup,
  deleteGroup,
  getBridgeHistory,
  addBridgeHistory,
  deleteBridgeHistory,
  clearBridgeHistory,
  getNotes,
  setContactNote,
  setServerNote,
  getSavedLocations,
  saveLocation,
  deleteLocation,
  setDefaultLocation,
  clearDefaultLocation,
  updateLocation,
} from "../operations";
import { rateLimiters } from "../rateLimiter";
import { loggers } from "../logger";

export function setupFeatureHandlers(getDataRoot: () => string) {
  const checkMutationRateLimit = () => {
    const result = rateLimiters.dataMutation.tryConsume();
    if (!result.allowed) {
      loggers.ipc.warn(`Feature mutation blocked, retry after ${result.retryAfterMs}ms`);
    }
    return result.allowed;
  };

  // ==================== Groups ====================
  ipcMain.handle(IPC_CHANNELS.GET_GROUPS, async () => {
    return getGroups(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_GROUP, async (_, group): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedGroup = validateIpcDataSafe(GroupSchema, group, 'SAVE_GROUP', (m, d) => loggers.ipc.warn(m, d));
    if (!validatedGroup) {
      loggers.ipc.error('Invalid group data received');
      return { success: false, error: 'Invalid group data' };
    }
    const result = await saveGroup(getDataRoot(), validatedGroup as Omit<BridgeGroup, 'id' | 'createdAt' | 'updatedAt'>);
    return { success: !!result, data: result || undefined };
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_GROUP, async (_, id, updates): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid group ID parameter');
      return { success: false, error: 'Invalid ID' };
    }
    const validatedUpdates = validateIpcDataSafe(GroupUpdateSchema, updates, 'UPDATE_GROUP', (m, d) => loggers.ipc.warn(m, d));
    if (!validatedUpdates) {
      loggers.ipc.error('Invalid group update data');
      return { success: false, error: 'Invalid update data' };
    }
    const success = await updateGroup(getDataRoot(), id, validatedUpdates);
    return { success };
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_GROUP, async (_, id): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid group ID parameter');
      return { success: false, error: 'Invalid ID' };
    }
    const success = await deleteGroup(getDataRoot(), id);
    return { success };
  });

  // ==================== Bridge History ====================
  ipcMain.handle(IPC_CHANNELS.GET_BRIDGE_HISTORY, async () => {
    return getBridgeHistory(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.ADD_BRIDGE_HISTORY, async (_, entry): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedEntry = validateIpcDataSafe(BridgeHistoryEntrySchema, entry, 'ADD_BRIDGE_HISTORY', (m, d) => loggers.ipc.warn(m, d));
    if (!validatedEntry) {
      loggers.ipc.error('Invalid bridge history entry data');
      return { success: false, error: 'Invalid entry data' };
    }
    const result = await addBridgeHistory(getDataRoot(), validatedEntry as Omit<BridgeHistoryEntry, 'id' | 'timestamp'>);
    return { success: !!result, data: result || undefined };
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_BRIDGE_HISTORY, async (_, id): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid bridge history ID parameter');
      return { success: false, error: 'Invalid ID' };
    }
    const success = await deleteBridgeHistory(getDataRoot(), id);
    return { success };
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_BRIDGE_HISTORY, async (): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const success = await clearBridgeHistory(getDataRoot());
    return { success };
  });

  // ==================== Notes ====================
  ipcMain.handle(IPC_CHANNELS.GET_NOTES, async () => {
    return getNotes(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.SET_CONTACT_NOTE, async (_, email, note, tags): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof email !== 'string' || !email || typeof note !== 'string') {
      loggers.ipc.error('Invalid contact note parameters');
      return { success: false, error: 'Invalid parameters' };
    }
    const validatedTags = validateIpcDataSafe(NotesTagsSchema, tags, 'SET_CONTACT_NOTE', (m, d) => loggers.ipc.warn(m, d));
    if (tags !== undefined && !validatedTags) {
      return { success: false, error: 'Invalid tags' };
    }
    const success = await setContactNote(getDataRoot(), email, note, validatedTags);
    return { success };
  });

  ipcMain.handle(IPC_CHANNELS.SET_SERVER_NOTE, async (_, name, note, tags): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof name !== 'string' || !name || typeof note !== 'string') {
      loggers.ipc.error('Invalid server note parameters');
      return { success: false, error: 'Invalid parameters' };
    }
    const validatedTags = validateIpcDataSafe(NotesTagsSchema, tags, 'SET_SERVER_NOTE', (m, d) => loggers.ipc.warn(m, d));
    if (tags !== undefined && !validatedTags) {
      return { success: false, error: 'Invalid tags' };
    }
    const success = await setServerNote(getDataRoot(), name, note, validatedTags);
    return { success };
  });

  // ==================== Saved Locations ====================
  ipcMain.handle(IPC_CHANNELS.GET_SAVED_LOCATIONS, async () => {
    return getSavedLocations(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_LOCATION, async (_, location): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validatedLocation = validateIpcDataSafe(SavedLocationSchema, location, 'SAVE_LOCATION', (m, d) => loggers.ipc.warn(m, d));
    if (!validatedLocation) {
      loggers.ipc.error('Invalid location data received');
      return { success: false, error: 'Invalid data' };
    }
    const result = await saveLocation(getDataRoot(), validatedLocation as Omit<SavedLocation, 'id'>);
    return { success: !!result, data: result || undefined };
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_LOCATION, async (_, id): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid location ID parameter');
      return { success: false, error: 'Invalid ID' };
    }
    const success = await deleteLocation(getDataRoot(), id);
    return { success };
  });

  ipcMain.handle(IPC_CHANNELS.SET_DEFAULT_LOCATION, async (_, id): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid location ID parameter');
      return { success: false, error: 'Invalid ID' };
    }
    const success = await setDefaultLocation(getDataRoot(), id);
    return { success };
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_DEFAULT_LOCATION, async (_, id): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid location ID parameter');
      return { success: false, error: 'Invalid ID' };
    }
    const success = await clearDefaultLocation(getDataRoot(), id);
    return { success };
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_LOCATION, async (_, id, updates): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid location ID parameter');
      return { success: false, error: 'Invalid ID' };
    }
    const validatedUpdates = validateIpcDataSafe(LocationUpdateSchema, updates, 'UPDATE_LOCATION', (m, d) => loggers.ipc.warn(m, d));
    if (!validatedUpdates) {
      loggers.ipc.error('Invalid location update data');
      return { success: false, error: 'Invalid update data' };
    }
    const success = await updateLocation(getDataRoot(), id, validatedUpdates);
    return { success };
  });
}
