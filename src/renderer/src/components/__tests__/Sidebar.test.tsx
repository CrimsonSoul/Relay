import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { Sidebar } from '../Sidebar';
import type { RadarSnapshot } from '@shared/ipc';

// Mock SidebarButton to a simple button that captures props
vi.mock('../sidebar/SidebarButton', () => ({
  SidebarButton: ({
    label,
    isActive,
    onClick,
    status,
  }: {
    label: string;
    isActive: boolean;
    onClick: () => void;
    status?: {
      tone: string;
      announcement: string;
      detail?: string;
      compactDetail?: string;
    } | null;
  }) => (
    <button
      data-testid={`sidebar-btn-${label.toLowerCase()}`}
      data-status-tone={status?.tone}
      data-status-announcement={status?.announcement}
      data-status-detail={status?.detail}
      data-status-compact-detail={status?.compactDetail}
      data-active={isActive}
      onClick={onClick}
    >
      {label}
    </button>
  ),
}));

// Mock sidebar icons to simple spans
vi.mock('../sidebar/SidebarIcons', () => ({
  ComposeIcon: () => <span>ComposeIcon</span>,
  ClientsIcon: () => <span>ClientsIcon</span>,
  AlertsIcon: () => <span>AlertsIcon</span>,
  PersonnelIcon: () => <span>PersonnelIcon</span>,
  PeopleIcon: () => <span>PeopleIcon</span>,
  ServersIcon: () => <span>ServersIcon</span>,
  NotesIcon: () => <span>NotesIcon</span>,
  KnowledgeIcon: () => <span>KnowledgeIcon</span>,
  StatusIcon: () => <span>StatusIcon</span>,
  ProblemsIcon: () => <span>ProblemsIcon</span>,
  RadarIcon: () => <span>RadarIcon</span>,
  DashboardsIcon: () => <span>DashboardsIcon</span>,
  SettingsIcon: () => <span>SettingsIcon</span>,
  AppIcon: () => <span>AppIcon</span>,
}));

describe('Sidebar', () => {
  const defaultProps = {
    activeTab: 'Compose' as const,
    onTabChange: vi.fn(),
    onOpenSettings: vi.fn(),
    clientPresence: { count: 0, hostnames: [] },
  };

  const navLabelsOf = (container: HTMLElement) =>
    [...container.querySelectorAll('.sidebar-nav button')].map((button) => button.textContent);

  const stubRuntime = (kind: 'electron' | 'web', radar?: Partial<RadarSnapshot>) => {
    const snapshot: RadarSnapshot = {
      color: 'green',
      dispatchers: [],
      papa: [],
      metrics: [],
      xcenter: { ok: 2000, pending: 1807 },
      currentTime: null,
      lastUpdated: 1,
      signInRequired: false,
      error: null,
      ...radar,
    };
    Object.defineProperty(globalThis, 'api', {
      configurable: true,
      writable: true,
      value: {
        runtime: { kind },
        getRadarSnapshot: async () => snapshot,
        onRadarSnapshot: () => () => undefined,
      },
    });
  };

  afterEach(() => {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, 'api');
  });

  it('renders all seven shared destinations in their shortcut order', () => {
    stubRuntime('web');
    const { container } = render(<Sidebar {...defaultProps} />);

    expect(navLabelsOf(container)).toEqual([
      'Compose',
      'Alerts',
      'On-Call',
      'Knowledge',
      'Status',
      'Problems',
      'Radar',
    ]);
    expect(screen.queryByTestId('sidebar-btn-notes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-btn-people')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-btn-servers')).not.toBeInTheDocument();
  });

  it('keeps the same Radar destination in the desktop app', () => {
    stubRuntime('electron');
    const { container } = render(<Sidebar {...defaultProps} />);

    expect(navLabelsOf(container)).toEqual([
      'Compose',
      'Alerts',
      'On-Call',
      'Knowledge',
      'Status',
      'Problems',
      'Radar',
    ]);
  });

  /**
   * The point of the coloured button: the board can be read without opening the
   * tab. `aria-label` replaces a button's inner text, so the figures have to be
   * spoken there or a screen reader gets only the word "Radar".
   */
  it('hands the Radar button its live tone and exact XCenter tooltip text', async () => {
    stubRuntime('electron');
    render(<Sidebar {...defaultProps} />);

    await vi.waitFor(() => {
      const radar = screen.getByTestId('sidebar-btn-radar');
      expect(radar).toHaveAttribute('data-status-tone', 'green');
      expect(radar).toHaveAttribute(
        'data-status-announcement',
        'Healthy. XCenter OK 2,000, Pending 1,807',
      );
      expect(radar).not.toHaveAttribute('data-status-detail');
      expect(radar).not.toHaveAttribute('data-status-compact-detail');
    });
  });

  it('passes the board colour through to the button', async () => {
    stubRuntime('electron', { color: 'red' });
    render(<Sidebar {...defaultProps} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('sidebar-btn-radar')).toHaveAttribute('data-status-tone', 'red');
    });
  });

  /** Before the first poll lands there are no figures to announce. */
  it('announces the state alone before any counts have arrived', async () => {
    stubRuntime('electron', { color: 'unknown', xcenter: { ok: null, pending: null } });
    render(<Sidebar {...defaultProps} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('sidebar-btn-radar')).toHaveAttribute(
        'data-status-announcement',
        'Unknown',
      );
    });
  });

  it.each([
    ['refresh error', { error: 'ECONNREFUSED' }],
    ['expired sign-in', { signInRequired: true }],
  ] as const)('uses a neutral stale status for %s', async (_label, override) => {
    stubRuntime('electron', override);
    render(<Sidebar {...defaultProps} />);

    await vi.waitFor(() => {
      const radar = screen.getByTestId('sidebar-btn-radar');
      expect(radar).toHaveAttribute('data-status-tone', 'unknown');
      expect(radar).toHaveAttribute(
        'data-status-announcement',
        'Stale. XCenter OK 2,000, Pending 1,807',
      );
    });
  });

  it('gives the other destinations no status', () => {
    stubRuntime('electron');
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByTestId('sidebar-btn-alerts')).not.toHaveAttribute('data-status-tone');
  });

  it('shows Radar when Relay is served to a browser', () => {
    stubRuntime('web');
    const { container } = render(<Sidebar {...defaultProps} />);

    expect(navLabelsOf(container)).toContain('Radar');
  });

  it('renders Settings button', () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByTestId('sidebar-btn-settings')).toBeInTheDocument();
  });

  it('renders client presence above Settings in the sidebar footer', () => {
    const { container } = render(
      <Sidebar
        {...defaultProps}
        relayMode="server"
        clientPresence={{ count: 2, hostnames: ['ops-laptop', 'war-room-mac'] }}
      />,
    );

    expect(screen.getByTestId('sidebar-clients')).toHaveTextContent('2 clients');
    const footer = container.querySelector('.sidebar-footer');
    const clientBlock = screen.getByTestId('sidebar-clients');
    const settingsButton = screen.getByTestId('sidebar-btn-settings');
    expect(footer).toContainElement(clientBlock);
    expect(footer).toContainElement(settingsButton);
    expect(
      clientBlock.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders dashboard launcher between client presence and Settings when dashboards exist', () => {
    const { container } = render(
      <Sidebar
        {...defaultProps}
        relayMode="server"
        clientPresence={{ count: 1, hostnames: ['ops-laptop'] }}
        dynatraceDashboards={[
          {
            id: 'dt_1',
            name: 'NOC',
            url: 'https://abc.live.dynatrace.com/dashboard',
            state: 'live',
          },
        ]}
        onOpenDynatraceDashboard={vi.fn()}
      />,
    );

    const footer = container.querySelector('.sidebar-footer');
    const clientBlock = screen.getByTestId('sidebar-clients');
    const dashboardButton = screen.getByRole('button', {
      name: 'Open Dynatrace dashboard NOC',
    });
    const settingsButton = screen.getByTestId('sidebar-btn-settings');

    expect(footer).toContainElement(clientBlock);
    expect(footer).toContainElement(dashboardButton);
    expect(footer).toContainElement(settingsButton);
    expect(
      clientBlock.compareDocumentPosition(dashboardButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      dashboardButton.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders no operator selector between dashboard tools and Settings', () => {
    render(
      <Sidebar
        {...defaultProps}
        dynatraceDashboards={[
          {
            id: 'dt_1',
            name: 'NOC',
            url: 'https://abc.live.dynatrace.com/dashboard',
            state: 'live',
          },
        ]}
      />,
    );

    expect(screen.queryByText(/Select operator/i)).toBeNull();
    expect(screen.getByTestId('sidebar-btn-settings')).toBeVisible();
  });

  it('hides client presence when Relay is running in client mode', () => {
    render(
      <Sidebar
        {...defaultProps}
        relayMode="client"
        clientPresence={{ count: 2, hostnames: ['ops-laptop', 'war-room-mac'] }}
      />,
    );

    expect(screen.queryByTestId('sidebar-clients')).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-btn-settings')).toBeInTheDocument();
  });

  it('marks the active tab as active', () => {
    render(<Sidebar {...defaultProps} activeTab="Alerts" />);

    expect(screen.getByTestId('sidebar-btn-alerts').dataset.active).toBe('true');
    expect(screen.getByTestId('sidebar-btn-compose').dataset.active).toBe('false');
  });

  it('marks Settings active when it is the current tab', () => {
    render(<Sidebar {...defaultProps} activeTab="Settings" />);

    expect(screen.getByTestId('sidebar-btn-settings').dataset.active).toBe('true');
  });

  it('calls onTabChange when a nav item is clicked', () => {
    const onTabChange = vi.fn();
    render(<Sidebar {...defaultProps} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByTestId('sidebar-btn-alerts'));
    expect(onTabChange).toHaveBeenCalledWith('Alerts');
  });

  it('opens Knowledge from the navigation immediately after On-Call', () => {
    const onTabChange = vi.fn();
    const { container } = render(<Sidebar {...defaultProps} onTabChange={onTabChange} />);

    fireEvent.click(screen.getByTestId('sidebar-btn-knowledge'));
    expect(onTabChange).toHaveBeenCalledWith('Knowledge');
    const navLabels = [...container.querySelectorAll('.sidebar-nav button')].map(
      (button) => button.textContent,
    );
    expect(navLabels.indexOf('Knowledge')).toBe(navLabels.indexOf('On-Call') + 1);
  });

  it('calls onOpenSettings when Settings is clicked', () => {
    const onOpenSettings = vi.fn();
    render(<Sidebar {...defaultProps} onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByTestId('sidebar-btn-settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('calls onTabChange with Compose when app icon is clicked', () => {
    const onTabChange = vi.fn();
    render(<Sidebar {...defaultProps} onTabChange={onTabChange} />);

    const appIcon = screen.getByLabelText('Go to Compose tab');
    fireEvent.click(appIcon);
    expect(onTabChange).toHaveBeenCalledWith('Compose');
  });

  it('renders app branding with Relay label', () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByText('Relay')).toBeInTheDocument();
  });

  it('renders sidebar structure with nav and footer', () => {
    const { container } = render(<Sidebar {...defaultProps} />);

    expect(container.querySelector('.sidebar')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-nav')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-footer')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-divider')).toBeInTheDocument();
  });

  it('renders a fixed-width shell around the navigation surface', () => {
    const { container } = render(<Sidebar {...defaultProps} />);

    expect(container.querySelector('.sidebar-shell > .sidebar')).not.toBeNull();
    expect(container.querySelector('.sidebar')).toHaveAttribute('aria-label', 'Relay navigation');
  });
});
