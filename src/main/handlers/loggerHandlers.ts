import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { loggers } from '../logger';

/**
 * Setup IPC handler for renderer-to-main logging
 */
export function setupLoggerHandlers(): void {
  ipcMain.on(IPC_CHANNELS.LOG_TO_MAIN, (_event, entry: {
    level: string;
    module: string;
    message: string;
    data?: unknown;
  }) => {
    try {
      const { level, module, message, data } = entry;

      // Map level string to logger method
      switch (level.toUpperCase()) {
        case 'DEBUG':
          loggers.bridge.debug(`[${module}] ${message}`, data);
          break;
        case 'INFO':
          loggers.bridge.info(`[${module}] ${message}`, data);
          break;
        case 'WARN':
          loggers.bridge.warn(`[${module}] ${message}`, data);
          break;
        case 'ERROR':
          loggers.bridge.error(`[${module}] ${message}`, data);
          break;
        case 'FATAL':
          loggers.bridge.fatal(`[${module}] ${message}`, data);
          break;
        default:
          loggers.bridge.info(`[${module}] ${message}`, data);
      }
    } catch (err) {
      // Fallback to console if logger fails
      console.error('[LoggerHandler] Failed to process log from renderer:', err);
    }
  });
}
