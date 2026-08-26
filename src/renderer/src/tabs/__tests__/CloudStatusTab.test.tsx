import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import type { CloudStatusData, CloudStatusItem, CloudStatusProvider } from '@shared/ipc';
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

function makeItem<P extends CloudStatusProvider = 'aws'>(
  overrides: Partial<CloudStatusItem<P>> = {},
): CloudStatusItem<P> {
  return {
    id: overrides.id ?? 'item-1',
    provider: overrides.provider ?? ('aws' as P),
    title: overrides.title ?? 'Provider incident',
    description: overrides.description ?? 'Incident details',
    pubDate: overrides.pubDate ?? '2026-07-20T15:00:00.000Z',
    link: overrides.link ?? '',
    severity: overrides.severity ?? 'error',
    affectedScopes: overrides.affectedScopes,
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
    expect(screen.getAllByText('Unknown')).toHaveLength(15);
    expect(screen.getByRole('region', { name: 'Provider overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Active issues' })).not.toBeInTheDocument();
    expect(screen.queryByText('No reported issues')).not.toBeInTheDocument();
    expect(screen.queryByText('No active vendor issues')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View Juniper Mist status details' }));
    for (const region of ['Global', 'EMEA', 'APAC', 'Federal']) {
      expect(screen.getByRole('button', { name: `${region} Unknown` })).toBeInTheDocument();
    }
  });

  it('keeps a two-column provider overview without a global active-issues pane', () => {
    const { container } = render(
      <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: 'External Status' })).toHaveClass(
      'tab-page-header__title',
    );
    const toolbar = screen.getByRole('toolbar', { name: 'Status actions' });
    const utility = container.querySelector<HTMLElement>('.tab-command-group--utility');
    expect(toolbar).toContainElement(utility);
    expect(utility).toContainElement(screen.getByRole('button', { name: 'Refresh cloud status' }));
    expect(container.querySelector('.tab-command-group--workflow')).toBeNull();
    expect(screen.getByRole('region', { name: 'Provider overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Active issues' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /status details$/ })).toHaveLength(15);
    expect(
      screen.getByRole('button', { name: 'View AWS status details' }),
    ).toHaveAccessibleDescription('Operational No active issues');
    expect(screen.queryByText('All services normal')).not.toBeInTheDocument();
  });

  it('renders Dropbox and Proofpoint rows and keeps the combined Mist and Dynatrace rows', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    const monitored = screen.getByRole('region', { name: 'Provider overview' });

    expect(
      Array.from(monitored.querySelectorAll('.cloud-status-provider__name')).map(
        (node) => node.textContent,
      ),
    ).toEqual([
      'AWS',
      'Azure',
      'Microsoft 365',
      'Dropbox',
      'Proofpoint',
      'CrowdStrike',
      'Jira',
      'GitHub',
      'Cloudflare',
      'Juniper Mist',
      'Dynatrace',
      'Google Cloud',
      'Claude',
      'ChatGPT',
      'Salesforce',
    ]);
    expect(screen.getByText('across 15 monitored providers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Dropbox status details' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View Proofpoint status details' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View Juniper Mist status details' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View Dynatrace status details' }),
    ).toBeInTheDocument();
  });

  it('opens Equinix’s public status page without changing monitored health', () => {
    const refetch = vi.fn();
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={refetch} />);

    const portals = screen.getByRole('region', { name: 'Provider portals' });
    expect(within(portals).getByText('1 public status page')).toBeInTheDocument();
    const equinix = within(portals).getByRole('button', {
      name: 'Open Equinix public status page',
    });
    expect(equinix).toHaveAccessibleDescription('Public status Portal');
    expect(screen.getAllByRole('button', { name: /status details$/ })).toHaveLength(15);
    expect(screen.getByText('across 15 monitored providers')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toHaveTextContent('15 providers monitored');
    expect(screen.queryByText(/16 providers monitored/i)).not.toBeInTheDocument();

    fireEvent.click(equinix);

    expect(openExternal).toHaveBeenCalledWith('https://equinixproductstatus.statuspage.io/');
    expect(refetch).not.toHaveBeenCalled();
  });

  it('offers only the official status action for Juniper Mist', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'View Juniper Mist status details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Juniper Mist official status page' }));

    expect(openExternal).toHaveBeenCalledWith('https://status.mist.com/');
    expect(
      screen.queryByRole('button', { name: /Open Juniper Mist on (?:X|Downdetector)/ }),
    ).not.toBeInTheDocument();
  });

  it('shows Proofpoint as one outage-focused provider with its affected products', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        proofpoint: [
          makeItem({
            id: '000026896',
            provider: 'proofpoint',
            title: 'Proofpoint service interruption',
            description: 'Mail flow and portal access may be unavailable.',
            link: 'https://proofpoint.my.site.com/community/s/article/example',
            affectedScopes: ['Proofpoint Essentials', 'Email Protection'],
          }),
        ],
      },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    const proofpointButton = screen.getByRole('button', {
      name: 'View Proofpoint status details',
    });
    expect(proofpointButton).toHaveAccessibleDescription('Outage 1 active issue');
    fireEvent.click(proofpointButton);

    expect(screen.getByText('Proofpoint service interruption')).toBeInTheDocument();
    expect(screen.getByText('Proofpoint Essentials · Email Protection')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View official status' }));
    expect(openExternal).toHaveBeenCalledWith(
      'https://proofpoint.my.site.com/community/s/article/example',
    );
    expect(
      screen.queryByRole('button', { name: /Open Proofpoint on (?:X|Downdetector)/ }),
    ).not.toBeInTheDocument();
  });

  it('labels CrowdStrike as third-party and separates StatusGator from official support', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        crowdstrike: [
          makeItem({
            id: 'crowdstrike-statusgator-down',
            provider: 'crowdstrike',
            title: 'CrowdStrike outage reported by StatusGator',
            description: 'CrowdStrike is currently down.',
            link: 'https://statusgator.com/services/crowdstrike',
          }),
        ],
      },
    });
    const { container } = render(
      <CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />,
    );

    const crowdstrikeRow = screen
      .getByRole('button', { name: 'View CrowdStrike status details' })
      .closest('.cloud-status-provider');
    expect(crowdstrikeRow).toHaveTextContent('Third-party');
    expect(
      Array.from(container.querySelectorAll('.cloud-status-provider__name')).map(
        (node) => node.textContent,
      ),
    ).toContain('CrowdStrike');

    fireEvent.click(screen.getByRole('button', { name: 'View CrowdStrike status details' }));

    expect(
      screen.getByText('Status supplied by StatusGator, not CrowdStrike.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open CrowdStrike on StatusGator' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Open CrowdStrike official support portal' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open CrowdStrike on Downdetector' }));
    fireEvent.click(screen.getByRole('button', { name: 'View StatusGator report' }));

    expect(openExternal).toHaveBeenNthCalledWith(1, 'https://statusgator.com/services/crowdstrike');
    expect(openExternal).toHaveBeenNthCalledWith(
      2,
      'https://supportportal.crowdstrike.com/s/get-help',
    );
    expect(openExternal).toHaveBeenNthCalledWith(3, 'https://downdetector.com/status/crowdstrike/');
    expect(openExternal).toHaveBeenNthCalledWith(4, 'https://statusgator.com/services/crowdstrike');
  });

  it('deduplicates Mist regions and filters its detail view by regional posture', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        mist_global: [
          makeItem({
            id: 'mist-1',
            provider: 'mist_global',
            title: 'Mist login outage',
          }),
        ],
        mist_apac: [
          makeItem({
            id: 'mist-1',
            provider: 'mist_apac',
            title: 'Mist login outage',
          }),
        ],
        mist_emea: [
          makeItem({
            id: 'mist-2',
            provider: 'mist_emea',
            title: 'Mist EMEA packet loss',
            severity: 'warning',
          }),
        ],
        dynatrace: [
          makeItem({
            id: 'dynatrace-1',
            provider: 'dynatrace',
            title: 'Dynatrace platform outage',
            affectedScopes: ['AWS · Americas', 'Azure · Europe'],
          }),
        ],
      },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'View Juniper Mist status details' }));
    expect(screen.getAllByText('Mist login outage')).toHaveLength(1);
    expect(screen.getByText('Global · APAC')).toBeInTheDocument();
    expect(screen.getByText('Mist EMEA packet loss')).toBeInTheDocument();
    const regionGroup = screen.getByRole('group', { name: 'Juniper Mist regions' });
    expect(regionGroup).toBeInTheDocument();
    expect(regionGroup.tagName).toBe('FIELDSET');
    expect(screen.getByRole('button', { name: 'All Outage' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Global Outage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EMEA Degraded' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'APAC Outage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Federal Operational' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'EMEA Degraded' }));
    expect(screen.queryByText('Mist login outage')).not.toBeInTheDocument();
    expect(screen.getByText('Mist EMEA packet loss')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Federal Operational' }));
    expect(screen.queryByText('Mist EMEA packet loss')).not.toBeInTheDocument();
    expect(screen.getByText('No active issues for Juniper Mist Federal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All providers' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Dynatrace status details' }));
    expect(screen.getByText('Dynatrace platform outage')).toBeInTheDocument();
    expect(screen.getByText('AWS · Americas · Azure · Europe')).toBeInTheDocument();
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

  it('orders outage providers before unknown, degraded, and operational providers', () => {
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
    ).toEqual(['Azure', 'GitHub', 'Cloudflare', 'AWS']);
  });

  it('shows stale degradation as unknown when the latest provider fetch failed', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        cloudflare: [
          makeItem({ provider: 'cloudflare', severity: 'warning', title: 'Last known latency' }),
        ],
      },
      errors: [{ provider: 'cloudflare', message: 'fetch failed' }],
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'View Cloudflare status details' }),
    ).toHaveAccessibleDescription('Unknown 1 active issue');
    expect(screen.getByText('Coverage incomplete')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toHaveTextContent('coverage incomplete');
    expect(screen.getByTestId('status-bar')).not.toHaveTextContent('degraded issue');
  });

  it('keeps a confirmed outage visible when the latest provider fetch failed', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        proofpoint: [makeItem({ provider: 'proofpoint', severity: 'error' })],
      },
      errors: [{ provider: 'proofpoint', message: 'fetch failed' }],
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'View Proofpoint status details' }),
    ).toHaveAccessibleDescription('Outage 1 active issue');
    expect(screen.getByText('1 active outage')).toBeInTheDocument();
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
      '15 providers monitored · 1 active outage · 1 degraded issue',
    );
  });
});
