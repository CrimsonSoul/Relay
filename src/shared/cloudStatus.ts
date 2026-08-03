import type { CloudStatusData, LegacyCloudStatusData, MistCloudStatusData } from './ipc';

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

export function emptyCloudStatusProviders(): CloudStatusData['providers'] {
  return {
    aws: [],
    azure: [],
    m365: [],
    jira: [],
    github: [],
    cloudflare: [],
    mist_global: [],
    mist_emea: [],
    mist_apac: [],
    mist_federal: [],
    google: [],
    anthropic: [],
    openai: [],
    salesforce: [],
  };
}

export function splitCloudStatusData(data: CloudStatusData): {
  legacy: LegacyCloudStatusData;
  mist: MistCloudStatusData;
} {
  const legacyErrors: LegacyCloudStatusData['errors'] = [];
  const mistErrors: MistCloudStatusData['errors'] = [];

  for (const error of data.errors) {
    switch (error.provider) {
      case 'mist_global':
      case 'mist_emea':
      case 'mist_apac':
      case 'mist_federal':
        mistErrors.push({ provider: error.provider, message: error.message });
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
        aws: data.providers.aws,
        azure: data.providers.azure,
        m365: data.providers.m365,
        jira: data.providers.jira,
        github: data.providers.github,
        cloudflare: data.providers.cloudflare,
        google: data.providers.google,
        anthropic: data.providers.anthropic,
        openai: data.providers.openai,
        salesforce: data.providers.salesforce,
      },
      errors: legacyErrors,
      lastUpdated: data.lastUpdated,
    },
    mist: {
      providers: {
        mist_global: data.providers.mist_global,
        mist_emea: data.providers.mist_emea,
        mist_apac: data.providers.mist_apac,
        mist_federal: data.providers.mist_federal,
      },
      errors: mistErrors,
      lastUpdated: data.lastUpdated,
    },
  };
}

export function mergeCloudStatusData(
  legacy: LegacyCloudStatusData,
  mist: MistCloudStatusData,
): CloudStatusData {
  return {
    providers: {
      aws: legacy.providers.aws,
      azure: legacy.providers.azure,
      m365: legacy.providers.m365,
      jira: legacy.providers.jira,
      github: legacy.providers.github,
      cloudflare: legacy.providers.cloudflare,
      mist_global: mist.providers.mist_global,
      mist_emea: mist.providers.mist_emea,
      mist_apac: mist.providers.mist_apac,
      mist_federal: mist.providers.mist_federal,
      google: legacy.providers.google,
      anthropic: legacy.providers.anthropic,
      openai: legacy.providers.openai,
      salesforce: legacy.providers.salesforce,
    },
    errors: [...legacy.errors, ...mist.errors],
    lastUpdated: Math.max(legacy.lastUpdated, mist.lastUpdated),
  };
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
