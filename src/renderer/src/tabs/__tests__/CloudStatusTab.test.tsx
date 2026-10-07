import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import type { CloudStatusData, CloudStatusItem, CloudStatusProvider } from '@shared/ipc';
import { emptyCloudStatusProviders } from '@shared/cloudStatus';
import { CURRENT_CLOUD_OUTAGE_WINDOW_MS } from '../../utils/cloudStatus';
import { formatOpsTime } from '../../utils/opsTime';

vi.mock('../../components/icons/ProviderIcons', () => ({
  ProviderIcon: ({ provider }: { provider: string }) => (
    <span data-testid={`provider-icon-${provider}`} />
  ),
}));

vi.mock('../../components/TabFallback', () => ({
  TabFallback: () => <div data-testid="tab-fallback">Loading...</div>,
}));

vi.mock('../../components/StatusBar', () => ({
  StatusBar: ({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) => (
    <div data-testid="status-bar">
      {left}
      {right}
    </div>
  ),
  StatusBarLive: () => <span data-testid="status-bar-live" />,
}));

import { CloudStatusTab } from '../CloudStatusTab';

/** The freshness readout by its whole text; its caption, time and note are separate spans. */
const readout = (text: string | RegExp) => (_content: string, element: Element | null) =>
  !!element?.classList.contains('tab-freshness') &&
  (typeof text === 'string' ? element.textContent === text : text.test(element.textContent ?? ''));

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

/** The overview summary banner; the status bar never repeats its counts. */
function overviewSummary(): HTMLElement {
  const summary = document.querySelector<HTMLElement>('.cloud-status__summary');
  if (!summary) throw new Error('Cloud status overview summary not rendered');
  return summary;
}
function showOperationalProviders() {
  const toggle = screen.queryByRole('button', { name: /operational/, expanded: false });
  if (toggle) fireEvent.click(toggle);
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

  it('gives the update as a clock time with the exact moment and its age in a Tooltip', () => {
    const lastUpdated = Date.now();
    render(
      <CloudStatusTab
        statusData={{ ...makeStatusData(), lastUpdated }}
        loading={false}
        refetch={vi.fn()}
      />,
    );
    const freshness = screen.getByText(readout(`Updated ${formatOpsTime(lastUpdated)}`));
    expect(freshness).toHaveClass('tab-freshness');
    // Its visible readout names the focus stop; no aria-label on the role-less <time>.
    expect(freshness).not.toHaveAttribute('aria-label');
    // Polls change the time silently; it is not a live region.
    expect(freshness.closest('[role="status"], output')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    act(() => {
      fireEvent.focus(freshness);
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^Last update .+ · 2m ago$/);
  });

  it('warns once the snapshot is older than two missed refreshes', () => {
    const lastUpdated = Date.now();
    render(
      <CloudStatusTab
        statusData={{ ...makeStatusData(), lastUpdated }}
        loading={false}
        refetch={vi.fn()}
      />,
    );
    const updated = `Updated ${formatOpsTime(lastUpdated)}`;
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByText(readout(updated))).not.toHaveClass('tab-freshness--stale');
    expect(document.querySelector('output.sr-only')).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText(readout(`${updated} · may be stale`))).toHaveClass(
      'tab-freshness--stale',
    );
    expect(document.querySelector('output.sr-only')).toHaveTextContent('Cloud status may be stale');
  });

  it('shows the loading fallback when no snapshot is available', () => {
    render(<CloudStatusTab statusData={null} loading={true} refetch={vi.fn()} />);
    expect(screen.getByTestId('tab-fallback')).toBeInTheDocument();
  });

  it('marks coverage unknown when loading ends without a status snapshot', () => {
    const refetch = vi.fn();
    render(<CloudStatusTab statusData={null} loading={false} refetch={refetch} />);

    expect(screen.getAllByText('Coverage unavailable').length).toBeGreaterThan(0);
    expect(screen.getByText('Provider status unavailable')).toBeInTheDocument();
    expect(screen.getByText(/no provider snapshot from the Relay server yet/)).toBeInTheDocument();
    // The notice points to the command bar's Refresh; the page has one refresh control.
    expect(screen.getByText(/Use Refresh above to check now\./)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /refresh/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cloud status' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.getAllByText('Unknown')).toHaveLength(16);
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

    const heading = screen.getByRole('heading', { level: 2, name: 'Status' });
    expect(heading).toHaveClass('tab-page-header__title');
    expect(heading.nextElementSibling).toHaveTextContent('External providers');
    const toolbar = screen.getByRole('toolbar', { name: 'Status actions' });
    const refresh = within(toolbar).getByRole('button', { name: 'Refresh cloud status' });
    expect(refresh).toHaveTextContent('Refresh');
    expect(container.querySelector('.tab-page-header')).not.toContainElement(refresh);
    expect(screen.getAllByText(readout(/^Updated /))).toHaveLength(1);
    // Freshness sits directly after the Refresh that changes it; the header holds the summary.
    expect(within(toolbar).getByText(readout(/^Updated /))).toHaveClass('tab-freshness');
    expect(container.querySelector('.tab-page-header')).toContainElement(overviewSummary());
    expect(screen.getByRole('region', { name: 'Provider overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Active issues' })).not.toBeInTheDocument();
    showOperationalProviders();
    expect(screen.getAllByRole('button', { name: /status details$/ })).toHaveLength(16);
    expect(
      screen.getByRole('button', { name: 'View AWS status details' }),
    ).toHaveAccessibleDescription('Operational No active issues');
    expect(screen.queryByText('All services normal')).not.toBeInTheDocument();
  });

  it('collapses operational providers into one expandable summary line', () => {
    const providers = emptyCloudStatusProviders();
    providers.aws = [makeItem({ id: 'aws-outage', pubDate: '2026-07-20T17:30:00.000Z' })];
    providers.azure = [
      makeItem<'azure'>({
        id: 'azure-degraded',
        provider: 'azure',
        severity: 'warning',
        pubDate: '2026-07-20T17:30:00.000Z',
      }),
    ];
    render(
      <CloudStatusTab
        statusData={makeStatusData({ providers })}
        loading={false}
        refetch={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'View AWS status details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Azure status details' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'View GitHub status details' }),
    ).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /14 providers operational/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: /status details$/ })).toHaveLength(16);
    expect(screen.getByRole('button', { name: 'View GitHub status details' })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(
      screen.queryByRole('button', { name: 'View GitHub status details' }),
    ).not.toBeInTheDocument();
  });

  it('lists every provider on a roomy screen only while all are healthy', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
    try {
      const { unmount } = render(
        <CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />,
      );
      expect(screen.getByRole('button', { name: /providers operational/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      unmount();

      const providers = emptyCloudStatusProviders();
      providers.aws = [makeItem({ pubDate: '2026-07-20T17:30:00.000Z' })];
      render(
        <CloudStatusTab
          statusData={makeStatusData({ providers })}
          loading={false}
          refetch={vi.fn()}
        />,
      );
      const toggle = screen.getByRole('button', { name: /providers operational/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders Equinix, Dropbox, and Proofpoint rows with the combined Mist and Dynatrace rows', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    showOperationalProviders();
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
      'Equinix',
      'Juniper Mist',
      'Dynatrace',
      'Google Cloud',
      'Claude',
      'ChatGPT',
      'Salesforce',
    ]);
    expect(screen.getByText('across 16 monitored providers')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'View Equinix status details' })).toBeInTheDocument();
  });

  it('shows Equinix as a monitored outage provider with official status details', () => {
    const providers = emptyCloudStatusProviders();
    providers.equinix = [
      makeItem({
        id: 'equinix-status-1',
        provider: 'equinix',
        title: 'Partial System Outage',
        description: 'Equinix Fabric: partial outage',
        link: 'https://equinixproductstatus.statuspage.io/',
      }),
    ];
    render(
      <CloudStatusTab
        statusData={makeStatusData({ providers })}
        loading={false}
        refetch={vi.fn()}
      />,
    );

    expect(screen.queryByRole('region', { name: 'Provider portals' })).not.toBeInTheDocument();
    const equinix = screen.getByRole('button', { name: 'View Equinix status details' });
    expect(equinix).toHaveAccessibleDescription('Outage 1 active issue');
    expect(screen.getByText('across 16 monitored providers')).toBeInTheDocument();
    // The provider count appears once, in the summary; the status bar repeats no counts.
    expect(screen.getByTestId('status-bar')).not.toHaveTextContent('providers monitored');

    fireEvent.click(equinix);
    expect(screen.getByText('Partial System Outage')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Equinix official status page' }));
    expect(openExternal).toHaveBeenCalledWith('https://equinixproductstatus.statuspage.io/');
  });

  it('offers only the official status action for Juniper Mist', () => {
    render(<CloudStatusTab statusData={makeStatusData()} loading={false} refetch={vi.fn()} />);
    showOperationalProviders();

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
    fireEvent.click(screen.getByRole('button', { name: 'View Official Status' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'View StatusGator Report' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'All Providers' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Dynatrace status details' }));
    expect(screen.getByText('Dynatrace platform outage')).toBeInTheDocument();
    expect(screen.getByText('AWS · Americas · Azure · Europe')).toBeInTheDocument();
  });

  it('does not claim full coverage when a provider feed is unavailable', () => {
    const data = makeStatusData({ errors: [{ provider: 'github', message: 'fetch failed' }] });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('1 provider feed unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(/Relay could not read GitHub\. Its row reads Unknown/),
    ).toBeInTheDocument();
    expect(screen.getByText('Technical details')).toBeInTheDocument();
    expect(screen.getByText('GitHub: fetch failed')).toBeInTheDocument();
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
    // The accessible name keeps the visible "Refreshing…" while busy (label in name).
    const refreshing = screen.getByRole('button', { name: 'Refreshing… cloud status' });
    expect(refreshing).toHaveTextContent('Refreshing…');
    expect(refreshing).toBeDisabled();
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
    expect(
      within(overviewSummary()).getByText('1 active outage · 1 degraded issue'),
    ).toBeInTheDocument();
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
    const allProvidersButton = screen.getByRole('button', { name: 'All Providers' });
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
    fireEvent.click(screen.getByRole('button', { name: 'All Providers' }));
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
    showOperationalProviders();

    fireEvent.click(screen.getByRole('button', { name: 'View ChatGPT status details' }));

    expect(screen.getByRole('region', { name: 'ChatGPT status details' })).toBeInTheDocument();
    expect(screen.getByText('No active issues for ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('Operational')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All Providers' }));

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
    expect(within(overviewSummary()).getByText('2 active outages')).toBeInTheDocument();
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
    showOperationalProviders();

    expect(screen.queryByText('Old AWS outage')).not.toBeInTheDocument();
    expect(screen.queryByText('Current GitHub outage')).not.toBeInTheDocument();
    expect(within(overviewSummary()).getByText('1 active outage')).toBeInTheDocument();
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
    showOperationalProviders();

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
    expect(screen.getByTestId('status-bar')).not.toHaveTextContent('Coverage incomplete');
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
    expect(within(overviewSummary()).getByText('1 active outage')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'View Official Status' }));
    expect(openExternal).toHaveBeenCalledWith('https://health.aws.amazon.com/incident/1');
  });

  it('opens provider Status, X, and Downdetector actions in the outage layout', () => {
    const data = makeStatusData({
      providers: { ...emptyProviders, aws: [makeItem()] },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'View AWS status details' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open AWS official status page' }));
    fireEvent.click(screen.getByRole('button', { name: '@AWSCloud, Open AWS on X' }));
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
    showOperationalProviders();

    fireEvent.click(screen.getByRole('button', { name: 'View AWS status details' }));
    expect(screen.getByRole('button', { name: '@AWSCloud, Open AWS on X' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All Providers' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Claude status details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Claude on Downdetector' }));
    expect(openExternal).toHaveBeenCalledWith('https://downdetector.com/status/claude-ai/');
    expect(screen.queryByRole('button', { name: /Open Claude on X$/ })).not.toBeInTheDocument();
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
    // Like Problems and Radar, the readout waits for a first update rather than inventing a time.
    expect(screen.queryByText(readout(/^Updated /))).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid|NaN/)).not.toBeInTheDocument();
  });

  it('leaves the issue counts to the summary strip instead of repeating them in the status bar', () => {
    const data = makeStatusData({
      providers: {
        ...emptyProviders,
        aws: [makeItem()],
        azure: [makeItem({ id: 'azure-warning', provider: 'azure', severity: 'warning' })],
      },
    });
    render(<CloudStatusTab statusData={data} loading={false} refetch={vi.fn()} />);

    expect(
      within(overviewSummary()).getByText('1 active outage · 1 degraded issue'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).not.toHaveTextContent('active outage');
    expect(screen.getByTestId('status-bar')).not.toHaveTextContent('degraded issue');
  });
});
