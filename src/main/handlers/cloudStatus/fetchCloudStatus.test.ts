import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendCloudStatusItem,
  emptyCloudStatusProviders,
  emptyMistCloudStatusProviders,
} from '@shared/cloudStatus';
import type { CloudStatusData, CloudStatusItem, CloudStatusProvider } from '@shared/ipc';

const providerMocks = vi.hoisted(() => ({
  rss: vi.fn(),
  statuspage: vi.fn(),
  google: vi.fn(),
  salesforce: vi.fn(),
  mist: vi.fn(),
}));

vi.mock('../../logger', () => ({
  loggers: { cloudStatus: { warn: vi.fn() } },
}));

vi.mock('./rssProvider', () => ({
  RSS_FEEDS: { aws: 'rss:aws', azure: 'rss:azure', m365: 'rss:m365' },
  fetchRssProvider: providerMocks.rss,
}));

vi.mock('./statuspageProvider', () => ({
  STATUSPAGE_FEEDS: {
    jira: 'status:jira',
    github: 'status:github',
    cloudflare: 'status:cloudflare',
    anthropic: 'status:anthropic',
    openai: 'status:openai',
  },
  fetchStatuspageProvider: providerMocks.statuspage,
}));

vi.mock('./googleProvider', () => ({ fetchGoogleCloudProvider: providerMocks.google }));
vi.mock('./salesforceProvider', () => ({ fetchSalesforceProvider: providerMocks.salesforce }));
vi.mock('./mistProvider', () => ({ fetchMistProviderGroup: providerMocks.mist }));

import { fetchCloudStatusData } from './fetchCloudStatus';

function item<P extends CloudStatusProvider>(provider: P, id: string): CloudStatusItem<P> {
  return {
    id,
    provider,
    title: `${provider} incident`,
    description: 'Incident details',
    pubDate: '2026-08-03T10:00:00.000Z',
    link: 'https://example.com/status',
    severity: 'error',
  };
}

function previousStatus(items: CloudStatusItem[]): CloudStatusData {
  const providers = emptyCloudStatusProviders();
  for (const current of items) appendCloudStatusItem(providers, current);
  return { providers, errors: [], lastUpdated: 100 };
}

beforeEach(() => {
  vi.clearAllMocks();
  providerMocks.rss.mockResolvedValue([]);
  providerMocks.statuspage.mockResolvedValue([]);
  providerMocks.google.mockResolvedValue([]);
  providerMocks.salesforce.mockResolvedValue([]);
  providerMocks.mist.mockResolvedValue({
    providers: emptyMistCloudStatusProviders(),
    errors: [],
  });
});

describe('fetchCloudStatusData', () => {
  it('fetches one Mist group and merges its four regional buckets', async () => {
    const mistProviders = emptyMistCloudStatusProviders();
    mistProviders.mist_emea.push(item('mist_emea', 'mist-1'));
    providerMocks.mist.mockResolvedValue({ providers: mistProviders, errors: [] });

    const result = await fetchCloudStatusData();

    expect(providerMocks.mist).toHaveBeenCalledTimes(1);
    expect(result.providers.mist_emea).toEqual([
      expect.objectContaining({ id: 'mist-1', provider: 'mist_emea' }),
    ]);
    expect(result.providers.mist_global).toEqual([]);
  });

  it('retains every previous Mist bucket and reports coverage errors when the group fails', async () => {
    const previousGlobal = item('mist_global', 'previous-global');
    const previousFederal = item('mist_federal', 'previous-federal');
    const newAws = item('aws', 'new-aws');
    providerMocks.rss.mockImplementation(async (_url: string, provider: string) =>
      provider === 'aws' ? [newAws] : [],
    );
    providerMocks.mist.mockRejectedValue(new Error('Mist unavailable'));

    const result = await fetchCloudStatusData(
      previousStatus([previousGlobal, previousFederal, item('aws', 'old-aws')]),
    );

    expect(result.providers.aws).toEqual([newAws]);
    expect(result.providers.mist_global).toEqual([previousGlobal]);
    expect(result.providers.mist_federal).toEqual([previousFederal]);
    expect(result.errors.map(({ provider }) => provider)).toEqual([
      'mist_global',
      'mist_emea',
      'mist_apac',
      'mist_federal',
    ]);
  });

  it('retains only a failed legacy provider while applying successful Mist data', async () => {
    const previousAws = item('aws', 'previous-aws');
    const currentMist = item('mist_apac', 'current-mist');
    providerMocks.rss.mockImplementation(async (_url: string, provider: string) => {
      if (provider === 'aws') throw new Error('AWS unavailable');
      return [];
    });
    const mistProviders = emptyMistCloudStatusProviders();
    mistProviders.mist_apac.push(currentMist);
    providerMocks.mist.mockResolvedValue({ providers: mistProviders, errors: [] });

    const result = await fetchCloudStatusData(previousStatus([previousAws]));

    expect(result.providers.aws).toEqual([previousAws]);
    expect(result.providers.mist_apac).toEqual([currentMist]);
    expect(result.errors).toEqual([{ provider: 'aws', message: 'AWS unavailable' }]);
  });
});
