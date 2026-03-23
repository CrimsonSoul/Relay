import { ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  CLOUD_STATUS_PROVIDER_ORDER,
  CLOUD_STATUS_PROVIDERS,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusProvider,
} from '@shared/ipc';
import { loggers } from '../../logger';
import { ErrorCategory } from '@shared/logging';
import { checkNetworkRateLimit } from '../../rateLimiter';
import { truncateError } from '../ipcHelpers';
import { RSS_FEEDS, fetchRssProvider } from './rssProvider';
import { STATUSPAGE_FEEDS, fetchStatuspageProvider } from './statuspageProvider';
import { fetchGoogleCloudProvider } from './googleProvider';
import { fetchSalesforceProvider } from './salesforceProvider';

// --- Cache ---

const CACHE_TTL_MS = 60_000; // 1-minute server-side cache
let cache: { data: CloudStatusData; fetchedAt: number } | null = null;

// --- Provider fetch dispatcher ---

function fetchProvider(provider: CloudStatusProvider): Promise<CloudStatusItem[]> {
  const rssUrl = RSS_FEEDS[provider];
  if (rssUrl) return fetchRssProvider(rssUrl, provider);

  const statuspageUrl = STATUSPAGE_FEEDS[provider];
  if (statuspageUrl) return fetchStatuspageProvider(statuspageUrl, provider);

  if (provider === 'google') return fetchGoogleCloudProvider();
  if (provider === 'salesforce') return fetchSalesforceProvider();

  return Promise.resolve([]);
}

// --- Empty response helper ---

function emptyProviders(): CloudStatusData['providers'] {
  const providers: CloudStatusData['providers'] = Object.fromEntries(
    CLOUD_STATUS_PROVIDER_ORDER.map((p) => [p, []]),
  ) as CloudStatusData['providers'];
  return providers;
}

/** Return cached data or an empty response. */
function cachedOrEmpty(): CloudStatusData {
  if (cache) return cache.data;
  return { providers: emptyProviders(), lastUpdated: 0, errors: [] };
}

// --- IPC handler ---

export function setupCloudStatusHandlers() {
  ipcMain.handle(IPC_CHANNELS.GET_CLOUD_STATUS, async () => {
    if (!checkNetworkRateLimit()) return cachedOrEmpty();

    // Return cached if fresh
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache.data;
    }

    try {
      const results = await Promise.allSettled(
        CLOUD_STATUS_PROVIDER_ORDER.map((p) => fetchProvider(p)),
      );

      const errors: CloudStatusData['errors'] = [];
      const providers = { ...(cache?.data.providers ?? emptyProviders()) };

      for (let i = 0; i < CLOUD_STATUS_PROVIDER_ORDER.length; i++) {
        const provider = CLOUD_STATUS_PROVIDER_ORDER[i]!;
        const result = results[i]!;

        if (result.status === 'fulfilled') {
          providers[provider] = result.value;
        } else {
          errors.push({ provider, message: truncateError(result.reason) });
          loggers.cloudStatus.warn(`${CLOUD_STATUS_PROVIDERS[provider].label} status feed failed`, {
            error: truncateError(result.reason),
            category: ErrorCategory.NETWORK,
          });
        }
      }

      const data: CloudStatusData = { providers, lastUpdated: Date.now(), errors };
      cache = { data, fetchedAt: Date.now() };
      return data;
    } catch (err) {
      loggers.cloudStatus.error('Failed to fetch cloud status', {
        error: truncateError(err),
        category: ErrorCategory.NETWORK,
      });
      return cachedOrEmpty();
    }
  });
}
