import { ipcMain } from 'electron';
import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import { IPC_CHANNELS, type PublicRelayConfig } from '@shared/ipc';
import { isAllowedRelayServerUrl } from '@shared/urlSecurity';
import type { AppConfig, RelayConfig } from '../config/AppConfig';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';
import { loggers } from '../logger';

const serverConfigSchema = z.object({
  mode: z.literal('server'),
  port: z.number().int().min(1024).max(65535),
  bindHost: z.enum(['127.0.0.1', '0.0.0.0']),
  secret: z.string().min(8),
});

const clientConfigSchema = z
  .object({
    mode: z.literal('client'),
    serverUrl: z.url(),
    allowInsecureHttp: z.boolean().optional(),
    secret: z.string().min(8),
  })
  .refine(
    (config) => isAllowedRelayServerUrl(config.serverUrl, config.allowInsecureHttp === true),
    {
      message: 'Public HTTP Relay server URLs require explicit insecure HTTP opt-in',
      path: ['serverUrl'],
    },
  );

const relayConfigSchema = z.discriminatedUnion('mode', [serverConfigSchema, clientConfigSchema]);

function getLanIpAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    const address = addresses?.find((entry) => entry.family === 'IPv4' && !entry.internal);
    if (address) return address.address;
  }
  return undefined;
}

function toPublicConfig(config: RelayConfig): PublicRelayConfig {
  if (config.mode === 'server') {
    return {
      mode: 'server',
      port: config.port,
      bindHost: config.bindHost,
      lanIp: getLanIpAddress(),
    };
  }
  return {
    mode: 'client',
    serverUrl: config.serverUrl,
    ...(config.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
  };
}

export function setupSetupHandlers(
  getAppConfig: () => AppConfig | null,
  getOfflineCache?: () => OfflineCache | null,
  getPendingChanges?: () => PendingChanges | null,
): void {
  ipcMain.handle(IPC_CHANNELS.SETUP_GET_CONFIG, () => {
    const config = getAppConfig();
    const loaded = config ? config.load() : null;
    return loaded ? toPublicConfig(loaded) : null;
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_SAVE_CONFIG, (_event, configData) => {
    const config = getAppConfig();
    if (!config) return false;
    const result = relayConfigSchema.safeParse(configData);
    if (!result.success) {
      loggers.main.warn('Invalid config data rejected', { errors: result.error.issues });
      return false;
    }
    config.save(result.data);

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
