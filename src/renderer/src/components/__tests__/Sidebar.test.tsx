import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { Sidebar } from '../Sidebar';
import type { OnCallRow, RadarSnapshot } from '@shared/ipc';
import type { UnaddressedProblemCount } from '../../hooks/useUnaddressedProblemCount';
import { formatOpsTime } from '../../utils/opsTime';

const onCallRow = (overrides: Partial<OnCallRow> & Pick<OnCallRow, 'id' | 'team'>): OnCallRow => ({
  teamId: '',
  role: 'Primary',
  name: '',
  contact: '',
  ...overrides,
});

const problemCount = vi.hoisted(() => ({
  current: { count: null, freshness: 'live' } as UnaddressedProblemCount,
}));

vi.mock('../../hooks/useUnaddressedProblemCount', () => ({
  useUnaddressedProblemCount: () => problemCount.current,
}));

// Mock SidebarButton to a simple button that captures props
vi.mock('../sidebar/SidebarButton', () => ({
  SidebarButton: ({
    label,
    isActive,
    onClick,
    status,
    shortcutKey,
    onKeyDown,
    onContextMenu,
  }: {
    label: string;
    isActive: boolean;
    onClick: () => void;
    onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
    onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
    status?: {
      tone: string;
      announcement: string;
      detail?: string;
      compactDetail?: string;
      word?: string;
      noun?: string;
      stale?: boolean;
    } | null;
    shortcutKey?: string;
  }) => (
    <button
      data-testid={`sidebar-btn-${label.toLowerCase()}`}
      data-status-tone={status?.tone}
      data-status-announcement={status?.announcement}
      data-status-detail={status?.detail}
      data-status-compact-detail={status?.compactDetail}
      data-status-stale={status?.stale ? 'true' : undefined}
      data-status-word={status?.word}
      data-status-noun={status?.noun}
      data-shortcut-key={shortcutKey}
      data-active={isActive}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
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
  KnowledgeIcon: () => <span>KnowledgeIcon</span>,
  StatusIcon: () => <span>StatusIcon</span>,
  ProblemsIcon: () => <span>ProblemsIcon</span>,
  RadarIcon: () => <span>RadarIcon</span>,
  TicketsIcon: () => <span>TicketsIcon</span>,
  DashboardsIcon: () => <span>DashboardsIcon</span>,
  SettingsIcon: () => <span>SettingsIcon</span>,
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
    problemCount.current = { count: null, freshness: 'live' };
    localStorage.clear();
  });

  it('moves a destination with Alt+Arrow keys and its menu, saved on this device', async () => {
    stubRuntime('electron');
    localStorage.setItem('relay:sidebar-order', JSON.stringify(['Tickets', 'Compose', 'Gone']));
    const { container } = render(<Sidebar {...defaultProps} />);
    // A saved order keeps unknown entries out and every missing destination in its default place.
    expect(navLabelsOf(container)).toEqual([
      'Tickets',
      'Compose',
      'Alerts',
      'On-Call',
      'Knowledge',
      'Status',
      'Problems',
      'Radar',
    ]);
    expect(screen.getByTestId('sidebar-btn-tickets')).toHaveAttribute('data-shortcut-key', '1');
    fireEvent.keyDown(screen.getByTestId('sidebar-btn-tickets'), {
      key: 'ArrowDown',
      altKey: true,
    });
    expect(navLabelsOf(container).slice(0, 2)).toEqual(['Compose', 'Tickets']);
    expect(screen.getByText('Tickets moved to position 2 of 8.')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('relay:sidebar-order')!)).toEqual([
      'Compose',
      'Tickets',
      'Alerts',
      'Personnel',
      'Knowledge',
      'Status',
      'Problems',
      'Radar',
    ]);
    // Plain arrows stay with the rail's own navigation.
    fireEvent.keyDown(screen.getByTestId('sidebar-btn-tickets'), { key: 'ArrowDown' });
    expect(navLabelsOf(container)[1]).toBe('Tickets');
    fireEvent.keyDown(screen.getByTestId('sidebar-btn-radar'), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menuitem', { name: 'Move Down' })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move Up' }));
    expect(navLabelsOf(container).slice(-2)).toEqual(['Radar', 'Problems']);
    fireEvent.contextMenu(screen.getByTestId('sidebar-btn-compose'));
    expect(screen.getByRole('menuitem', { name: 'Move Up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset Sidebar Order' }));
    expect(navLabelsOf(container)[0]).toBe('Compose');
    expect(navLabelsOf(container)[1]).toBe('Alerts');
    // The default order is not stored.
    expect(localStorage.getItem('relay:sidebar-order')).toBeNull();
  });

  it('gives Status the hollow unknown ring before cloud status data arrives', () => {
    stubRuntime('web');
    render(<Sidebar {...defaultProps} cloudStatusData={null} />);

    const status = screen.getByTestId('sidebar-btn-status');
    expect(status).toHaveAttribute('data-status-tone', 'unknown');
    expect(status).toHaveAttribute('data-status-announcement', 'No status data yet');
  });

  it('marks the Problems count stale when Dynatrace sync is off', () => {
    stubRuntime('web');
    problemCount.current = { count: 3, freshness: 'off' };
    render(<Sidebar {...defaultProps} />);

    const problems = screen.getByTestId('sidebar-btn-problems');
    expect(problems).toHaveAttribute('data-status-stale', 'true');
    expect(problems.getAttribute('data-status-announcement')).toContain(
      "Dynatrace sync is off — count is Relay's saved copy",
    );
  });

  it('keeps a live Problems count unmarked and says it as a state word', () => {
    stubRuntime('web');
    problemCount.current = { count: 3, freshness: 'live' };
    render(<Sidebar {...defaultProps} />);

    const problems = screen.getByTestId('sidebar-btn-problems');
    expect(problems).not.toHaveAttribute('data-status-stale');
    expect(problems).toHaveAttribute('data-status-tone', 'yellow');
    expect(problems).toHaveAttribute('data-status-word', '3');
    expect(problems).toHaveAttribute('data-status-noun', 'unaddressed');
    expect(problems).toHaveAttribute('data-status-announcement', '3 unaddressed problems');
  });

  it('caps the Problems state word at 99+ so it fits the rail', () => {
    stubRuntime('web');
    problemCount.current = { count: 140, freshness: 'live' };
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByTestId('sidebar-btn-problems')).toHaveAttribute('data-status-word', '99+');
  });

  it('renders all eight shared destinations in their shortcut order', () => {
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
      'Tickets',
    ]);
    expect(
      [...container.querySelectorAll('.sidebar-nav button')].map(
        (button) => (button as HTMLElement).dataset.shortcutKey,
      ),
    ).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(screen.getByTestId('sidebar-btn-settings')).toHaveAttribute('data-shortcut-key', ',');
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
      'Tickets',
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
    [
      'refresh error',
      { error: 'ECONNREFUSED' },
      'failed',
      'Stale: showing the last good board; the latest refresh failed',
      'Stale',
    ],
    [
      'expired sign-in',
      { signInRequired: true },
      'unknown',
      'Stale: showing the last good board; CW Dashboard sign-in has expired',
      undefined,
    ],
  ] as const)('explains a stale status for %s', async (_label, override, tone, summary, word) => {
    stubRuntime('electron', override);
    render(<Sidebar {...defaultProps} />);

    await vi.waitFor(() => {
      const radar = screen.getByTestId('sidebar-btn-radar');
      expect(radar).toHaveAttribute('data-status-tone', tone);
      expect(radar).toHaveAttribute(
        'data-status-announcement',
        `${summary}. XCenter OK 2,000, Pending 1,807`,
      );
      // A failing feed shows the board's own headline word, the one the Radar tab shows.
      expect(radar.dataset.statusWord).toBe(word);
    });
  });

  it('gives a failed first load its own failed pip, apart from waiting', async () => {
    stubRuntime('electron', {
      lastUpdated: 0,
      error: 'ENOTFOUND',
      xcenter: { ok: null, pending: null },
    });
    render(<Sidebar {...defaultProps} />);

    await vi.waitFor(() => {
      const radar = screen.getByTestId('sidebar-btn-radar');
      expect(radar).toHaveAttribute('data-status-tone', 'failed');
      expect(radar).toHaveAttribute('data-status-word', 'Unavailable');
      expect(radar).toHaveAttribute(
        'data-status-announcement',
        'Radar unavailable: no data has loaded and the last refresh failed',
      );
    });
  });

  it('says since when Radar has been failing', async () => {
    const failingSince = Date.parse('2026-07-28T19:05:00Z');
    stubRuntime('electron', {
      lastUpdated: 0,
      error: 'ENOTFOUND',
      failingSince,
      xcenter: { ok: null, pending: null },
    });
    render(<Sidebar {...defaultProps} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('sidebar-btn-radar')).toHaveAttribute(
        'data-status-announcement',
        `Radar unavailable: no data has loaded; refreshes failing since ${formatOpsTime(failingSince)}`,
      );
    });
  });

  it('keeps the hollow waiting ring before the first Radar update', async () => {
    stubRuntime('electron', { lastUpdated: 0, xcenter: { ok: null, pending: null } });
    render(<Sidebar {...defaultProps} />);

    await vi.waitFor(() => {
      const radar = screen.getByTestId('sidebar-btn-radar');
      expect(radar).toHaveAttribute('data-status-tone', 'unknown');
      expect(radar).toHaveAttribute(
        'data-status-announcement',
        'Waiting for the first Radar update',
      );
    });
  });

  it('puts an alarm pip on On-Call when a team has no coverage', () => {
    stubRuntime('electron');
    render(
      <Sidebar
        {...defaultProps}
        onCall={[
          onCallRow({ id: 'a', team: 'Payments', teamId: 'payments', name: 'Ana', contact: '1' }),
          onCallRow({ id: 'b', team: 'Payments Escalation', teamId: 'pay-esc' }),
        ]}
      />,
    );

    const onCallButton = screen.getByTestId('sidebar-btn-on-call');
    expect(onCallButton).toHaveAttribute('data-status-tone', 'red');
    expect(onCallButton).toHaveAttribute('data-status-announcement', '1 team has no coverage');
  });

  it('gives On-Call no pip while every team is covered', () => {
    stubRuntime('electron');
    render(
      <Sidebar
        {...defaultProps}
        onCall={[onCallRow({ id: 'a', team: 'Payments', teamId: 'payments', name: 'Ana' })]}
      />,
    );

    expect(screen.getByTestId('sidebar-btn-on-call')).not.toHaveAttribute('data-status-tone');
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

    expect(screen.getByTestId('sidebar-clients')).toHaveTextContent('2 clients connected');
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
      name: 'Dashboards: Open NOC',
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

    const appIcon = screen.getByLabelText('Relay, go to Compose');
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
