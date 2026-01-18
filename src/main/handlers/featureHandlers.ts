/**
 * Feature Handlers - IPC handlers for groups, history, notes, and saved locations
 */

import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc";
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
import {
  GroupSchema,
  GroupUpdateSchema,
  BridgeHistoryEntrySchema,
  SavedLocationSchema,
  LocationUpdateSchema,
  validateIpcDataSafe,
} from "../../shared/ipcValidation";

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

  ipcMain.handle(IPC_CHANNELS.SAVE_GROUP, async (_, group) => {
    if (!checkMutationRateLimit()) return null;
    const validatedGroup = validateIpcDataSafe(GroupSchema, group, 'SAVE_GROUP');
    if (!validatedGroup) {
      loggers.ipc.error('Invalid group data received');
      return null;
    }
    return saveGroup(getDataRoot(), validatedGroup);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_GROUP, async (_, id, updates) => {
    if (!checkMutationRateLimit()) return false;
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid group ID parameter');
      return false;
    }
    const validatedUpdates = validateIpcDataSafe(GroupUpdateSchema, updates, 'UPDATE_GROUP');
    if (!validatedUpdates) {
      loggers.ipc.error('Invalid group update data');
      return false;
    }
    return updateGroup(getDataRoot(), id, validatedUpdates);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_GROUP, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid group ID parameter');
      return false;
    }
    return deleteGroup(getDataRoot(), id);
  });

  // ==================== Bridge History ====================
  ipcMain.handle(IPC_CHANNELS.GET_BRIDGE_HISTORY, async () => {
    return getBridgeHistory(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.ADD_BRIDGE_HISTORY, async (_, entry) => {
    if (!checkMutationRateLimit()) return null;
    const validatedEntry = validateIpcDataSafe(BridgeHistoryEntrySchema, entry, 'ADD_BRIDGE_HISTORY');
    if (!validatedEntry) {
      loggers.ipc.error('Invalid bridge history entry data');
      return null;
    }
    return addBridgeHistory(getDataRoot(), validatedEntry);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_BRIDGE_HISTORY, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid bridge history ID parameter');
      return false;
    }
    return deleteBridgeHistory(getDataRoot(), id);
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_BRIDGE_HISTORY, async () => {
    if (!checkMutationRateLimit()) return false;
    return clearBridgeHistory(getDataRoot());
  });

  // ==================== Notes ====================
  ipcMain.handle(IPC_CHANNELS.GET_NOTES, async () => {
    return getNotes(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.SET_CONTACT_NOTE, async (_, email, note, tags) => {
    if (!checkMutationRateLimit()) return false;
    if (typeof email !== 'string' || !email || typeof note !== 'string') {
      loggers.ipc.error('Invalid contact note parameters');
      return false;
    }
    return setContactNote(getDataRoot(), email, note, tags);
  });

  ipcMain.handle(IPC_CHANNELS.SET_SERVER_NOTE, async (_, name, note, tags) => {
    if (!checkMutationRateLimit()) return false;
    if (typeof name !== 'string' || !name || typeof note !== 'string') {
      loggers.ipc.error('Invalid server note parameters');
      return false;
    }
    return setServerNote(getDataRoot(), name, note, tags);
  });

  // ==================== Saved Locations ====================
  ipcMain.handle(IPC_CHANNELS.GET_SAVED_LOCATIONS, async () => {
    return getSavedLocations(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_LOCATION, async (_, location) => {
    if (!checkMutationRateLimit()) return null;
    const validatedLocation = validateIpcDataSafe(SavedLocationSchema, location, 'SAVE_LOCATION');
    if (!validatedLocation) {
      loggers.ipc.error('Invalid location data received');
      return null;
    }
    return saveLocation(getDataRoot(), validatedLocation);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_LOCATION, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid location ID parameter');
      return false;
    }
    return deleteLocation(getDataRoot(), id);
  });

  ipcMain.handle(IPC_CHANNELS.SET_DEFAULT_LOCATION, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid location ID parameter');
      return false;
    }
    return setDefaultLocation(getDataRoot(), id);
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_DEFAULT_LOCATION, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid location ID parameter');
      return false;
    }
    return clearDefaultLocation(getDataRoot(), id);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_LOCATION, async (_, id, updates) => {
    if (!checkMutationRateLimit()) return false;
    if (typeof id !== 'string' || !id) {
      loggers.ipc.error('Invalid location ID parameter');
      return false;
    }
    const validatedUpdates = validateIpcDataSafe(LocationUpdateSchema, updates, 'UPDATE_LOCATION');
    if (!validatedUpdates) {
      loggers.ipc.error('Invalid location update data');
      return false;
    }
    return updateLocation(getDataRoot(), id, validatedUpdates);
  });
}
