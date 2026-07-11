import { ipcMain } from 'electron';
import { IPC_CHANNELS, type CloudStatusData } from '@shared/ipc';
import { ErrorCategory } from '@shared/logging';
import { getCloudStatusManager } from '../../app/appState';
import { loggers } from '../../logger';
import { checkNetworkRateLimit } from '../../rateLimiter';
import { assertTrustedIpcSender } from '../../utils/trustedSender';
import { emptyCloudStatusProviders, fetchCloudStatusData } from './fetchCloudStatus';

const MANUAL_CACHE_TTL_MS = 60_000;
let manualCache: { data: CloudStatusData; fetchedAt: number } | null = null;

function cachedOrEmpty(): CloudStatusData {
  return (
    getCloudStatusManager()?.getSnapshot() ??
    manualCache?.data ?? {
      providers: emptyCloudStatusProviders(),
      lastUpdated: 0,
      errors: [],
    }
  );
}

export function setupCloudStatusHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GET_CLOUD_STATUS, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.GET_CLOUD_STATUS)) return cachedOrEmpty();
    if (!checkNetworkRateLimit()) return cachedOrEmpty();

    const manager = getCloudStatusManager();
    if (manager) return manager.refresh({ force: true });

    if (manualCache && Date.now() - manualCache.fetchedAt < MANUAL_CACHE_TTL_MS) {
      return manualCache.data;
    }

    try {
      const data = await fetchCloudStatusData(manualCache?.data);
      manualCache = { data, fetchedAt: Date.now() };
      return data;
    } catch (error) {
      loggers.cloudStatus.error('Failed to fetch cloud status', {
        error,
        category: ErrorCategory.NETWORK,
      });
      return cachedOrEmpty();
    }
  });
}
