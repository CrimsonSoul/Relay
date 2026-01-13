/**
 * Data Record Handlers - IPC handlers for JSON-based data operations
 * Handles contacts, servers, on-call records, and data manager operations
 */

import { ipcMain } from "electron";
import { IPC_CHANNELS, type DataStats } from "../../shared/ipc";
import {
  // Contacts
  getContacts,
  addContactRecord,
  updateContactRecord,
  deleteContactRecord,
  // Servers
  getServers,
  addServerRecord,
  updateServerRecord,
  deleteServerRecord,
  // OnCall
  getOnCall,
  addOnCallRecord,
  updateOnCallRecord,
  deleteOnCallRecord,
  deleteOnCallByTeam,
  // Groups (for stats)
  getGroups,
  // Migration
  migrateAllCsvToJson,
  hasCsvFiles,
  // Import/Export
  exportData,
  importData,
} from "../operations";
import { rateLimiters } from "../rateLimiter";
import { loggers } from "../logger";

export function setupDataRecordHandlers(getDataRoot: () => string) {
  const checkMutationRateLimit = () => {
    const result = rateLimiters.dataMutation.tryConsume();
    if (!result.allowed) {
      loggers.ipc.warn(`Data mutation blocked, retry after ${result.retryAfterMs}ms`);
    }
    return result.allowed;
  };

  // ==================== Contacts ====================
  ipcMain.handle(IPC_CHANNELS.GET_CONTACTS, async () => {
    return getContacts(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.ADD_CONTACT_RECORD, async (_, contact) => {
    if (!checkMutationRateLimit()) return null;
    return addContactRecord(getDataRoot(), contact);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_CONTACT_RECORD, async (_, id, updates) => {
    if (!checkMutationRateLimit()) return false;
    return updateContactRecord(getDataRoot(), id, updates);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_CONTACT_RECORD, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    return deleteContactRecord(getDataRoot(), id);
  });

  // ==================== Servers ====================
  ipcMain.handle(IPC_CHANNELS.GET_SERVERS, async () => {
    return getServers(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.ADD_SERVER_RECORD, async (_, server) => {
    if (!checkMutationRateLimit()) return null;
    return addServerRecord(getDataRoot(), server);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_SERVER_RECORD, async (_, id, updates) => {
    if (!checkMutationRateLimit()) return false;
    return updateServerRecord(getDataRoot(), id, updates);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_SERVER_RECORD, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    return deleteServerRecord(getDataRoot(), id);
  });

  // ==================== OnCall ====================
  ipcMain.handle(IPC_CHANNELS.GET_ONCALL, async () => {
    return getOnCall(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.ADD_ONCALL_RECORD, async (_, record) => {
    if (!checkMutationRateLimit()) return null;
    return addOnCallRecord(getDataRoot(), record);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_ONCALL_RECORD, async (_, id, updates) => {
    if (!checkMutationRateLimit()) return false;
    return updateOnCallRecord(getDataRoot(), id, updates);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_ONCALL_RECORD, async (_, id) => {
    if (!checkMutationRateLimit()) return false;
    return deleteOnCallRecord(getDataRoot(), id);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_ONCALL_BY_TEAM, async (_, team) => {
    if (!checkMutationRateLimit()) return false;
    return deleteOnCallByTeam(getDataRoot(), team);
  });

  // ==================== Data Manager ====================
  ipcMain.handle(IPC_CHANNELS.EXPORT_DATA, async (_, options) => {
    return exportData(getDataRoot(), options);
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_DATA, async (_, category) => {
    if (!checkMutationRateLimit()) {
      return { success: false, imported: 0, updated: 0, skipped: 0, errors: ["Rate limited"] };
    }
    return importData(getDataRoot(), category);
  });

  ipcMain.handle(IPC_CHANNELS.GET_DATA_STATS, async (): Promise<DataStats> => {
    const rootDir = getDataRoot();
    const [contacts, servers, onCall, groups, csvFilesExist] = await Promise.all([
      getContacts(rootDir),
      getServers(rootDir),
      getOnCall(rootDir),
      getGroups(rootDir),
      hasCsvFiles(rootDir),
    ]);

    // Get last updated from most recent record
    const getLastUpdated = (records: Array<{ updatedAt?: number }>) => {
      if (records.length === 0) return 0;
      return Math.max(...records.map((r) => r.updatedAt || 0));
    };

    return {
      contacts: { count: contacts.length, lastUpdated: getLastUpdated(contacts) },
      servers: { count: servers.length, lastUpdated: getLastUpdated(servers) },
      oncall: { count: onCall.length, lastUpdated: getLastUpdated(onCall) },
      groups: { count: groups.length, lastUpdated: getLastUpdated(groups) },
      hasCsvFiles: csvFilesExist,
    };
  });

  ipcMain.handle(IPC_CHANNELS.MIGRATE_CSV_TO_JSON, async () => {
    if (!checkMutationRateLimit()) {
      return {
        success: false,
        contacts: { migrated: 0, errors: ["Rate limited"] },
        servers: { migrated: 0, errors: [] },
        oncall: { migrated: 0, errors: [] },
      };
    }
    return migrateAllCsvToJson(getDataRoot());
  });
}
