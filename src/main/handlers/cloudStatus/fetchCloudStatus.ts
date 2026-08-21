import {
  CLOUD_STATUS_PROVIDERS,
  EXTENSION_CLOUD_STATUS_PROVIDER_ORDER,
  LEGACY_CLOUD_STATUS_PROVIDER_ORDER,
  MIST_CLOUD_STATUS_PROVIDER_ORDER,
  type CloudStatusData,
  type CloudStatusItem,
  type ExtensionCloudStatusProvider,
  type LegacyCloudStatusProvider,
} from '@shared/ipc';
import { emptyCloudStatusProviders, setCloudStatusProviderItems } from '@shared/cloudStatus';
import { ErrorCategory } from '@shared/logging';
import { loggers } from '../../logger';
import { truncateError } from '../ipcHelpers';
import { fetchGoogleCloudProvider } from './googleProvider';
import { fetchMistProviderGroup } from './mistProvider';
import { fetchDynatraceStatusProvider } from './dynatraceStatusProvider';
import { RSS_FEEDS, fetchRssProvider } from './rssProvider';
import { fetchSalesforceProvider } from './salesforceProvider';
import { STATUSPAGE_FEEDS, fetchStatuspageProvider } from './statuspageProvider';

export { emptyCloudStatusProviders } from '@shared/cloudStatus';

function fetchLegacyProvider(provider: LegacyCloudStatusProvider): Promise<CloudStatusItem[]> {
  const rssUrl = RSS_FEEDS[provider];
  if (rssUrl) return fetchRssProvider(rssUrl, provider);

  const statuspageUrl = STATUSPAGE_FEEDS[provider];
  if (statuspageUrl) return fetchStatuspageProvider(statuspageUrl, provider);

  if (provider === 'google') return fetchGoogleCloudProvider();
  if (provider === 'salesforce') return fetchSalesforceProvider();
  return Promise.resolve([]);
}

function fetchExtensionProvider(
  provider: ExtensionCloudStatusProvider,
): Promise<CloudStatusItem[]> {
  switch (provider) {
    case 'dynatrace':
      return fetchDynatraceStatusProvider();
    case 'proofpoint':
      return import('./proofpointProvider').then(({ fetchProofpointProvider }) =>
        fetchProofpointProvider(),
      );
    case 'crowdstrike':
      return import('./crowdstrikeProvider').then(({ fetchCrowdStrikeProvider }) =>
        fetchCrowdStrikeProvider(),
      );
    case 'dropbox': {
      const statuspageUrl = STATUSPAGE_FEEDS.dropbox;
      if (!statuspageUrl) return Promise.reject(new Error('Dropbox status feed is not configured'));
      return fetchStatuspageProvider(statuspageUrl, provider);
    }
  }
}

export async function fetchCloudStatusData(
  previous?: CloudStatusData | null,
): Promise<CloudStatusData> {
  const [legacyResults, mistResult, extensionResults] = await Promise.all([
    Promise.allSettled(
      LEGACY_CLOUD_STATUS_PROVIDER_ORDER.map((provider) => fetchLegacyProvider(provider)),
    ),
    fetchMistProviderGroup().then(
      (value) => ({ status: 'fulfilled', value }) as const,
      (reason: unknown) => ({ status: 'rejected', reason }) as const,
    ),
    Promise.allSettled(
      EXTENSION_CLOUD_STATUS_PROVIDER_ORDER.map((provider) => fetchExtensionProvider(provider)),
    ),
  ]);
  const providers = { ...(previous?.providers ?? emptyCloudStatusProviders()) };
  const errors: CloudStatusData['errors'] = [];

  for (let index = 0; index < LEGACY_CLOUD_STATUS_PROVIDER_ORDER.length; index += 1) {
    const provider = LEGACY_CLOUD_STATUS_PROVIDER_ORDER[index]!;
    const result = legacyResults[index]!;
    if (result.status === 'fulfilled') {
      setCloudStatusProviderItems(providers, provider, result.value);
      continue;
    }
    const message = truncateError(result.reason);
    errors.push({ provider, message });
    loggers.cloudStatus.warn(`${CLOUD_STATUS_PROVIDERS[provider].label} status feed failed`, {
      error: message,
      category: ErrorCategory.NETWORK,
    });
  }

  if (mistResult.status === 'fulfilled') {
    for (const provider of MIST_CLOUD_STATUS_PROVIDER_ORDER) {
      setCloudStatusProviderItems(providers, provider, mistResult.value.providers[provider]);
    }
    errors.push(...mistResult.value.errors);
  } else {
    const message = truncateError(mistResult.reason);
    for (const provider of MIST_CLOUD_STATUS_PROVIDER_ORDER) {
      errors.push({ provider, message });
    }
    loggers.cloudStatus.warn('Juniper Mist status feed failed', {
      error: message,
      category: ErrorCategory.NETWORK,
    });
  }

  for (let index = 0; index < EXTENSION_CLOUD_STATUS_PROVIDER_ORDER.length; index += 1) {
    const provider = EXTENSION_CLOUD_STATUS_PROVIDER_ORDER[index]!;
    const result = extensionResults[index]!;
    if (result.status === 'fulfilled') {
      setCloudStatusProviderItems(providers, provider, result.value);
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
