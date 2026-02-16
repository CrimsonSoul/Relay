import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { LogEntrySchema } from '@shared/ipcValidation';
import { loggers } from '../logger';
import { rateLimiters } from '../rateLimiter';

/**
 * Setup IPC handlers for renderer-to-main logging and bridge metrics
 */
export function setupLoggerHandlers(): void {
  // Bridge group metrics — log which groups are being composed
  ipcMain.on(IPC_CHANNELS.LOG_BRIDGE, (_event, groups: unknown) => {
    try {
      if (!Array.isArray(groups) || !groups.every((g) => typeof g === 'string')) {
        loggers.ipc.warn('Invalid LOG_BRIDGE payload — expected string[]');
        return;
      }
      loggers.bridge.info('Bridge composed', { groups, groupCount: groups.length });
    } catch (err) {
      loggers.ipc.error('Failed to process bridge log', { error: err });
    }
  });

  ipcMain.on(IPC_CHANNELS.LOG_TO_MAIN, (_event, entry) => {
    try {
      // Rate-limit renderer logging to prevent log flooding
      const rl = rateLimiters.rendererLogging.tryConsume();
      if (!rl.allowed) return;

      const validated = LogEntrySchema.safeParse(entry);
      if (!validated.success) {
        loggers.ipc.warn('Invalid log entry received from renderer', {
          error: validated.error.message,
        });
        return;
      }

      const { level, module, message, data } = validated.data;

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
      loggers.ipc.error('Failed to process log from renderer', { error: err });
    }
  });
}
