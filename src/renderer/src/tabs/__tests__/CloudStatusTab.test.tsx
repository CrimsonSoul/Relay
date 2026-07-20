import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import type { CloudStatusData, CloudStatusItem, CloudStatusProvider } from '@shared/ipc';

vi.mock('../../components/icons/ProviderIcons', () => ({
  ProviderIcon: ({ provider }: { provider: string }) => (
    <span data-testid={`provider-icon-${provider}`} />
  ),
}));

vi.mock('../../components/TabFallback', () => ({
  TabFallback: () => <div data-testid="tab-fallback">Loading...</div>,
}));

vi.mock('../../components/StatusBar', () => ({
  StatusBar: ({ right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="status-bar">{right}</div>
  ),
  StatusBarLive: () => <span data-testid="status-bar-live" />,
}));

import { CloudStatusTab } from '../CloudStatusTab';

const emptyProviders: Record<CloudStatusProvider, CloudStatusItem[]> = {
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

function makeStatusData(overrides: Partial<CloudStatusData> = {}): CloudStatusData {
  return {
    providers: { ...emptyProviders },
    lastUpdated: Date.now(),
    errors: [],
    ...overrides,
  };
}

function makeItem(overrides: Partial<CloudStatusItem> = {}): CloudStatusItem {
  return {
    id: overrides.id ?? 'item-1',
    provider: overrides.provider ?? 'aws',
    title: overrides.title ?? 'Provider incident',
    description: overrides.description ?? 'Incident details',
    pubDate: overrides.pubDate ?? '2026-07-20T15:00:00.000Z',
    link: overrides.link ?? '',
    severity: overrides.severity ?? 'error',
  };
}

describe('CloudStatusTab', () => {
  const openExternal = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.api = { openExternal } as never;
  });

  it('shows the loading fallback when no snapshot is available', () => {
    render(<CloudStatusTab statusData={null} loading={true} refetch={vi.fn()} />);
    expect(screen.getByTestId('tab-fallback')).toBeInTheDocument();
  });

  it('marks coverage unknown when loading ends without a status snapshot', () => {
    render(<CloudStatusTab statusData={null} loading={false} refetch={vi.fn()} />);

    expect(screen.getAllByText('Coverage unavailable').length).toBeGreaterThan(0);
    expect(screen.getByText('No status snapshot available')).toBeInTheDocument();
    expect(screen.getByText('Provider status data is unavailable.')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown')).toHaveLength(10);
    expect(screen.queryByText('No reported outages')).not.toBeInTheDocument();
    expect(screen.queryByText('No active vendor outages')).not.toBeInTheDocument();
  });

  it('uses precise all-clear copy and keeps compact provider coverage', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'External outages' })).toBeInTheDocument();
    expect(screen.getByText('No reported outages')).toBeInTheDocument();
    expect(screen.getByText('10 monitored providers')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open AWS status page - No outage' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('All services normal')).not.toBeInTheDocument();
  });

  it('does not claim full coverage when a provider feed is unavailable', () => {
    const data = makeStatusData({ errors: [{ provider: 'github', message: 'fetch failed' }] });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(screen.getByText('No reported outages from available feeds')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Some provider feeds are unavailable.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open GitHub status page - Unknown' }),
    ).toBeInTheDocument();
  });

  it('refreshes manually and disables refresh while loading', () => {
    const refetch = vi.fn();
    const { rerender } = render(
      <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={refetch} />,
    );

    fireEvent.click(screen.getByLabelText('Refresh cloud status'));
    expect(refetch).toHaveBeenCalledOnce();

    rerender(<CloudStatusTab statusData={makeStatusData()} loading={true} refetch={refetch} />);
    expect(screen.getByLabelText('Refresh cloud status')).toBeDisabled();
  });

  it('shows and counts only outage records', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [makeItem({ id: 'outage', title: 'EC2 outage', severity: 'error' })],
        azure: [
          makeItem({
            id: 'warning',
            provider: 'azure',
            title: 'Storage latency',
            severity: 'warning',
          }),
        ],
        m365: [
          makeItem({
            id: 'info',
            provider: 'm365',
            title: 'Admin notice',
            severity: 'info',
          }),
        ],
        github: [
          makeItem({
            id: 'resolved',
            provider: 'github',
            title: 'Recovered webhooks',
            severity: 'resolved',
          }),
        ],
      },
    });

    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(screen.getByText('EC2 outage')).toBeInTheDocument();
    expect(screen.getAllByText('Outage').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('1 active outage')).toBeInTheDocument();
    expect(screen.queryByText('Storage latency')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin notice')).not.toBeInTheDocument();
    expect(screen.queryByText('Recovered webhooks')).not.toBeInTheDocument();
  });

  it('shows multiple-outage counts with plural copy', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [makeItem({ id: 'aws-1' })],
        azure: [makeItem({ id: 'azure-1', provider: 'azure' })],
      },
    });

    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);
    expect(screen.getByText('2 active outages')).toBeInTheDocument();
  });

  it('orders outage providers before unknown and clear providers', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        azure: [makeItem({ provider: 'azure', severity: 'error' })],
      },
      errors: [{ provider: 'github', message: 'fetch failed' }],
    });
    const { container } = render(
      <CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />,
    );

    expect(
      Array.from(container.querySelectorAll('.cloud-status-provider__name'))
        .slice(0, 3)
        .map((node) => node.textContent),
    ).toEqual(['Azure', 'GitHub', 'AWS']);
  });

  it('shows outage details without expansion and opens the incident source', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [
          makeItem({
            title: 'EC2 outage',
            description: '<p>Investigating &amp; mitigating EC2</p>',
            link: 'https://health.aws.amazon.com/incident/1',
          }),
        ],
      },
    });

    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(screen.getByText('Investigating & mitigating EC2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View official status' }));
    expect(openExternal).toHaveBeenCalledWith('https://health.aws.amazon.com/incident/1');
  });

  it('keeps only official provider status actions', () => {
    const data = makeStatusData({
      providers: { ...emptyProviders, aws: [makeItem()] },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open AWS status page' }));
    expect(openExternal).toHaveBeenCalledWith('https://status.aws.amazon.com/');
    expect(screen.queryByText('@AWSCloud')).not.toBeInTheDocument();
    expect(screen.queryByText(/Downdetector/)).not.toBeInTheDocument();
  });

  it('removes historical feed controls and hidden severity labels', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Incident feed')).not.toBeInTheDocument();
    for (const label of ['DEGRADED', 'INFO', 'RESOLVED']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('shows the never-updated state without invalid time copy', () => {
    render(
      <CloudStatusTab
        statusData={makeStatusData({ lastUpdated: 0 })}
        loading={false}
        refetch={vi.fn()}
      />,
    );
    expect(screen.getByText('Updated Never')).toBeInTheDocument();
  });

  it('keeps provider and outage counts in the status bar', () => {
    const data = makeStatusData({
      providers: { ...emptyProviders, aws: [makeItem()] },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(screen.getByTestId('status-bar')).toHaveTextContent(
      '10 providers monitored · 1 active outage',
    );
  });
});
