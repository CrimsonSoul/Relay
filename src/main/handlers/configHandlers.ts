import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { registerTrustedWebviewOrigin, clearTrustedRuntimeOrigins } from '../securityPolicy';
import { checkMutationRateLimit } from './ipcHelpers';

export function setupConfigHandlers() {
  ipcMain.handle(IPC_CHANNELS.REGISTER_RADAR_URL, (_event, url: string) => {
    if (!checkMutationRateLimit()) return { success: false, error: 'Rate limited' };
    clearTrustedRuntimeOrigins();
    if (typeof url !== 'string' || !url || url.length > 2048) return;
    // Only allow HTTPS URLs to be registered as trusted webview origins
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return;
    } catch {
      return;
    }
    registerTrustedWebviewOrigin(url);
  });
}
