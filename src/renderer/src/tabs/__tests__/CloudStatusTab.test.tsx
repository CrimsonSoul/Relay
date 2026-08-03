import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import type { CloudStatusData, CloudStatusItem } from '@shared/ipc';
import { emptyCloudStatusProviders } from '@shared/cloudStatus';
import { CURRENT_CLOUD_OUTAGE_WINDOW_MS } from '../../utils/cloudStatus';

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

const emptyProviders = emptyCloudStatusProviders();

function makeStatusData(overrides: Partial<CloudStatusData> = {}): CloudStatusData {
  return {
    providers: emptyCloudStatusProviders(),
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
    vi.useFakeTimers();
    vi.setSystemTime('2026-07-20T18:00:00.000Z');
    vi.clearAllMocks();
    globalThis.api = { openExternal } as never;
  });

  afterEach(() => vi.useRealTimers());

  it('shows the loading fallback when no snapshot is available', () => {
    render(<CloudStatusTab statusData={null} loading={true} refetch={vi.fn()} />);
    expect(screen.getByTestId('tab-fallback')).toBeInTheDocument();
  });

  it('marks coverage unknown when loading ends without a status snapshot', () => {
    render(<CloudStatusTab statusData={null} loading={false} refetch={vi.fn()} />);

    expect(screen.getAllByText('Coverage unavailable').length).toBeGreaterThan(0);
    expect(screen.getByText('Provider status data is unavailable.')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown')).toHaveLength(14);
    expect(screen.getByRole('region', { name: 'Provider overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Active issues' })).not.toBeInTheDocument();
    expect(screen.queryByText('No reported issues')).not.toBeInTheDocument();
    expect(screen.queryByText('No active vendor issues')).not.toBeInTheDocument();
  });

  it('keeps a two-column provider overview without a global active-issues pane', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'External Status' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Provider overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Active issues' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /status details$/ })).toHaveLength(14);
    expect(
      screen.getByRole('button', { name: 'View AWS status details' }),
    ).toHaveAccessibleDescription('Operational No active issues');
    expect(screen.queryByText('All services normal')).not.toBeInTheDocument();
  });

  it('does not claim full coverage when a provider feed is unavailable', () => {
    const data = makeStatusData({ errors: [{ provider: 'github', message: 'fetch failed' }] });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Some provider feeds are unavailable.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View GitHub status details' }),
    ).toHaveAccessibleDescription('Unknown Coverage unavailable');
  });

  it('does not claim an unavailable provider has no active issues in the overview', () => {
    const data = makeStatusData({
      providers: { ...emptyProviders, aws: [makeItem()] },
      errors: [{ provider: 'github', message: 'fetch failed' }],
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    const githubButton = screen.getByRole('button', { name: 'View GitHub status details' });
    expect(githubButton).toHaveTextContent('Coverage unavailable');
    expect(githubButton).not.toHaveTextContent('No active issues');
    expect(githubButton).toHaveAccessibleDescription('Unknown Coverage unavailable');
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

  it('summarizes current outage and degraded records in the provider overview', () => {
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

    expect(screen.getByRole('region', { name: 'Provider overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Active issues' })).not.toBeInTheDocument();
    expect(screen.queryByText('EC2 outage')).not.toBeInTheDocument();
    expect(screen.queryByText('Storage latency')).not.toBeInTheDocument();
    expect(screen.getAllByText('Outage').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Degraded').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1 active outage · 1 degraded issue')).toBeInTheDocument();
    expect(screen.queryByText('Admin notice')).not.toBeInTheDocument();
    expect(screen.queryByText('Recovered webhooks')).not.toBeInTheDocument();
  });

  it('drills into one provider and returns to the overview', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [makeItem({ id: 'aws-outage', title: 'EC2 outage', severity: 'error' })],
        azure: [
          makeItem({
            id: 'azure-warning',
            provider: 'azure',
            title: 'Storage latency',
            severity: 'warning',
          }),
        ],
      },
    });

    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);
    expect(screen.queryByText('EC2 outage')).not.toBeInTheDocument();
    expect(screen.queryByText('Storage latency')).not.toBeInTheDocument();

    const awsButton = screen.getByRole('button', { name: 'View AWS status details' });
    expect(awsButton).toHaveAccessibleDescription('Outage 1 active issue');
    awsButton.focus();
    fireEvent.click(awsButton);

    expect(screen.getByRole('region', { name: 'AWS status details' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AWS' })).toBeInTheDocument();
    expect(screen.getByText('EC2 outage')).toBeInTheDocument();
    expect(screen.queryByText('Storage latency')).not.toBeInTheDocument();
    const allProvidersButton = screen.getByRole('button', { name: 'All providers' });
    expect(allProvidersButton).toHaveFocus();
    expect(allProvidersButton.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();

    fireEvent.click(allProvidersButton);

    expect(screen.getByRole('region', { name: 'Provider overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Active issues' })).not.toBeInTheDocument();
    expect(screen.queryByText('EC2 outage')).not.toBeInTheDocument();
    expect(screen.queryByText('Storage latency')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View AWS status details' })).toHaveFocus();
  });

  it('supports externally selecting a provider for notification navigation', () => {
    const onSelectedProviderChange = vi.fn();
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        azure: [
          makeItem({
            id: 'azure-warning',
            provider: 'azure',
            title: 'Storage latency',
            severity: 'warning',
          }),
        ],
      },
    });
    const { rerender } = render(
      <CloudStatusTab
        statusData={data}
        loading={false}
        refetch={vi.fn()}
        selectedProvider="azure"
        onSelectedProviderChange={onSelectedProviderChange}
      />,
    );

    expect(screen.getByRole('region', { name: 'Azure status details' })).toBeInTheDocument();
    expect(screen.getByText('Storage latency')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All providers' }));
    expect(onSelectedProviderChange).toHaveBeenCalledWith(null);

    rerender(
      <CloudStatusTab
        statusData={data}
        loading={false}
        refetch={vi.fn()}
        selectedProvider={null}
        onSelectedProviderChange={onSelectedProviderChange}
      />,
    );
    expect(screen.getByRole('region', { name: 'Provider overview' })).toBeInTheDocument();
  });

  it('can inspect a healthy provider without hiding it from the overview', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'View ChatGPT status details' }));

    expect(screen.getByRole('region', { name: 'ChatGPT status details' })).toBeInTheDocument();
    expect(screen.getByText('No active issues for ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('Operational')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All providers' }));

    expect(screen.getByRole('region', { name: 'Provider overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Active issues' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View ChatGPT status details' })).toHaveFocus();
  });

  it('summarizes a warning-only snapshot as degraded', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        azure: [
          makeItem({
            id: 'warning',
            provider: 'azure',
            title: 'Storage latency',
            severity: 'warning',
          }),
        ],
      },
    });

    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(screen.getAllByText('1 degraded issue').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('No reported issues')).not.toBeInTheDocument();
  });

  it('expires a degraded issue at the current-incident cutoff without a new snapshot', async () => {
    const now = Date.now();
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        azure: [
          makeItem({
            provider: 'azure',
            severity: 'warning',
            title: 'Expiring latency advisory',
            pubDate: new Date(now - CURRENT_CLOUD_OUTAGE_WINDOW_MS + 1_000).toISOString(),
          }),
        ],
      },
    });

    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'View Azure status details' }));
    expect(screen.getByText('Expiring latency advisory')).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(1_001));

    expect(screen.queryByText('Expiring latency advisory')).not.toBeInTheDocument();
    expect(screen.getByText('No active issues for Azure')).toBeInTheDocument();
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

  it('does not display or count stale error records as active outages', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [
          makeItem({
            id: 'stale',
            title: 'Old AWS outage',
            pubDate: '2026-04-30T07:25:54.000Z',
          }),
        ],
        github: [makeItem({ id: 'current', provider: 'github', title: 'Current GitHub outage' })],
      },
    });
    const { container } = render(
      <CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />,
    );

    expect(screen.queryByText('Old AWS outage')).not.toBeInTheDocument();
    expect(screen.queryByText('Current GitHub outage')).not.toBeInTheDocument();
    expect(screen.getByText('1 active outage')).toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll('.cloud-status-provider__name'))
        .slice(0, 2)
        .map((node) => node.textContent),
    ).toEqual(['GitHub', 'AWS']);

    fireEvent.click(screen.getByRole('button', { name: 'View GitHub status details' }));
    expect(screen.getByText('Current GitHub outage')).toBeInTheDocument();
    expect(screen.queryByText('Old AWS outage')).not.toBeInTheDocument();
  });

  it('orders outage providers before degraded, unknown, and operational providers', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        azure: [makeItem({ provider: 'azure', severity: 'error' })],
        cloudflare: [
          makeItem({ provider: 'cloudflare', severity: 'warning', title: 'Elevated latency' }),
        ],
      },
      errors: [{ provider: 'github', message: 'fetch failed' }],
    });
    const { container } = render(
      <CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />,
    );

    expect(
      Array.from(container.querySelectorAll('.cloud-status-provider__name'))
        .slice(0, 4)
        .map((node) => node.textContent),
    ).toEqual(['Azure', 'Cloudflare', 'GitHub', 'AWS']);
  });

  it('shows provider issue details and opens the incident source', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'View AWS status details' }));

    expect(screen.getByText('Investigating & mitigating EC2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View official status' }));
    expect(openExternal).toHaveBeenCalledWith('https://health.aws.amazon.com/incident/1');
  });

  it('opens provider Status, X, and Downdetector actions in the outage layout', () => {
    const data = makeStatusData({
      providers: { ...emptyProviders, aws: [makeItem()] },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'View AWS status details' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open AWS official status page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open AWS on X' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open AWS on Downdetector' }));

    expect(openExternal).toHaveBeenNthCalledWith(1, 'https://status.aws.amazon.com/');
    expect(openExternal).toHaveBeenNthCalledWith(2, 'https://x.com/AWSCloud');
    expect(openExternal).toHaveBeenNthCalledWith(
      3,
      'https://downdetector.com/status/aws-amazon-web-services/',
    );
  });

  it('keeps separate provider actions and omits unavailable X accounts', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'View AWS status details' }));
    expect(screen.getByRole('button', { name: 'Open AWS on X' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All providers' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Claude status details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Claude on Downdetector' }));
    expect(openExternal).toHaveBeenCalledWith('https://downdetector.com/status/claude-ai/');
    expect(screen.queryByRole('button', { name: 'Open Claude on X' })).not.toBeInTheDocument();
  });

  it('removes historical feed controls and hidden severity labels', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Incident feed')).not.toBeInTheDocument();
    for (const label of ['INFO', 'RESOLVED']) {
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

  it('keeps provider, outage, and degraded counts in the status bar', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [makeItem()],
        azure: [makeItem({ id: 'azure-warning', provider: 'azure', severity: 'warning' })],
      },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(screen.getByTestId('status-bar')).toHaveTextContent(
      '14 providers monitored · 1 active outage · 1 degraded issue',
    );
  });
});
