import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { CloudStatusData, CloudStatusItem, CloudStatusProvider } from '@shared/ipc';

// Mock ProviderIcon
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

// Stub globalThis.api
beforeEach(() => {
  (globalThis as Record<string, unknown>).api = {
    openExternal: vi.fn(),
  };
});

import { CloudStatusTab } from '../CloudStatusTab';

const emptyProviders: Record<CloudStatusProvider, never[]> = {
  aws: [],
  azure: [],
  m365: [],
  github: [],
  cloudflare: [],
  google: [],
  anthropic: [],
  openai: [],
  salesforce: [],
};

const makeStatusData = (overrides: Partial<CloudStatusData> = {}): CloudStatusData => ({
  providers: { ...emptyProviders },
  lastUpdated: Date.now(),
  errors: [],
  ...overrides,
});

const makeItem = (overrides: Partial<CloudStatusItem>): CloudStatusItem => ({
  id: overrides.id ?? 'item-1',
  provider: overrides.provider ?? 'aws',
  title: overrides.title ?? 'Provider incident',
  description: overrides.description ?? 'Incident details',
  pubDate: overrides.pubDate ?? new Date().toISOString(),
  link: overrides.link ?? '',
  severity: overrides.severity ?? 'warning',
});

describe('CloudStatusTab', () => {
  it('shows loading fallback when no data and loading', () => {
    render(<CloudStatusTab statusData={null} loading={true} refetch={vi.fn()} />);
    expect(screen.getByTestId('tab-fallback')).toBeInTheDocument();
  });

  it('renders with empty status data', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    expect(screen.getByText('Incident feed')).toBeInTheDocument();
    expect(screen.getByText(/No recent events/)).toBeInTheDocument();
  });

  it('renders provider cards for all providers', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    // Should show "All services normal" for each provider (9 providers)
    const normalStatuses = screen.getAllByText('All services normal');
    expect(normalStatuses.length).toBe(9);
  });

  it('renders filter buttons including All', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    // The "All" filter button
    expect(screen.getByText('All')).toBeInTheDocument();
    // Filter area has provider short labels - AWS appears in both filter and provider card
    const filterContainer = screen.getByText('All').parentElement!;
    expect(filterContainer).toBeInTheDocument();
    // Just verify the filters container has buttons
    const filterButtons = filterContainer.querySelectorAll('button');
    // All + 9 providers = 10
    expect(filterButtons.length).toBe(10);
  });

  it('renders refresh button', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    expect(screen.getByLabelText('Refresh cloud status')).toBeInTheDocument();
  });

  it('calls refetch when refresh button is clicked', () => {
    const refetch = vi.fn();
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={refetch} />);
    fireEvent.click(screen.getByLabelText('Refresh cloud status'));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('disables refresh button while loading', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={true} refetch={vi.fn()} />);
    expect(screen.getByLabelText('Refresh cloud status')).toBeDisabled();
  });

  it('renders status items when providers have issues', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [makeItem({ id: 'aws-1', provider: 'aws', title: 'EC2 Outage', severity: 'error' })],
      },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);
    expect(screen.getByText('EC2 Outage')).toBeInTheDocument();
    expect(screen.getByText('OUTAGE')).toBeInTheDocument();
  });

  it('shows active issues count on provider card', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        azure: [
          {
            id: 'az-1',
            provider: 'azure',
            title: 'Storage Degraded',
            description: 'Degraded storage performance',
            pubDate: new Date().toISOString(),
            link: '',
            severity: 'warning',
          },
        ],
      },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);
    expect(screen.getAllByText('1 active issue').length).toBeGreaterThanOrEqual(1);
  });

  it('renders command center posture metrics', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [
          makeItem({ id: 'aws-1', provider: 'aws', severity: 'error' }),
          makeItem({ id: 'aws-2', provider: 'aws', severity: 'warning' }),
        ],
        cloudflare: [makeItem({ id: 'cf-1', provider: 'cloudflare', severity: 'warning' })],
        m365: [makeItem({ id: 'm365-1', provider: 'm365', severity: 'info' })],
      },
    });

    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(screen.getByText('Current posture')).toBeInTheDocument();
    expect(screen.getByText('3 active issues')).toBeInTheDocument();
    expect(screen.getByText('2 impacted providers')).toBeInTheDocument();
    expect(screen.getByText('Worst severity')).toBeInTheDocument();
    expect(screen.getByText('Outage')).toBeInTheDocument();
  });

  it('orders impacted providers before healthy providers', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [makeItem({ id: 'aws-1', provider: 'aws', severity: 'error' })],
        cloudflare: [makeItem({ id: 'cf-1', provider: 'cloudflare', severity: 'warning' })],
      },
    });
    const { container } = render(
      <CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />,
    );

    const names = Array.from(container.querySelectorAll('.cloud-status-provider__name')).map(
      (node) => node.textContent,
    );
    expect(names.slice(0, 2)).toEqual(['AWS', 'Cloudflare']);
  });

  it('filters the incident feed by active, recent, and resolved states', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [
          makeItem({ id: 'aws-1', provider: 'aws', title: 'Active outage', severity: 'error' }),
        ],
        m365: [
          makeItem({
            id: 'm365-1',
            provider: 'm365',
            title: 'Admin center notice',
            severity: 'info',
          }),
        ],
        github: [
          makeItem({
            id: 'gh-1',
            provider: 'github',
            title: 'Recovered webhooks',
            severity: 'resolved',
          }),
        ],
      },
    });

    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(screen.getByText('Active outage')).toBeInTheDocument();
    expect(screen.queryByText('Admin center notice')).not.toBeInTheDocument();
    expect(screen.queryByText('Recovered webhooks')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    expect(screen.getByText('Admin center notice')).toBeInTheDocument();
    expect(screen.getByText('Active outage')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(screen.getByText('Recovered webhooks')).toBeInTheDocument();
    expect(screen.queryByText('Active outage')).not.toBeInTheDocument();
  });

  it('expands status item on click', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [
          {
            id: 'aws-1',
            provider: 'aws',
            title: 'EC2 Outage',
            description: 'Detailed description here',
            pubDate: new Date().toISOString(),
            link: 'https://example.com',
            severity: 'error',
          },
        ],
      },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    // Description should not be visible initially
    expect(screen.queryByText('Detailed description here')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText('EC2 Outage'));
    expect(screen.getByText('Detailed description here')).toBeInTheDocument();
    expect(screen.getByText('View details')).toBeInTheDocument();
  });

  it('collapses expanded item on second click', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [
          {
            id: 'aws-1',
            provider: 'aws',
            title: 'EC2 Outage',
            description: 'Detailed description',
            pubDate: new Date().toISOString(),
            link: '',
            severity: 'error',
          },
        ],
      },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    fireEvent.click(screen.getByText('EC2 Outage'));
    expect(screen.getByText('Detailed description')).toBeInTheDocument();

    fireEvent.click(screen.getByText('EC2 Outage'));
    expect(screen.queryByText('Detailed description')).not.toBeInTheDocument();
  });

  it('filters by provider when filter button is clicked', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [
          {
            id: 'aws-1',
            provider: 'aws',
            title: 'AWS Issue',
            description: 'desc',
            pubDate: new Date().toISOString(),
            link: '',
            severity: 'error',
          },
        ],
        azure: [
          {
            id: 'az-1',
            provider: 'azure',
            title: 'Azure Issue',
            description: 'desc',
            pubDate: new Date().toISOString(),
            link: '',
            severity: 'warning',
          },
        ],
      },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    // Both visible initially
    expect(screen.getByText('AWS Issue')).toBeInTheDocument();
    expect(screen.getByText('Azure Issue')).toBeInTheDocument();

    // Click AWS filter button (in the filters container, not the provider card)
    const filterContainer = screen.getByText('All').parentElement!;
    const awsFilterBtn = Array.from(filterContainer.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('AWS'),
    )!;
    fireEvent.click(awsFilterBtn);
    expect(screen.getByText('AWS Issue')).toBeInTheDocument();
    expect(screen.queryByText('Azure Issue')).not.toBeInTheDocument();
  });

  it('shows "Feed unavailable" for providers with errors', () => {
    const data = makeStatusData({
      errors: [{ provider: 'github', message: 'fetch failed' }],
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);
    expect(screen.getByText('Feed unavailable')).toBeInTheDocument();
  });

  it('renders status bar with provider count', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    expect(screen.getByText('9 providers monitored')).toBeInTheDocument();
  });

  it('shows Updated timestamp', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it('shows "Never" when lastUpdated is 0', () => {
    render(
      <CloudStatusTab
        statusData={makeStatusData({ lastUpdated: 0 })}
        loading={false}
        refetch={vi.fn()}
      />,
    );
    expect(screen.getByText('Updated Never')).toBeInTheDocument();
  });

  it('labels provider social links as socials', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    expect(screen.getByText('Socials')).toBeInTheDocument();
    expect(screen.queryByText('Sources')).not.toBeInTheDocument();
  });
});
