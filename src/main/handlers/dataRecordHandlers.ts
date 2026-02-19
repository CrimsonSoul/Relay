/**
 * Data Record Handlers - IPC handlers for JSON-based data operations
 * Handles contacts, servers, on-call records, and data manager operations
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS, type DataStats } from '@shared/ipc';
import {
  ContactRecordInputSchema,
  ServerRecordInputSchema,
  ContactRecordUpdateSchema,
  ServerRecordUpdateSchema,
  OnCallRecordInputSchema,
  OnCallRecordUpdateSchema,
  ExportOptionsSchema,
  DataCategorySchema,
  validateIpcDataSafe,
} from '@shared/ipcValidation';
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
  // Import/Export
  exportData,
  importData,
} from '../operations';
import { loggers } from '../logger';
import { checkMutationRateLimit, safeMutation } from './ipcHelpers';
import { getErrorMessage } from '@shared/types';

export function setupDataRecordHandlers(getDataRoot: () => Promise<string>) {
  // ==================== Contacts ====================
  ipcMain.handle(IPC_CHANNELS.GET_CONTACTS, async () => {
    try {
      return getContacts(await getDataRoot());
    } catch (e) {
      loggers.ipc.error('GET_CONTACTS failed', {
        error: getErrorMessage(e),
      });
      return [];
    }
  });

  safeMutation(IPC_CHANNELS.ADD_CONTACT_RECORD, async (_, contact) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validated = validateIpcDataSafe(
      ContactRecordInputSchema,
      contact,
      'ADD_CONTACT_RECORD',
      (m, d) => loggers.ipc.warn(m, d),
    );
    if (!validated) return { success: false, error: 'Invalid contact data' };
    const result = await addContactRecord(await getDataRoot(), validated);
    return { success: !!result, data: result || undefined };
  });

  safeMutation(IPC_CHANNELS.UPDATE_CONTACT_RECORD, async (_, id, updates) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid ID' };
    const validatedUpdates = validateIpcDataSafe(
      ContactRecordUpdateSchema,
      updates,
      'UPDATE_CONTACT_RECORD',
      (m, d) => loggers.ipc.warn(m, d),
    );
    if (!validatedUpdates) return { success: false, error: 'Invalid update data' };
    const success = await updateContactRecord(await getDataRoot(), id, validatedUpdates);
    return { success };
  });

  safeMutation(IPC_CHANNELS.DELETE_CONTACT_RECORD, async (_, id) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid ID' };
    const success = await deleteContactRecord(await getDataRoot(), id);
    return { success };
  });

  // ==================== Servers ====================
  ipcMain.handle(IPC_CHANNELS.GET_SERVERS, async () => {
    try {
      return getServers(await getDataRoot());
    } catch (e) {
      loggers.ipc.error('GET_SERVERS failed', {
        error: getErrorMessage(e),
      });
      return [];
    }
  });

  safeMutation(IPC_CHANNELS.ADD_SERVER_RECORD, async (_, server) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validated = validateIpcDataSafe(
      ServerRecordInputSchema,
      server,
      'ADD_SERVER_RECORD',
      (m, d) => loggers.ipc.warn(m, d),
    );
    if (!validated) return { success: false, error: 'Invalid server data' };
    const result = await addServerRecord(await getDataRoot(), validated);
    return { success: !!result, data: result || undefined };
  });

  safeMutation(IPC_CHANNELS.UPDATE_SERVER_RECORD, async (_, id, updates) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid ID' };
    const validatedUpdates = validateIpcDataSafe(
      ServerRecordUpdateSchema,
      updates,
      'UPDATE_SERVER_RECORD',
      (m, d) => loggers.ipc.warn(m, d),
    );
    if (!validatedUpdates) return { success: false, error: 'Invalid update data' };
    const success = await updateServerRecord(await getDataRoot(), id, validatedUpdates);
    return { success };
  });

  safeMutation(IPC_CHANNELS.DELETE_SERVER_RECORD, async (_, id) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid ID' };
    const success = await deleteServerRecord(await getDataRoot(), id);
    return { success };
  });

  // ==================== OnCall ====================
  ipcMain.handle(IPC_CHANNELS.GET_ONCALL, async () => {
    try {
      return getOnCall(await getDataRoot());
    } catch (e) {
      loggers.ipc.error('GET_ONCALL failed', { error: getErrorMessage(e) });
      return [];
    }
  });

  safeMutation(IPC_CHANNELS.ADD_ONCALL_RECORD, async (_, record) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    const validated = validateIpcDataSafe(
      OnCallRecordInputSchema,
      record,
      'ADD_ONCALL_RECORD',
      (m, d) => loggers.ipc.warn(m, d),
    );
    if (!validated) return { success: false, error: 'Invalid on-call record data' };
    const result = await addOnCallRecord(await getDataRoot(), validated);
    return { success: !!result, data: result || undefined };
  });

  safeMutation(IPC_CHANNELS.UPDATE_ONCALL_RECORD, async (_, id, updates) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid ID' };
    const validatedUpdates = validateIpcDataSafe(
      OnCallRecordUpdateSchema,
      updates,
      'UPDATE_ONCALL_RECORD',
      (m, d) => loggers.ipc.warn(m, d),
    );
    if (!validatedUpdates) return { success: false, error: 'Invalid update data' };
    const success = await updateOnCallRecord(await getDataRoot(), id, validatedUpdates);
    return { success };
  });

  safeMutation(IPC_CHANNELS.DELETE_ONCALL_RECORD, async (_, id) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid ID' };
    const success = await deleteOnCallRecord(await getDataRoot(), id);
    return { success };
  });

  safeMutation(IPC_CHANNELS.DELETE_ONCALL_BY_TEAM, async (_, team) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    if (typeof team !== 'string' || !team) return { success: false, error: 'Invalid team name' };
    const success = await deleteOnCallByTeam(await getDataRoot(), team);
    return { success };
  });

  // ==================== Data Manager ====================
  safeMutation(IPC_CHANNELS.EXPORT_DATA, async (_, options) => {
    const validated = validateIpcDataSafe(ExportOptionsSchema, options, 'EXPORT_DATA', (m, d) =>
      loggers.ipc.warn(m, d),
    );
    if (!validated) return { success: false, error: 'Invalid export options' };
    const success = await exportData(await getDataRoot(), validated);
    return { success };
  });

  safeMutation(IPC_CHANNELS.IMPORT_DATA, async (_, category) => {
    if (!checkMutationRateLimit()) {
      return { success: false, rateLimited: true, error: 'Rate limited' };
    }
    const validated = validateIpcDataSafe(DataCategorySchema, category, 'IMPORT_DATA', (m, d) =>
      loggers.ipc.warn(m, d),
    );
    if (!validated) return { success: false, error: 'Invalid category' };
    const result = await importData(await getDataRoot(), validated);
    return { success: result.success, data: result };
  });

  ipcMain.handle(IPC_CHANNELS.GET_DATA_STATS, async (): Promise<DataStats> => {
    try {
      const rootDir = await getDataRoot();
      const [contacts, servers, onCall, groups] = await Promise.all([
        getContacts(rootDir),
        getServers(rootDir),
        getOnCall(rootDir),
        getGroups(rootDir),
      ]);

      const getLastUpdated = (records: Array<{ updatedAt?: number }>) => {
        if (records.length === 0) return 0;
        return Math.max(...records.map((r) => r.updatedAt || 0));
      };

      return {
        contacts: { count: contacts.length, lastUpdated: getLastUpdated(contacts) },
        servers: { count: servers.length, lastUpdated: getLastUpdated(servers) },
        oncall: { count: onCall.length, lastUpdated: getLastUpdated(onCall) },
        groups: { count: groups.length, lastUpdated: getLastUpdated(groups) },
      };
    } catch (e) {
      loggers.ipc.error('GET_DATA_STATS failed', {
        error: getErrorMessage(e),
      });
      return {
        contacts: { count: 0, lastUpdated: 0 },
        servers: { count: 0, lastUpdated: 0 },
        oncall: { count: 0, lastUpdated: 0 },
        groups: { count: 0, lastUpdated: 0 },
      };
    }
  });
}
