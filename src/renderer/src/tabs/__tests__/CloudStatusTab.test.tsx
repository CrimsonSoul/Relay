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
  jira: [],
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
    expect(screen.getByText('No active provider incidents')).toBeInTheDocument();
  });

  it('renders the supported providers without an ADP card', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    const normalStatuses = screen.getAllByText('All services normal');
    expect(normalStatuses.length).toBe(10);
    expect(screen.queryByText('ADP')).not.toBeInTheDocument();
  });

  it('renders incident state filters with counts', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /Active\s*0/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: /Recent\s*0/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Resolved\s*0/ })).toBeInTheDocument();
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

  it('uses degraded and outage severity classes for provider status text', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [makeItem({ id: 'aws-1', provider: 'aws', severity: 'error' })],
        azure: [makeItem({ id: 'az-1', provider: 'azure', severity: 'warning' })],
      },
    });
    const { container } = render(
      <CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />,
    );

    const providerCards = Array.from(container.querySelectorAll('.cloud-status-provider'));
    const awsCard = providerCards.find((card) => card.textContent?.includes('AWS'));
    const azureCard = providerCards.find((card) => card.textContent?.includes('Azure'));

    expect(awsCard?.querySelector('.cloud-status-provider__status--error')).toBeInTheDocument();
    expect(azureCard?.querySelector('.cloud-status-provider__status--warning')).toBeInTheDocument();
  });

  it('renders info feed items with the info severity class', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        m365: [
          makeItem({
            id: 'm365-info',
            provider: 'm365',
            title: 'Admin center notice',
            severity: 'info',
          }),
        ],
      },
    });
    const { container } = render(
      <CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /Recent/ }));
    expect(screen.getByText('INFO')).toBeInTheDocument();
    expect(container.querySelector('.cloud-status-item__severity--info')).toBeInTheDocument();
  });

  it('summarizes current posture through filters and the status bar', () => {
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

    expect(screen.getByRole('heading', { name: 'External service monitor' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Active\s*3/ })).toBeInTheDocument();
    expect(screen.getByText(/3 active issues/)).toBeInTheDocument();
    expect(screen.getByText('Provider posture')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('tab', { name: /Recent/ }));
    expect(screen.getByText('Admin center notice')).toBeInTheDocument();
    expect(screen.getByText('Active outage')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Resolved/ }));
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
    expect(screen.getByText('View source ↗')).toBeInTheDocument();
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

  it('filters the incident feed when a provider row is selected', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Show AWS incidents' }));
    expect(screen.getByText('AWS Issue')).toBeInTheDocument();
    expect(screen.queryByText('Azure Issue')).not.toBeInTheDocument();
    expect(screen.getByText('AWS incidents')).toBeInTheDocument();
  });

  it('searches providers and incident text from the shared toolbar', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        azure: [makeItem({ id: 'az-1', provider: 'azure', title: 'Storage latency' })],
      },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Search service status'), {
      target: { value: 'Azure' },
    });

    expect(screen.getByRole('button', { name: 'Show Azure incidents' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show AWS incidents' })).not.toBeInTheDocument();
    expect(screen.getByText('Storage latency')).toBeInTheDocument();
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
    expect(screen.getByText('10 providers monitored')).toBeInTheDocument();
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

  it('does not render a footer socials block', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    expect(screen.queryByText('Socials')).not.toBeInTheDocument();
  });

  describe('provider card links', () => {
    const getCard = (container: HTMLElement, name: string): HTMLElement => {
      const cards = Array.from(container.querySelectorAll<HTMLElement>('.cloud-status-provider'));
      const card = cards.find((c) =>
        c.querySelector('.cloud-status-provider__name')?.textContent?.includes(name),
      );
      expect(card).toBeDefined();
      return card!;
    };
    const openExternal = () =>
      (globalThis as { api?: { openExternal: ReturnType<typeof vi.fn> } }).api!.openExternal;

    it('opens the vendor status page from the explicit source action', () => {
      const { container } = render(
        <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
      );
      const awsCard = getCard(container, 'AWS');
      fireEvent.click(
        Array.from(awsCard.querySelectorAll('button')).find(
          (button) => button.getAttribute('aria-label') === 'Open AWS status page',
        )!,
      );
      expect(openExternal()).toHaveBeenCalledWith('https://status.aws.amazon.com/');
    });

    it('renders an X link that opens the provider profile', () => {
      const { container } = render(
        <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
      );
      const awsCard = getCard(container, 'AWS');
      const xLink = Array.from(awsCard.querySelectorAll('button')).find(
        (b) => b.textContent === '@AWSCloud',
      );
      expect(xLink).toBeDefined();
      fireEvent.click(xLink!);
      expect(openExternal()).toHaveBeenCalledWith('https://x.com/AWSCloud');
    });

    it('omits the X link for providers without a handle', () => {
      const { container } = render(
        <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
      );
      const claudeCard = getCard(container, 'Claude');
      const xLinks = Array.from(claudeCard.querySelectorAll('button')).filter((b) =>
        b.textContent?.startsWith('@'),
      );
      expect(xLinks).toHaveLength(0);
    });

    it('renders a Downdetector link that opens the Downdetector page', () => {
      const { container } = render(
        <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
      );
      const githubCard = getCard(container, 'GitHub');
      const downdetectorLink = Array.from(githubCard.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Downdetector'),
      );
      expect(downdetectorLink).toBeDefined();
      fireEvent.click(downdetectorLink!);
      expect(openExternal()).toHaveBeenCalledWith('https://downdetector.com/status/github/');
    });
  });
});
