/**
 * Data Record Handlers - IPC handlers for JSON-based data operations
 * Handles contacts, servers, on-call records, and data manager operations
 */

import { ipcMain } from "electron";
import { IPC_CHANNELS, type DataStats, type IpcResult } from "../../shared/ipc";
import {
  ContactRecordInputSchema,
  ServerRecordInputSchema,
  ContactRecordUpdateSchema,
  ServerRecordUpdateSchema,
  ExportOptionsSchema,
  DataCategorySchema,
  validateIpcDataSafe,
} from "../../shared/ipcValidation";
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

  ipcMain.handle(IPC_CHANNELS.ADD_CONTACT_RECORD, async (_, contact): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validated = validateIpcDataSafe(ContactRecordInputSchema, contact, 'ADD_CONTACT_RECORD', (m, d) => loggers.ipc.warn(m, d));
    if (!validated) return { success: false, error: 'Invalid contact data' };
    const result = await addContactRecord(getDataRoot(), validated);
    return { success: !!result, data: result || undefined };
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_CONTACT_RECORD, async (_, id, updates): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid ID' };
    const validatedUpdates = validateIpcDataSafe(ContactRecordUpdateSchema, updates, 'UPDATE_CONTACT_RECORD', (m, d) => loggers.ipc.warn(m, d));
    if (!validatedUpdates) return { success: false, error: 'Invalid update data' };
    const success = await updateContactRecord(getDataRoot(), id, validatedUpdates);
    return { success };
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_CONTACT_RECORD, async (_, id): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid ID' };
    const success = await deleteContactRecord(getDataRoot(), id);
    return { success };
  });

  // ==================== Servers ====================
  ipcMain.handle(IPC_CHANNELS.GET_SERVERS, async () => {
    return getServers(getDataRoot());
  });

  ipcMain.handle(IPC_CHANNELS.ADD_SERVER_RECORD, async (_, server): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validated = validateIpcDataSafe(ServerRecordInputSchema, server, 'ADD_SERVER_RECORD', (m, d) => loggers.ipc.warn(m, d));
    if (!validated) return { success: false, error: 'Invalid server data' };
    const result = await addServerRecord(getDataRoot(), validated);
    return { success: !!result, data: result || undefined };
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_SERVER_RECORD, async (_, id, updates): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid ID' };
    const validatedUpdates = validateIpcDataSafe(ServerRecordUpdateSchema, updates, 'UPDATE_SERVER_RECORD', (m, d) => loggers.ipc.warn(m, d));
    if (!validatedUpdates) return { success: false, error: 'Invalid update data' };
    const success = await updateServerRecord(getDataRoot(), id, validatedUpdates);
    return { success };
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_SERVER_RECORD, async (_, id): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid ID' };
    const success = await deleteServerRecord(getDataRoot(), id);
    return { success };
  });

  // ==================== OnCall ====================
  ipcMain.handle(IPC_CHANNELS.GET_ONCALL, async () => {
    return getOnCall(getDataRoot());
  });

  // ==================== Data Manager ====================
  ipcMain.handle(IPC_CHANNELS.EXPORT_DATA, async (_, options): Promise<IpcResult> => {
    const validated = validateIpcDataSafe(ExportOptionsSchema, options, 'EXPORT_DATA', (m, d) => loggers.ipc.warn(m, d));
    if (!validated) return { success: false, error: 'Invalid export options' };
    const success = await exportData(getDataRoot(), validated);
    return { success };
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_DATA, async (_, category): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) {
      return { success: false, rateLimited: true, error: "Rate limited" };
    }
    const validated = validateIpcDataSafe(DataCategorySchema, category, 'IMPORT_DATA', (m, d) => loggers.ipc.warn(m, d));
    if (!validated) return { success: false, error: 'Invalid category' };
    const result = await importData(getDataRoot(), validated);
    return { success: result.success, data: result };
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

  ipcMain.handle(IPC_CHANNELS.MIGRATE_CSV_TO_JSON, async (): Promise<IpcResult> => {
    if (!checkMutationRateLimit()) {
      return {
        success: false,
        rateLimited: true,
        error: "Rate limited"
      };
    }
    const result = await migrateAllCsvToJson(getDataRoot());
    return { success: result.success, data: result };
  });
}
