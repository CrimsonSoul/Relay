import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { LogEntrySchema } from '@shared/ipcValidation';
import { loggers } from '../logger';
import { rateLimiters } from '../rateLimiter';
import { assertTrustedIpcSender } from '../utils/trustedSender';

const MAX_LOG_DATA_DEPTH = 3;
const MAX_LOG_DATA_STRING = 1024;
const MAX_LOG_DATA_ARRAY_ITEMS = 50;
const MAX_LOG_DATA_OBJECT_KEYS = 50;
const TRUNCATED_SUFFIX = '...[truncated]';

function boundRendererLogData(data: unknown, depth = 0): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    return data.length > MAX_LOG_DATA_STRING
      ? `${data.slice(0, MAX_LOG_DATA_STRING)}${TRUNCATED_SUFFIX}`
      : data;
  }
  if (typeof data !== 'object') return data;
  if (depth >= MAX_LOG_DATA_DEPTH) return '[MaxDepth]';

  if (Array.isArray(data)) {
    const bounded = data
      .slice(0, MAX_LOG_DATA_ARRAY_ITEMS)
      .map((item) => boundRendererLogData(item, depth + 1));
    if (data.length > MAX_LOG_DATA_ARRAY_ITEMS) bounded.push(TRUNCATED_SUFFIX);
    return bounded;
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(data).slice(0, MAX_LOG_DATA_OBJECT_KEYS);
  for (const [key, value] of entries) {
    result[key] = boundRendererLogData(value, depth + 1);
  }
  if (Object.keys(data).length > MAX_LOG_DATA_OBJECT_KEYS) {
    result.__truncated = TRUNCATED_SUFFIX;
  }
  return result;
}

/**
 * Setup IPC handlers for renderer-to-main logging and bridge metrics
 */
export function setupLoggerHandlers(): void {
  // Bridge group metrics — log which groups are being composed
  ipcMain.on(IPC_CHANNELS.LOG_BRIDGE, (event, groups: unknown) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.LOG_BRIDGE)) return;
    try {
      const rl = rateLimiters.rendererLogging.tryConsume();
      if (!rl.allowed) return;

      if (!Array.isArray(groups)) {
        loggers.ipc.warn('Invalid LOG_BRIDGE payload — expected string[]');
        return;
      }

      const boundedGroups = groups
        .slice(0, MAX_LOG_DATA_ARRAY_ITEMS)
        .map((group) => boundRendererLogData(group));
      if (!boundedGroups.every((g) => typeof g === 'string')) {
        loggers.ipc.warn('Invalid LOG_BRIDGE payload — expected string[]');
        return;
      }
      if (groups.length > MAX_LOG_DATA_ARRAY_ITEMS) boundedGroups.push(TRUNCATED_SUFFIX);

      loggers.bridge.info('Bridge composed', {
        groups: boundedGroups,
        groupCount: groups.length,
      });
    } catch (err) {
      loggers.ipc.error('Failed to process bridge log', { error: err });
    }
  });

  // Renderer-to-main log bridge: all renderer logs are routed through loggers.bridge
  // to distinguish them from main-process logs. The renderer module name is included
  // in the message prefix (e.g., "[sync] replay failed") for filtering.
  ipcMain.on(IPC_CHANNELS.LOG_TO_MAIN, (event, entry) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.LOG_TO_MAIN)) return;
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

      const { level, message } = validated.data;
      const data = boundRendererLogData(validated.data.data);
      // Sanitize renderer-controlled module name: allow only alphanumeric, dots, hyphens; truncate to 50 chars
      const module = validated.data.module.replaceAll(/[^a-zA-Z0-9.-]/g, '').slice(0, 50);

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
