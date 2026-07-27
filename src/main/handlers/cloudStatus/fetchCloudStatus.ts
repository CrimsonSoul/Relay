import {
  CLOUD_STATUS_PROVIDER_ORDER,
  CLOUD_STATUS_PROVIDERS,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusProvider,
} from '@shared/ipc';
import { ErrorCategory } from '@shared/logging';
import { loggers } from '../../logger';
import { truncateError } from '../ipcHelpers';
import { fetchGoogleCloudProvider } from './googleProvider';
import { RSS_FEEDS, fetchRssProvider } from './rssProvider';
import { fetchSalesforceProvider } from './salesforceProvider';
import { STATUSPAGE_FEEDS, fetchStatuspageProvider } from './statuspageProvider';

// Spelled out rather than derived from CLOUD_STATUS_PROVIDER_ORDER so the compiler
// checks exhaustiveness: adding a provider to CloudStatusProvider breaks this build
// instead of silently producing a record with a missing bucket.
export function emptyCloudStatusProviders(): CloudStatusData['providers'] {
  return {
    aws: [],
    azure: [],
    m365: [],
    jira: [],
    github: [],
    cloudflare: [],
    google: [],
    anthropic: [],
    openai: [],
    salesforce: [],
  };
}

function fetchProvider(provider: CloudStatusProvider): Promise<CloudStatusItem[]> {
  const rssUrl = RSS_FEEDS[provider];
  if (rssUrl) return fetchRssProvider(rssUrl, provider);

  const statuspageUrl = STATUSPAGE_FEEDS[provider];
  if (statuspageUrl) return fetchStatuspageProvider(statuspageUrl, provider);

  if (provider === 'google') return fetchGoogleCloudProvider();
  if (provider === 'salesforce') return fetchSalesforceProvider();
  return Promise.resolve([]);
}

export async function fetchCloudStatusData(
  previous?: CloudStatusData | null,
): Promise<CloudStatusData> {
  const results = await Promise.allSettled(
    CLOUD_STATUS_PROVIDER_ORDER.map((provider) => fetchProvider(provider)),
  );
  const providers = { ...(previous?.providers ?? emptyCloudStatusProviders()) };
  const errors: CloudStatusData['errors'] = [];

  for (let index = 0; index < CLOUD_STATUS_PROVIDER_ORDER.length; index += 1) {
    const provider = CLOUD_STATUS_PROVIDER_ORDER[index]!;
    const result = results[index]!;
    if (result.status === 'fulfilled') {
      providers[provider] = result.value;
      continue;
    }
    const message = truncateError(result.reason);
    errors.push({ provider, message });
    loggers.cloudStatus.warn(`${CLOUD_STATUS_PROVIDERS[provider].label} status feed failed`, {
      error: message,
      category: ErrorCategory.NETWORK,
    });
  }

  return { providers, errors, lastUpdated: Date.now() };
}
