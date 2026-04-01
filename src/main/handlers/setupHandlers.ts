import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { AppConfig, RelayConfig } from '../config/AppConfig';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';
import { loggers } from '../logger';

const serverConfigSchema = z.object({
  mode: z.literal('server'),
  port: z.number().int().min(1024).max(65535),
  secret: z.string().min(8),
});

const clientConfigSchema = z.object({
  mode: z.literal('client'),
  serverUrl: z.url(),
  secret: z.string().min(8),
});

const relayConfigSchema = z.discriminatedUnion('mode', [serverConfigSchema, clientConfigSchema]);

export function setupSetupHandlers(
  getAppConfig: () => AppConfig | null,
  getOfflineCache?: () => OfflineCache | null,
  getPendingChanges?: () => PendingChanges | null,
): void {
  ipcMain.handle(IPC_CHANNELS.SETUP_GET_CONFIG, () => {
    const config = getAppConfig();
    return config ? config.load() : null;
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_SAVE_CONFIG, (_event, configData) => {
    const config = getAppConfig();
    if (!config) return false;
    const result = relayConfigSchema.safeParse(configData);
    if (!result.success) {
      loggers.main.warn('Invalid config data rejected', { errors: result.error.issues });
      return false;
    }
    config.save(result.data as RelayConfig);

    // Invalidate offline cache and pending changes when server config changes,
    // since cached data from the old server is stale and potentially wrong.
    try {
      const cache = getOfflineCache?.();
      if (cache) {
        cache.clear();
        loggers.main.info('Offline cache cleared after reconfiguration');
      }
    } catch (err) {
      loggers.main.warn('Failed to clear offline cache during reconfiguration', { error: err });
    }
    try {
      const pending = getPendingChanges?.();
      if (pending) {
        pending.clear();
        loggers.main.info('Pending changes cleared after reconfiguration');
      }
    } catch (err) {
      loggers.main.warn('Failed to clear pending changes during reconfiguration', { error: err });
    }

    return true;
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_IS_CONFIGURED, () => {
    const config = getAppConfig();
    return config ? config.isConfigured() : false;
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_CLEAR_CONFIG, () => {
    const config = getAppConfig();
    if (!config) return false;
    return config.clear();
  });
}
