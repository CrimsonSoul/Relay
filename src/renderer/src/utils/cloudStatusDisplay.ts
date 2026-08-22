import {
  CLOUD_STATUS_PROVIDERS,
  MIST_CLOUD_STATUS_PROVIDER_ORDER,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusSeverity,
  type CloudStatusProvider,
  type MistCloudStatusProvider,
} from '@shared/ipc';

export const DISPLAY_CLOUD_STATUS_PROVIDER_ORDER = [
  'aws',
  'azure',
  'm365',
  'dropbox',
  'proofpoint',
  'crowdstrike',
  'jira',
  'github',
  'cloudflare',
  'mist',
  'dynatrace',
  'google',
  'anthropic',
  'openai',
  'salesforce',
] as const;

export type DisplayCloudStatusProvider = (typeof DISPLAY_CLOUD_STATUS_PROVIDER_ORDER)[number];

export const DISPLAY_CLOUD_STATUS_PROVIDERS: Record<
  DisplayCloudStatusProvider,
  {
    label: string;
    statusUrl: string;
    statusSourceLabel?: string;
    officialSupportUrl?: string;
    twitterHandle?: string;
    downdetectorSlug?: string;
  }
> = {
  aws: CLOUD_STATUS_PROVIDERS.aws,
  azure: CLOUD_STATUS_PROVIDERS.azure,
  m365: CLOUD_STATUS_PROVIDERS.m365,
  dropbox: CLOUD_STATUS_PROVIDERS.dropbox,
  proofpoint: CLOUD_STATUS_PROVIDERS.proofpoint,
  crowdstrike: CLOUD_STATUS_PROVIDERS.crowdstrike,
  jira: CLOUD_STATUS_PROVIDERS.jira,
  github: CLOUD_STATUS_PROVIDERS.github,
  cloudflare: CLOUD_STATUS_PROVIDERS.cloudflare,
  mist: { label: 'Juniper Mist', statusUrl: 'https://status.mist.com/' },
  dynatrace: CLOUD_STATUS_PROVIDERS.dynatrace,
  google: CLOUD_STATUS_PROVIDERS.google,
  anthropic: CLOUD_STATUS_PROVIDERS.anthropic,
  openai: CLOUD_STATUS_PROVIDERS.openai,
  salesforce: CLOUD_STATUS_PROVIDERS.salesforce,
};

export type DisplayCloudStatusItem = Omit<CloudStatusItem, 'provider' | 'affectedScopes'> & {
  provider: DisplayCloudStatusProvider;
  affectedScopes: string[];
};

export type DisplayCloudStatusData = {
  providers: Record<DisplayCloudStatusProvider, DisplayCloudStatusItem[]>;
  errors: { provider: DisplayCloudStatusProvider; message: string }[];
  lastUpdated: number;
};

const DIRECT_DISPLAY_PROVIDERS = [
  'aws',
  'azure',
  'm365',
  'dropbox',
  'proofpoint',
  'crowdstrike',
  'jira',
  'github',
  'cloudflare',
  'dynatrace',
  'google',
  'anthropic',
  'openai',
  'salesforce',
] as const;

function emptyDisplayProviders(): DisplayCloudStatusData['providers'] {
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
    mist: [],
    dynatrace: [],
    google: [],
    anthropic: [],
    openai: [],
    salesforce: [],
  };
}

export const MIST_SCOPE_LABELS: Record<MistCloudStatusProvider, string> = {
  mist_global: 'Global',
  mist_emea: 'EMEA',
  mist_apac: 'APAC',
  mist_federal: 'Federal',
};

export const DISPLAY_MIST_REGION_OPTIONS = MIST_CLOUD_STATUS_PROVIDER_ORDER.map((provider) => ({
  provider,
  label: MIST_SCOPE_LABELS[provider],
}));

const SEVERITY_RANK: Record<CloudStatusSeverity, number> = {
  resolved: 0,
  info: 1,
  warning: 2,
  error: 3,
};

function newestItem(left: CloudStatusItem, right: CloudStatusItem): CloudStatusItem {
  return Date.parse(right.pubDate) > Date.parse(left.pubDate) ? right : left;
}

function worstSeverity(left: CloudStatusSeverity, right: CloudStatusSeverity): CloudStatusSeverity {
  return SEVERITY_RANK[right] > SEVERITY_RANK[left] ? right : left;
}

function aggregateMistItems(data: CloudStatusData): DisplayCloudStatusItem[] {
  const incidents = new Map<
    string,
    { source: CloudStatusItem; severity: CloudStatusSeverity; scopes: Set<string> }
  >();
  for (const provider of MIST_CLOUD_STATUS_PROVIDER_ORDER) {
    for (const item of data.providers[provider]) {
      const existing = incidents.get(item.id);
      if (!existing) {
        incidents.set(item.id, {
          source: item,
          severity: item.severity,
          scopes: new Set([MIST_SCOPE_LABELS[provider], ...(item.affectedScopes ?? [])]),
        });
        continue;
      }
      existing.source = newestItem(existing.source, item);
      existing.severity = worstSeverity(existing.severity, item.severity);
      existing.scopes.add(MIST_SCOPE_LABELS[provider]);
      for (const scope of item.affectedScopes ?? []) existing.scopes.add(scope);
    }
  }
  return [...incidents.values()].map(({ source, severity, scopes }) => ({
    id: source.id,
    provider: 'mist',
    title: source.title,
    description: source.description,
    pubDate: source.pubDate,
    link: source.link,
    severity,
    affectedScopes: [...scopes],
  }));
}

function directDisplayItem(item: CloudStatusItem): DisplayCloudStatusItem {
  return {
    id: item.id,
    provider: item.provider as DisplayCloudStatusProvider,
    title: item.title,
    description: item.description,
    pubDate: item.pubDate,
    link: item.link,
    severity: item.severity,
    affectedScopes: [...(item.affectedScopes ?? [])],
  };
}

function displayProviderForError(provider: CloudStatusProvider): DisplayCloudStatusProvider {
  return provider.startsWith('mist_') ? 'mist' : (provider as DisplayCloudStatusProvider);
}

function aggregateErrors(data: CloudStatusData): DisplayCloudStatusData['errors'] {
  const errors: DisplayCloudStatusData['errors'] = [];
  const seen = new Set<DisplayCloudStatusProvider>();
  for (const error of data.errors) {
    const provider = displayProviderForError(error.provider);
    if (seen.has(provider)) continue;
    seen.add(provider);
    errors.push({ provider, message: error.message });
  }
  return errors;
}

export function aggregateCloudStatusForDisplay(data: CloudStatusData): DisplayCloudStatusData {
  const providers = emptyDisplayProviders();
  for (const provider of DIRECT_DISPLAY_PROVIDERS) {
    providers[provider] = data.providers[provider].map(directDisplayItem);
  }
  providers.mist = aggregateMistItems(data);
  return { providers, errors: aggregateErrors(data), lastUpdated: data.lastUpdated };
}
