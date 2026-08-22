import { ipcMain } from 'electron';
import { hostname, networkInterfaces } from 'node:os';
import { z } from 'zod';
import {
  IPC_CHANNELS,
  RELAY_APP_USER_EMAIL,
  type PublicRelayConfig,
  type SetupTestConnectionResult,
} from '@shared/ipc';
import { isAllowedRelayServerUrl, normalizeRelayServerUrl } from '@shared/urlSecurity';
import { ServerWebConfigSchema } from '@shared/ipcValidation';
import type { AppConfig, RelayConfig } from '../config/AppConfig';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';
import { discoverServers } from '../discovery/RelayDiscovery';
import { loggers } from '../logger';
import { rateLimiters } from '../rateLimiter';
import { assertTrustedIpcSender } from '../utils/trustedSender';

const MAX_RELAY_SECRET_LENGTH = 256;
const MAX_SERVER_URL_LENGTH = 2048;

const relaySecretSchema = z.string().min(8).max(MAX_RELAY_SECRET_LENGTH);
const relayServerUrlSchema = z
  .string()
  .max(MAX_SERVER_URL_LENGTH)
  .refine((value) => z.url().safeParse(value).success, { message: 'Invalid URL' });

const serverConfigSchema = z
  .object({
    mode: z.literal('server'),
    port: z.number().int().min(1024).max(65535),
    bindHost: z.enum(['127.0.0.1', '0.0.0.0']).default('0.0.0.0'),
    secret: relaySecretSchema,
    web: ServerWebConfigSchema.optional(),
  })
  .superRefine((config, context) => {
    if (!config.web) return;
    if (config.web.port === config.port) {
      context.addIssue({
        code: 'custom',
        message: 'Relay Web must use a different port than PocketBase.',
        path: ['web', 'port'],
      });
    }
    if (config.web.enabled && config.bindHost !== '0.0.0.0') {
      context.addIssue({
        code: 'custom',
        message: 'Relay Web requires direct LAN access.',
        path: ['web', 'enabled'],
      });
    }
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

/**
 * Identity of the data source a config points at. Cached records and queued
 * mutations belong to one server, so only a change here makes them stale — the
 * secret deliberately does not participate, since rotating the passphrase for
 * the same server leaves its data (and any offline edits to it) perfectly valid.
 */
function relayServerTarget(config: RelayConfig): string {
  return config.mode === 'client'
    ? `client:${config.serverUrl}`
    : `server:${config.bindHost}:${config.port}`;
}

/**
 * Whether this machine has already committed to plaintext HTTP for its Relay
 * server. The renderer-supplied flag cannot stand in for this: it arrives in the
 * same payload as the URL it authorizes, so a compromised renderer could name
 * any host:port and read the probe's distinct outcomes back as a port scan.
 */
function hasPersistedInsecureHttpOptIn(config: AppConfig | null): boolean {
  const loaded = config?.load();
  return loaded?.mode === 'client' && loaded.allowInsecureHttp === true;
}

function toPublicConfig(config: RelayConfig): PublicRelayConfig {
  if (config.mode === 'server') {
    return {
      mode: 'server',
      port: config.port,
      bindHost: config.bindHost,
      lanIp: getLanIpAddress(),
      ...(config.web ? { web: { ...config.web } } : {}),
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
  ipcMain.handle(IPC_CHANNELS.SETUP_GET_CONFIG, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.SETUP_GET_CONFIG)) return null;
    const config = getAppConfig();
    const loaded = config ? config.load() : null;
    return loaded ? toPublicConfig(loaded) : null;
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_GET_CONNECTION_CREDENTIAL, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.SETUP_GET_CONNECTION_CREDENTIAL)) return null;
    const config = getAppConfig();
    const loaded = config ? config.load() : null;
    return loaded?.secret ?? null;
  });
  ipcMain.handle(IPC_CHANNELS.CLIENT_GET_HOSTNAME, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.CLIENT_GET_HOSTNAME)) return null;
    return hostname().trim() || null;
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_SAVE_CONFIG, (event, configData) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.SETUP_SAVE_CONFIG)) return false;
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

    // Read the outgoing target before the save overwrites it.
    const previous = config.load();
    config.save(configToSave);

    // Invalidate offline cache and pending changes only when the server target
    // actually changes, since cached data from the old server is stale and
    // potentially wrong. Walking the wizard back to the SAME server — the common
    // "Reconfigure..." path — must not silently destroy unsynced offline edits.
    if (previous && relayServerTarget(previous) === relayServerTarget(configToSave)) {
      return true;
    }

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
        // Report what the switch costs the user: these mutations were never
        // accepted by any server and cannot be replayed against the new one.
        const discardedPendingCount = pending.count();
        pending.clear();
        if (discardedPendingCount > 0) {
          loggers.main.warn('Unsynced pending changes discarded after reconfiguration', {
            discardedPendingCount,
          });
        } else {
          loggers.main.info('Pending changes cleared after reconfiguration');
        }
      }
    } catch (err) {
      loggers.main.warn('Failed to clear pending changes during reconfiguration', { error: err });
    }

    return true;
  });
  ipcMain.handle(
    IPC_CHANNELS.SETUP_TEST_CONNECTION,
    async (event, payload): Promise<SetupTestConnectionResult> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.SETUP_TEST_CONNECTION)) {
        return { ok: false, error: 'invalid-url' };
      }
      const parsed = testConnectionSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, error: 'invalid-url' };

      // The payload's allowInsecureHttp is ignored on purpose — see
      // hasPersistedInsecureHttpOptIn. Without a stored opt-in this keeps HTTP
      // probes on the LAN, where the reachability answer is already public.
      const serverUrl = normalizeRelayServerUrl(parsed.data.serverUrl);
      if (
        !serverUrl ||
        !isAllowedRelayServerUrl(serverUrl, hasPersistedInsecureHttpOptIn(getAppConfig()))
      ) {
        return { ok: false, error: 'invalid-url' };
      }

      // Renderer-directed outbound requests to a renderer-named origin: metered
      // so the unreachable/auth-failed/ok distinction cannot be swept across a
      // host's ports, and so the secret is not replayed at machine speed.
      if (!rateLimiters.network.tryConsume().allowed) {
        return { ok: false, error: 'unreachable' };
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
  ipcMain.handle(IPC_CHANNELS.SETUP_DISCOVER_SERVERS, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.SETUP_DISCOVER_SERVERS)) return [];
    return discoverServers();
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_IS_CONFIGURED, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.SETUP_IS_CONFIGURED)) return false;
    const config = getAppConfig();
    return config ? config.isConfigured() : false;
  });
  ipcMain.handle(IPC_CHANNELS.SETUP_CLEAR_CONFIG, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.SETUP_CLEAR_CONFIG)) return false;
    const config = getAppConfig();
    if (!config) return false;
    return config.clear();
  });
}
