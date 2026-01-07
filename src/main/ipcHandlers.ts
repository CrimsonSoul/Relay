import { ipcMain, dialog, shell } from 'electron';
import { BrowserWindow } from 'electron';
import { join, relative, isAbsolute, resolve, normalize } from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { IPC_CHANNELS } from '../shared/ipc';
import { FileManager } from './FileManager';
import { BridgeLogger } from './BridgeLogger';
import { rateLimiters } from './rateLimiter';
import { setupWeatherHandlers } from './handlers/weatherHandlers';
import { setupWindowHandlers, setupWindowListeners } from './handlers/windowHandlers';
import { loggers } from './logger';

/**
 * Check if a path is a Windows UNC path (\\server\share)
 */
function isUncPath(path: string): boolean {
  return /^[/\\]{2}[^/\\]+[/\\]+[^/\\]+/.test(path);
}

/**
 * Safely resolve a path to its real location, following symlinks
 * Returns null if the path doesn't exist or can't be resolved
 */
async function safeRealPath(path: string): Promise<string | null> {
  try {
    return await fsPromises.realpath(path);
  } catch {
    // Path doesn't exist or can't be resolved
    return null;
  }
}

export function setupIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  getFileManager: () => FileManager | null,
  getBridgeLogger: () => BridgeLogger | null,
  getDataRoot: () => string,
  onDataPathChange: (newPath: string) => void,
  getDefaultDataPath: () => string
) {

  // Setup Weather Handlers
  setupWeatherHandlers();

  // Setup Window Handlers
  setupWindowHandlers(getMainWindow);

  // Helper for hardened path validation
  // Protects against: symlink attacks, path traversal, UNC path escapes
  const validatePath = async (requestedPath: string): Promise<boolean> => {
    const root = getDataRoot();
    if (!requestedPath || !root) return false;

    // Block UNC paths entirely (Windows network paths like \\server\share)
    if (isUncPath(requestedPath)) {
      loggers.security.warn(`Blocked UNC path: ${requestedPath}`);
      return false;
    }

    // Normalize and resolve the path to handle ../ sequences
    const normalizedPath = normalize(requestedPath);

    // Block if normalization reveals UNC path
    if (isUncPath(normalizedPath)) {
      loggers.security.warn(`Blocked normalized UNC path: ${normalizedPath}`);
      return false;
    }

    // Resolve to absolute path
    const absPath = resolve(root, normalizedPath);

    // First check: simple path containment
    const rel = relative(root, absPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return false;
    }

    // Second check: resolve symlinks if path exists
    // This prevents symlink-based escapes from the data root
    const realRoot = await safeRealPath(root);
    if (!realRoot) {
      loggers.security.warn(`Could not resolve real path for root: ${root}`);
      return false;
    }

    // If the path exists, verify its real location
    const realPath = await safeRealPath(absPath);
    if (realPath) {
      const realRel = relative(realRoot, realPath);
      if (realRel.startsWith('..') || isAbsolute(realRel)) {
        loggers.security.warn(`Path escapes root via symlink: ${requestedPath} -> ${realPath}`);
        return false;
      }
    }

    return true;
  };

  // Config IPCs
  ipcMain.handle(IPC_CHANNELS.GET_DATA_PATH, async () => {
    return getDataRoot();
  });

  ipcMain.handle(IPC_CHANNELS.CHANGE_DATA_FOLDER, async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return false;

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select New Data Folder',
      properties: ['openDirectory']
    });

    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };

    try {
      onDataPathChange(filePaths[0]);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RESET_DATA_FOLDER, async () => {
    const defaultPath = getDefaultDataPath();
    try {
      onDataPathChange(defaultPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });


  // FS IPCs
  ipcMain.handle(IPC_CHANNELS.OPEN_PATH, async (_event, path: string) => {
    if (!await validatePath(path)) {
      loggers.security.error(`Blocked access to path outside data root: ${path}`);
      return;
    }
    await shell.openPath(path);
  });

  const getGroupsFilePath = () => {
    const root = getDataRoot();
    const candidates = ['groups.csv'];
    for (const file of candidates) {
      const fullPath = join(root, file);
      if (fs.existsSync(fullPath)) return fullPath;
    }
    return join(root, candidates[0]);
  };

  const getContactsFilePath = () => {
    const root = getDataRoot();
    const candidates = ['contacts.csv'];
    for (const file of candidates) {
      const fullPath = join(root, file);
      if (fs.existsSync(fullPath)) return fullPath;
    }
    return join(root, candidates[0]);
  };

  ipcMain.handle(IPC_CHANNELS.OPEN_GROUPS_FILE, async () => {
    await shell.openPath(getGroupsFilePath());
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_CONTACTS_FILE, async () => {
    await shell.openPath(getContactsFilePath());
  });

  // Import Handlers (rate limited to prevent DoS)
  const handleMergeImport = async (type: 'groups' | 'contacts', title: string) => {
    // Rate limit file imports (expensive operations)
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

  ipcMain.handle(IPC_CHANNELS.IMPORT_GROUPS_FILE, async () => {
    return handleMergeImport('groups', 'Merge Groups CSV');
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CONTACTS_FILE, async () => {
    return handleMergeImport('contacts', 'Merge Contacts CSV');
  });

  // Helper for URL validation
  const validateUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
    } catch {
      // Invalid URL format - return false for validation
      return false;
    }
  };

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_event, url: string) => {
    if (!validateUrl(url)) {
      loggers.security.error(`Blocked opening external URL with unsafe protocol: ${url}`);
      return;
    }
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC_CHANNELS.DATA_RELOAD, async () => {
    // Rate limit data reloads
    const rateLimitResult = rateLimiters.dataReload.tryConsume();
    if (!rateLimitResult.allowed) {
      loggers.ipc.warn(`Data reload blocked, retry after ${rateLimitResult.retryAfterMs}ms`);
      return { success: false, rateLimited: true };
    }
    getFileManager()?.readAndEmit();
  });

  ipcMain.on(IPC_CHANNELS.RADAR_DATA, (_event, payload) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.RADAR_DATA, payload);
    }
  });

  ipcMain.on(IPC_CHANNELS.LOG_BRIDGE, (_event, groups: string[]) => {
    getBridgeLogger()?.logBridge(groups);
  });

  ipcMain.handle(IPC_CHANNELS.GET_METRICS, async () => {
    return getBridgeLogger()?.getMetrics();
  });

  ipcMain.handle(IPC_CHANNELS.RESET_METRICS, async () => {
    return getBridgeLogger()?.reset() ?? false;
  });

  // Location Handler
  ipcMain.handle(IPC_CHANNELS.GET_IP_LOCATION, async () => {
    try {
      // Primary: ipapi.co (HTTPS)
      const res = await fetch('https://ipapi.co/json/', {
        headers: { 'User-Agent': 'Relay-App' }
      });
      if (res.ok) {
        const data: any = await res.json();
        return {
          lat: data.latitude,
          lon: data.longitude,
          city: data.city,
          region: data.region,
          country: data.country_name,
          timezone: data.timezone
        };
      }
    } catch (err) {
      loggers.ipc.warn('Location primary provider failed, trying fallback', { error: err });
    }

    try {
      // Fallback: ip-api.com (HTTP)
      // Note: This endpoint is free but rate-limited (45 req/min)
      const res = await fetch('http://ip-api.com/json/');
      if (res.ok) {
        const data: any = await res.json();
        return {
          lat: data.lat,
          lon: data.lon,
          city: data.city,
          region: data.regionName,
          country: data.country,
          timezone: data.timezone
        };
      }
    } catch (err) {
      loggers.ipc.error('All location providers failed', { error: err });
    }
    
    return null;
  });

  // --- Data Mutation Handlers (rate limited) ---

  // Helper to check mutation rate limit
  const checkMutationRateLimit = () => {
    const result = rateLimiters.dataMutation.tryConsume();
    if (!result.allowed) {
      loggers.ipc.warn(`Data mutation blocked, retry after ${result.retryAfterMs}ms`);
    }
    return result.allowed;
  };

  ipcMain.handle(IPC_CHANNELS.ADD_CONTACT, async (_event, contact) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.addContact(contact) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_CONTACT, async (_event, email) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.removeContact(email) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.ADD_GROUP, async (_event, groupName) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.addGroup(groupName) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.ADD_CONTACT_TO_GROUP, async (_event, groupName, email) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.updateGroupMembership(groupName, email, false) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_CONTACT_FROM_GROUP, async (_event, groupName, email) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.updateGroupMembership(groupName, email, true) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_GROUP, async (_event, groupName) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.removeGroup(groupName) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.RENAME_GROUP, async (_event, oldName, newName) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.renameGroup(oldName, newName) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_ONCALL_TEAM, async (_event, team, rows) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.updateOnCallTeam(team, rows) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_ONCALL_TEAM, async (_event, team) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.removeOnCallTeam(team) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.RENAME_ONCALL_TEAM, async (_event, oldName, newName) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.renameOnCallTeam(oldName, newName) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_ALL_ONCALL, async (_event, rows) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.saveAllOnCall(rows) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CONTACTS_WITH_MAPPING, async () => {
    return handleMergeImport('contacts', 'Merge Contacts CSV');
  });

  ipcMain.handle(IPC_CHANNELS.GENERATE_DUMMY_DATA, async () => {
    loggers.ipc.debug('Received GENERATE_DUMMY_DATA request');
    if (!checkMutationRateLimit()) {
      loggers.ipc.warn('Rate limit exceeded for dummy data');
      return { success: false, rateLimited: true };
    }
    const fm = getFileManager();
    if (!fm) {
      loggers.ipc.error('FileManager not available');
      return false;
    }
    return fm.generateDummyData();
  });

  // Server Handlers (rate limited)
  ipcMain.handle(IPC_CHANNELS.ADD_SERVER, async (_event, server) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.addServer(server) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_SERVER, async (_event, name) => {
    if (!checkMutationRateLimit()) return { success: false, rateLimited: true };
    return getFileManager()?.removeServer(name) ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_SERVERS_FILE, async () => {
    // Rate limit file imports
    const rateLimitResult = rateLimiters.fileImport.tryConsume();
    if (!rateLimitResult.allowed) {
      loggers.ipc.warn(`Server import blocked, retry after ${rateLimitResult.retryAfterMs}ms`);
      return { success: false, rateLimited: true };
    }

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

  // Listen for maximize/unmaximize events and notify renderer
  const mw = getMainWindow();
  if (mw) {
    setupWindowListeners(mw);
  }
}

