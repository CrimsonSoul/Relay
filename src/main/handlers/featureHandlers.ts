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
    return saveGroup(getDataRoot(), group);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_GROUP, async (_, id, updates) => {
    if (!checkMutationRateLimit()) return false;
    return updateGroup(getDataRoot(), id, updates);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_GROUP, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    return deleteGroup(getDataRoot(), id);
  });

  // ==================== Bridge History ====================
  ipcMain.handle(IPC_CHANNELS.GET_BRIDGE_HISTORY, async () => {
    return getBridgeHistory(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.ADD_BRIDGE_HISTORY, async (_, entry) => {
    if (!checkMutationRateLimit()) return null;
    return addBridgeHistory(getDataRoot(), entry);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_BRIDGE_HISTORY, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
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
    return setContactNote(getDataRoot(), email, note, tags);
  });

  ipcMain.handle(IPC_CHANNELS.SET_SERVER_NOTE, async (_, name, note, tags) => {
    if (!checkMutationRateLimit()) return false;
    return setServerNote(getDataRoot(), name, note, tags);
  });

  // ==================== Saved Locations ====================
  ipcMain.handle(IPC_CHANNELS.GET_SAVED_LOCATIONS, async () => {
    return getSavedLocations(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_LOCATION, async (_, location) => {
    if (!checkMutationRateLimit()) return null;
    return saveLocation(getDataRoot(), location);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_LOCATION, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    return deleteLocation(getDataRoot(), id);
  });

  ipcMain.handle(IPC_CHANNELS.SET_DEFAULT_LOCATION, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    return setDefaultLocation(getDataRoot(), id);
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_DEFAULT_LOCATION, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    return clearDefaultLocation(getDataRoot(), id);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_LOCATION, async (_, id, updates) => {
    if (!checkMutationRateLimit()) return false;
    return updateLocation(getDataRoot(), id, updates);
  });
}
