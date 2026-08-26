import { CLOUD_STATUS_PROVIDERS, EXTENSION_CLOUD_STATUS_PROVIDER_ORDER } from './ipc';
import type {
  CloudStatusData,
  CloudStatusItem,
  CloudStatusPartition,
  CloudStatusProvider,
  ExtensionCloudStatusData,
  LegacyCloudStatusData,
  MistCloudStatusData,
} from './ipc';

export function appendCloudStatusItem<P extends CloudStatusProvider, Q extends P>(
  providers: CloudStatusPartition<P>['providers'],
  item: CloudStatusItem<Q>,
): void {
  const bucket = providers[item.provider] as CloudStatusItem<Q>[];
  bucket.push(item);
}

export function setCloudStatusProviderItems<P extends CloudStatusProvider, Q extends P>(
  providers: CloudStatusPartition<P>['providers'],
  provider: Q,
  items: CloudStatusItem<Q>[],
): void {
  const writable = providers as unknown as Record<Q, CloudStatusItem<Q>[]>;
  writable[provider] = items;
}

function matchingProviderItems<P extends CloudStatusProvider>(
  data: CloudStatusData,
  provider: P,
): CloudStatusItem<P>[] {
  const items = data.providers[provider];
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is CloudStatusItem<P> => item.provider === provider);
}

export function emptyLegacyCloudStatusProviders(): LegacyCloudStatusData['providers'] {
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

export function emptyMistCloudStatusProviders(): MistCloudStatusData['providers'] {
  return {
    mist_global: [],
    mist_emea: [],
    mist_apac: [],
    mist_federal: [],
  };
}

export function emptyExtensionCloudStatusProviders(): ExtensionCloudStatusData['providers'] {
  return { dynatrace: [], proofpoint: [], crowdstrike: [], dropbox: [], equinix: [] };
}

function emptyExtensionCloudStatusData(): ExtensionCloudStatusData {
  return {
    providers: emptyExtensionCloudStatusProviders(),
    errors: [],
    lastUpdated: 0,
  };
}

export function emptyCloudStatusProviders(): CloudStatusData['providers'] {
  return {
    aws: [],
    azure: [],
    m365: [],
    dropbox: [],
    proofpoint: [],
    crowdstrike: [],
    jira: [],
    github: [],
    cloudflare: [],
    equinix: [],
    mist_global: [],
    mist_emea: [],
    mist_apac: [],
    mist_federal: [],
    dynatrace: [],
    google: [],
    anthropic: [],
    openai: [],
    salesforce: [],
  };
}

export function splitCloudStatusData(data: CloudStatusData): {
  legacy: LegacyCloudStatusData;
  mist: MistCloudStatusData;
  extension: ExtensionCloudStatusData;
} {
  const legacyErrors: LegacyCloudStatusData['errors'] = [];
  const mistErrors: MistCloudStatusData['errors'] = [];
  const extensionErrors: ExtensionCloudStatusData['errors'] = [];

  for (const error of data.errors) {
    switch (error.provider) {
      case 'mist_global':
      case 'mist_emea':
      case 'mist_apac':
      case 'mist_federal':
        mistErrors.push({ provider: error.provider, message: error.message });
        break;
      case 'dynatrace':
      case 'proofpoint':
      case 'crowdstrike':
      case 'dropbox':
      case 'equinix':
        extensionErrors.push({ provider: error.provider, message: error.message });
        break;
      case 'aws':
      case 'azure':
      case 'm365':
      case 'jira':
      case 'github':
      case 'cloudflare':
      case 'google':
      case 'anthropic':
      case 'openai':
      case 'salesforce':
        legacyErrors.push({ provider: error.provider, message: error.message });
        break;
    }
  }

  return {
    legacy: {
      providers: {
        aws: matchingProviderItems(data, 'aws'),
        azure: matchingProviderItems(data, 'azure'),
        m365: matchingProviderItems(data, 'm365'),
        jira: matchingProviderItems(data, 'jira'),
        github: matchingProviderItems(data, 'github'),
        cloudflare: matchingProviderItems(data, 'cloudflare'),
        google: matchingProviderItems(data, 'google'),
        anthropic: matchingProviderItems(data, 'anthropic'),
        openai: matchingProviderItems(data, 'openai'),
        salesforce: matchingProviderItems(data, 'salesforce'),
      },
      errors: legacyErrors,
      lastUpdated: data.lastUpdated,
    },
    mist: {
      providers: {
        mist_global: matchingProviderItems(data, 'mist_global'),
        mist_emea: matchingProviderItems(data, 'mist_emea'),
        mist_apac: matchingProviderItems(data, 'mist_apac'),
        mist_federal: matchingProviderItems(data, 'mist_federal'),
      },
      errors: mistErrors,
      lastUpdated: data.lastUpdated,
    },
    extension: {
      providers: {
        dynatrace: matchingProviderItems(data, 'dynatrace'),
        proofpoint: matchingProviderItems(data, 'proofpoint'),
        crowdstrike: matchingProviderItems(data, 'crowdstrike'),
        dropbox: matchingProviderItems(data, 'dropbox'),
        equinix: matchingProviderItems(data, 'equinix'),
      },
      errors: extensionErrors,
      lastUpdated: data.lastUpdated,
    },
  };
}

export function mergeCloudStatusData(
  legacy: LegacyCloudStatusData,
  mist: MistCloudStatusData,
  extension: ExtensionCloudStatusData = emptyExtensionCloudStatusData(),
): CloudStatusData {
  const normalizedExtension = normalizeExtensionCloudStatusData(extension);
  return {
    providers: {
      aws: legacy.providers.aws,
      azure: legacy.providers.azure,
      m365: legacy.providers.m365,
      dropbox: normalizedExtension.providers.dropbox,
      proofpoint: normalizedExtension.providers.proofpoint,
      crowdstrike: normalizedExtension.providers.crowdstrike,
      jira: legacy.providers.jira,
      github: legacy.providers.github,
      cloudflare: legacy.providers.cloudflare,
      equinix: normalizedExtension.providers.equinix,
      mist_global: mist.providers.mist_global,
      mist_emea: mist.providers.mist_emea,
      mist_apac: mist.providers.mist_apac,
      mist_federal: mist.providers.mist_federal,
      dynatrace: normalizedExtension.providers.dynatrace,
      google: legacy.providers.google,
      anthropic: legacy.providers.anthropic,
      openai: legacy.providers.openai,
      salesforce: legacy.providers.salesforce,
    },
    errors: [...legacy.errors, ...mist.errors, ...normalizedExtension.errors],
    lastUpdated: Math.max(legacy.lastUpdated, mist.lastUpdated, extension.lastUpdated),
  };
}

export function normalizeExtensionCloudStatusData(
  data: ExtensionCloudStatusData,
): ExtensionCloudStatusData {
  const source = data.providers as Partial<ExtensionCloudStatusData['providers']>;
  const providers = emptyExtensionCloudStatusProviders();
  const errors = Array.isArray(data.errors) ? [...data.errors] : [];
  for (const provider of EXTENSION_CLOUD_STATUS_PROVIDER_ORDER) {
    const items = source[provider];
    if (Array.isArray(items)) {
      setCloudStatusProviderItems(
        providers,
        provider,
        items.filter(
          (item): item is CloudStatusItem<typeof provider> => item.provider === provider,
        ),
      );
      continue;
    }
    if (!errors.some((error) => error.provider === provider)) {
      errors.push({
        provider,
        message: `${CLOUD_STATUS_PROVIDERS[provider].label} status is unavailable from this Relay server.`,
      });
    }
  }
  return { providers, errors, lastUpdated: data.lastUpdated };
}

export function unavailableMistCloudStatusData(lastUpdated = Date.now()): MistCloudStatusData {
  const message = 'Juniper Mist status is unavailable from this Relay server.';
  return {
    providers: emptyMistCloudStatusProviders(),
    errors: [
      { provider: 'mist_global', message },
      { provider: 'mist_emea', message },
      { provider: 'mist_apac', message },
      { provider: 'mist_federal', message },
    ],
    lastUpdated,
  };
}

export function unavailableExtensionCloudStatusData(
  lastUpdated = Date.now(),
): ExtensionCloudStatusData {
  return {
    providers: emptyExtensionCloudStatusProviders(),
    errors: EXTENSION_CLOUD_STATUS_PROVIDER_ORDER.map((provider) => ({
      provider,
      message: `${CLOUD_STATUS_PROVIDERS[provider].label} status is unavailable from this Relay server.`,
    })),
    lastUpdated,
  };
}
