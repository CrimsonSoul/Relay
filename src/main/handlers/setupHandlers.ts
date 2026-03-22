import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { AppConfig } from '../config/AppConfig';

export function setupSetupHandlers(appConfig: AppConfig): void {
  ipcMain.handle(IPC_CHANNELS.SETUP_GET_CONFIG, () => appConfig.load());
  ipcMain.handle(IPC_CHANNELS.SETUP_SAVE_CONFIG, (_event, config) => {
    appConfig.save(config);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_IS_CONFIGURED, () => appConfig.isConfigured());
}
