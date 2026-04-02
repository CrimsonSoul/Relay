import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { CloudStatusData, CloudStatusProvider } from '@shared/ipc';

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

describe('CloudStatusTab', () => {
  it('shows loading fallback when no data and loading', () => {
    render(<CloudStatusTab statusData={null} loading={true} refetch={vi.fn()} />);
    expect(screen.getByTestId('tab-fallback')).toBeInTheDocument();
  });

  it('renders with empty status data', () => {
    render(
      <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
    );
    expect(screen.getByText('Recent Events')).toBeInTheDocument();
    expect(screen.getByText(/No recent events/)).toBeInTheDocument();
  });

  it('renders provider cards for all providers', () => {
    render(
      <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
    );
    // Should show "All services normal" for each provider (9 providers)
    const normalStatuses = screen.getAllByText('All services normal');
    expect(normalStatuses.length).toBe(9);
  });

  it('renders filter buttons including All', () => {
    render(
      <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
    );
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
    render(
      <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
    );
    expect(screen.getByLabelText('Refresh cloud status')).toBeInTheDocument();
  });

  it('calls refetch when refresh button is clicked', () => {
    const refetch = vi.fn();
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={refetch} />);
    fireEvent.click(screen.getByLabelText('Refresh cloud status'));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('disables refresh button while loading', () => {
    render(
      <CloudStatusTab statusData={makeStatusData()} loading={true} refetch={vi.fn()} />,
    );
    expect(screen.getByLabelText('Refresh cloud status')).toBeDisabled();
  });

  it('renders status items when providers have issues', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [
          {
            id: 'aws-1',
            provider: 'aws',
            title: 'EC2 Outage',
            description: 'EC2 is experiencing issues',
            pubDate: new Date().toISOString(),
            link: 'https://example.com',
            severity: 'error',
          },
        ],
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
    expect(screen.getByText('1 active issue')).toBeInTheDocument();
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
    const awsFilterBtn = Array.from(filterContainer.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('AWS'),
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
    render(
      <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
    );
    expect(screen.getByText('9 providers monitored')).toBeInTheDocument();
  });

  it('shows Updated timestamp', () => {
    render(
      <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
    );
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
});
