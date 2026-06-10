import { ipcMain } from 'electron';
import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import {
  IPC_CHANNELS,
  RELAY_APP_USER_EMAIL,
  type PublicRelayConfig,
  type SetupTestConnectionResult,
} from '@shared/ipc';
import { isAllowedRelayServerUrl, normalizeRelayServerUrl } from '@shared/urlSecurity';
import type { AppConfig, RelayConfig } from '../config/AppConfig';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';
import { discoverServers } from '../discovery/RelayDiscovery';
import { loggers } from '../logger';

const MAX_RELAY_SECRET_LENGTH = 256;
const MAX_SERVER_URL_LENGTH = 2048;

const relaySecretSchema = z.string().min(8).max(MAX_RELAY_SECRET_LENGTH);
const relayServerUrlSchema = z
  .string()
  .max(MAX_SERVER_URL_LENGTH)
  .refine((value) => z.url().safeParse(value).success, { message: 'Invalid URL' });

const serverConfigSchema = z.object({
  mode: z.literal('server'),
  port: z.number().int().min(1024).max(65535),
  bindHost: z.enum(['127.0.0.1', '0.0.0.0']).default('0.0.0.0'),
  secret: relaySecretSchema,
});

const clientConfigSchema = z
  .object({
    mode: z.literal('client'),
    serverUrl: relayServerUrlSchema,
    allowInsecureHttp: z.boolean().optional(),
    secret: relaySecretSchema,
  })
  .refine(
    (config) => isAllowedRelayServerUrl(config.serverUrl, config.allowInsecureHttp === true),
    {
      message: 'Public HTTP Relay server URLs require explicit insecure HTTP opt-in',
      path: ['serverUrl'],
    },
  );

const relayConfigSchema = z.discriminatedUnion('mode', [serverConfigSchema, clientConfigSchema]);

// serverUrl is intentionally looser than relayServerUrlSchema: the renderer sends the
// raw input (possibly a bare "host:port") and normalizeRelayServerUrl +
// isAllowedRelayServerUrl below decide validity after normalization.
const testConnectionSchema = z.object({
  serverUrl: z.string().max(MAX_SERVER_URL_LENGTH),
  secret: relaySecretSchema,
  allowInsecureHttp: z.boolean().optional(),
});
const TEST_CONNECTION_TIMEOUT_MS = 5000;

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
    const configToSave =
      result.data.mode === 'client'
        ? { ...result.data, serverUrl: normalizeRelayServerUrl(result.data.serverUrl) }
        : result.data;
    if (configToSave.mode === 'client' && !configToSave.serverUrl) {
      loggers.main.warn('Invalid config data rejected', { errors: ['Invalid server URL'] });
      return false;
    }

    config.save(configToSave);

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
  ipcMain.handle(
    IPC_CHANNELS.SETUP_TEST_CONNECTION,
    async (_event, payload): Promise<SetupTestConnectionResult> => {
      const parsed = testConnectionSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, error: 'invalid-url' };

      const serverUrl = normalizeRelayServerUrl(parsed.data.serverUrl);
      if (
        !serverUrl ||
        !isAllowedRelayServerUrl(serverUrl, parsed.data.allowInsecureHttp === true)
      ) {
        return { ok: false, error: 'invalid-url' };
      }

      try {
        const health = await fetch(`${serverUrl}/api/health`, {
          redirect: 'error',
          signal: AbortSignal.timeout(TEST_CONNECTION_TIMEOUT_MS),
        });
        if (!health.ok) return { ok: false, error: 'unreachable' };
      } catch {
        return { ok: false, error: 'unreachable' };
      }

      try {
        const auth = await fetch(
          `${serverUrl}/api/collections/_pb_users_auth_/auth-with-password`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identity: RELAY_APP_USER_EMAIL, password: parsed.data.secret }),
            redirect: 'error',
            signal: AbortSignal.timeout(TEST_CONNECTION_TIMEOUT_MS),
          },
        );
        if (!auth.ok) return { ok: false, error: 'auth-failed' };
      } catch {
        return { ok: false, error: 'unreachable' };
      }

      return { ok: true };
    },
  );
  ipcMain.handle(IPC_CHANNELS.SETUP_DISCOVER_SERVERS, () => discoverServers());
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
