import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { AppConfig, RelayConfig } from '../config/AppConfig';
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

export function setupSetupHandlers(getAppConfig: () => AppConfig | null): void {
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
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_IS_CONFIGURED, () => {
    const config = getAppConfig();
    return config ? config.isConfigured() : false;
  });
}
