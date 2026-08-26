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
  crowdstrike: vi.fn(),
  proofpoint: vi.fn(),
  salesforce: vi.fn(),
  mist: vi.fn(),
  dynatrace: vi.fn(),
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
    dropbox: 'status:dropbox',
    equinix: 'status:equinix',
    jira: 'status:jira',
    github: 'status:github',
    cloudflare: 'status:cloudflare',
    anthropic: 'status:anthropic',
    openai: 'status:openai',
  },
  fetchStatuspageProvider: providerMocks.statuspage,
}));

vi.mock('./googleProvider', () => ({ fetchGoogleCloudProvider: providerMocks.google }));
vi.mock('./crowdstrikeProvider', () => ({ fetchCrowdStrikeProvider: providerMocks.crowdstrike }));
vi.mock('./proofpointProvider', () => ({ fetchProofpointProvider: providerMocks.proofpoint }));
vi.mock('./salesforceProvider', () => ({ fetchSalesforceProvider: providerMocks.salesforce }));
vi.mock('./mistProvider', () => ({ fetchMistProviderGroup: providerMocks.mist }));
vi.mock('./dynatraceStatusProvider', () => ({
  fetchDynatraceStatusProvider: providerMocks.dynatrace,
}));

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
  providerMocks.crowdstrike.mockResolvedValue([]);
  providerMocks.proofpoint.mockResolvedValue([]);
  providerMocks.salesforce.mockResolvedValue([]);
  providerMocks.mist.mockResolvedValue({
    providers: emptyMistCloudStatusProviders(),
    errors: [],
  });
  providerMocks.dynatrace.mockResolvedValue([]);
});

describe('fetchCloudStatusData', () => {
  it('fetches the third-party CrowdStrike signal into its extension bucket', async () => {
    const crowdstrike = item('crowdstrike', 'crowdstrike-statusgator-down');
    providerMocks.crowdstrike.mockResolvedValue([crowdstrike]);

    const result = await fetchCloudStatusData();

    expect(providerMocks.crowdstrike).toHaveBeenCalledOnce();
    expect(result.providers.crowdstrike).toEqual([crowdstrike]);
    expect(result.errors).toEqual([]);
  });

  it('retains the last CrowdStrike signal when StatusGator is unavailable', async () => {
    const previous = item('crowdstrike', 'previous-crowdstrike');
    providerMocks.crowdstrike.mockRejectedValue(new Error('StatusGator unavailable'));

    const result = await fetchCloudStatusData(previousStatus([previous]));

    expect(result.providers.crowdstrike).toEqual([previous]);
    expect(result.errors).toContainEqual({
      provider: 'crowdstrike',
      message: 'StatusGator unavailable',
    });
  });

  it('fetches Dropbox status into its extension bucket', async () => {
    const dropbox = item('dropbox', 'dropbox-incident-1');
    providerMocks.statuspage.mockImplementation(
      async (_url: string, provider: CloudStatusProvider) =>
        provider === 'dropbox' ? [dropbox] : [],
    );

    const result = await fetchCloudStatusData();

    expect(result.providers.dropbox).toEqual([dropbox]);
    expect(result.errors).toEqual([]);
  });

  it('retains the last Dropbox status when its official feed is unavailable', async () => {
    const previous = item('dropbox', 'previous-dropbox');
    providerMocks.statuspage.mockImplementation(
      async (_url: string, provider: CloudStatusProvider) => {
        if (provider === 'dropbox') throw new Error('Dropbox unavailable');
        return [];
      },
    );

    const result = await fetchCloudStatusData(previousStatus([previous]));

    expect(result.providers.dropbox).toEqual([previous]);
    expect(result.errors).toContainEqual({
      provider: 'dropbox',
      message: 'Dropbox unavailable',
    });
  });

  it('fetches Equinix status into its extension bucket', async () => {
    const equinix = item('equinix', 'equinix-incident-1');
    providerMocks.statuspage.mockImplementation(
      async (_url: string, provider: CloudStatusProvider) =>
        provider === 'equinix' ? [equinix] : [],
    );

    const result = await fetchCloudStatusData();

    expect(providerMocks.statuspage).toHaveBeenCalledWith('status:equinix', 'equinix');
    expect(result.providers.equinix).toEqual([equinix]);
    expect(result.errors).toEqual([]);
  });

  it('retains the last Equinix status when its official feed is unavailable', async () => {
    const previous = item('equinix', 'previous-equinix');
    providerMocks.statuspage.mockImplementation(
      async (_url: string, provider: CloudStatusProvider) => {
        if (provider === 'equinix') throw new Error('Equinix unavailable');
        return [];
      },
    );

    const result = await fetchCloudStatusData(previousStatus([previous]));

    expect(result.providers.equinix).toEqual([previous]);
    expect(result.errors).toContainEqual({
      provider: 'equinix',
      message: 'Equinix unavailable',
    });
  });

  it('fetches Proofpoint current incidents into its dedicated provider bucket', async () => {
    const proofpoint = item('proofpoint', 'proofpoint-1');
    providerMocks.proofpoint.mockResolvedValue([proofpoint]);

    const result = await fetchCloudStatusData();

    expect(providerMocks.proofpoint).toHaveBeenCalledOnce();
    expect(result.providers.proofpoint).toEqual([proofpoint]);
    expect(result.errors).toEqual([]);
  });

  it('retains the last confirmed Proofpoint outage when its feed fails', async () => {
    const previous = item('proofpoint', 'previous-proofpoint');
    providerMocks.proofpoint.mockRejectedValue(new Error('Proofpoint unavailable'));

    const result = await fetchCloudStatusData(previousStatus([previous]));

    expect(result.providers.proofpoint).toEqual([previous]);
    expect(result.errors).toContainEqual({
      provider: 'proofpoint',
      message: 'Proofpoint unavailable',
    });
  });

  it('merges the Dynatrace public-status result into the extension bucket', async () => {
    const dynatrace = item('dynatrace', 'dynatrace-1');
    providerMocks.dynatrace.mockResolvedValue([dynatrace]);

    const result = await fetchCloudStatusData();

    expect(result.providers.dynatrace).toEqual([dynatrace]);
    expect(result.errors).toEqual([]);
  });

  it('retains the last-good Dynatrace result when its feed fails', async () => {
    const previous = item('dynatrace', 'previous-dynatrace');
    providerMocks.dynatrace.mockRejectedValue(new Error('Status.io unavailable'));

    const result = await fetchCloudStatusData(previousStatus([previous]));

    expect(result.providers.dynatrace).toEqual([previous]);
    expect(result.errors).toContainEqual({
      provider: 'dynatrace',
      message: 'Status.io unavailable',
    });
  });

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
