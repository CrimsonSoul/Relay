import type { BridgeAPI, PbConnectionResult } from '@shared/ipc';
import { WebSessionBootstrapResultSchema } from '@shared/webApi';
import { noopSubscription, unavailable, type WebBridgeContext } from './context';

export type DesktopFallbackApi = Pick<
  BridgeAPI,
  | 'windowMinimize'
  | 'windowMaximize'
  | 'windowClose'
  | 'isMaximized'
  | 'onMaximizeChange'
  | 'getConfig'
  | 'getConnectionSecret'
  | 'getClientHostname'
  | 'saveConfig'
  | 'clearConfig'
  | 'isConfigured'
  | 'testConnection'
  | 'discoverServers'
  | 'getWebServerState'
  | 'saveWebServerConfig'
  | 'retryWebServer'
  | 'cacheRead'
  | 'cacheQueryRead'
  | 'cacheQuerySnapshot'
  | 'cacheWrite'
  | 'cacheSnapshot'
  | 'mutateOffline'
  | 'onOfflineMutationApplied'
  | 'getPendingSyncStatus'
  | 'onPendingSyncStatusChanged'
  | 'syncPending'
  | 'getPbConnection'
  | 'refreshPbConnection'
  | 'startPocketBase'
  | 'relaunchApp'
  | 'listBackups'
  | 'createBackup'
  | 'restoreBackup'
>;

export function createDesktopFallbackApi({
  session,
  refreshSession,
}: WebBridgeContext): DesktopFallbackApi {
  const connection = (): PbConnectionResult => ({
    ok: true,
    connection: { pbUrl: session.pbUrl, auth: session.auth },
  });

  return {
    windowMinimize: () => undefined,
    windowMaximize: () => undefined,
    windowClose: () => undefined,
    isMaximized: async () => false,
    onMaximizeChange: noopSubscription,
    getConfig: async () => session.publicConfig,
    getConnectionSecret: async () => null,
    getClientHostname: async () => session.presenceLabel ?? 'Web · Other · LAN/VPN client',
    saveConfig: async () => false,
    clearConfig: async () => false,
    isConfigured: async () => true,
    testConnection: async () => ({ ok: false, error: 'unreachable' }),
    discoverServers: async () => [],
    getWebServerState: async () => ({
      enabled: true,
      status: 'available',
      port: globalThis.location?.port ? Number(globalThis.location.port) : 8091,
      url: globalThis.location?.origin,
    }),
    saveWebServerConfig: async () => unavailable('Configure Relay Web in Relay Desktop.'),
    retryWebServer: async () => unavailable('Restart Relay Web from Relay Desktop.'),
    cacheRead: async () => [],
    cacheQueryRead: async () => null,
    cacheQuerySnapshot: async () => undefined,
    cacheWrite: async () => undefined,
    cacheSnapshot: async () => undefined,
    mutateOffline: async () => ({ ok: false, error: 'Web access is online-only.' }),
    onOfflineMutationApplied: noopSubscription,
    getPendingSyncStatus: async () => ({ pendingCount: 0 }),
    onPendingSyncStatusChanged: noopSubscription,
    syncPending: async () => ({ total: 0, conflicts: 0, errors: [], remaining: 0 }),
    getPbConnection: async () => connection(),
    refreshPbConnection: async () => {
      if (!refreshSession) return connection();
      const result = WebSessionBootstrapResultSchema.safeParse(await refreshSession());
      return result.success && result.data.ok
        ? {
            ok: true,
            connection: { pbUrl: result.data.session.pbUrl, auth: result.data.session.auth },
          }
        : { ok: false, error: 'auth-failed' };
    },
    startPocketBase: async () => false,
    relaunchApp: async () => undefined,
    listBackups: async () => [],
    createBackup: async () => unavailable('Backups are available in Relay Desktop.'),
    restoreBackup: async () => unavailable('Restore is available in Relay Desktop.'),
  } satisfies DesktopFallbackApi;
}
