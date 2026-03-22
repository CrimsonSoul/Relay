import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { AppConfig } from '../config/AppConfig';

export function setupSetupHandlers(getAppConfig: () => AppConfig | null): void {
  ipcMain.handle(IPC_CHANNELS.SETUP_GET_CONFIG, () => {
    const config = getAppConfig();
    return config ? config.load() : null;
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_SAVE_CONFIG, (_event, configData) => {
    const config = getAppConfig();
    if (!config) return false;
    config.save(configData);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_IS_CONFIGURED, () => {
    const config = getAppConfig();
    return config ? config.isConfigured() : false;
  });
}
