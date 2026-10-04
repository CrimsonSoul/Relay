import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsModal } from '../SettingsModal';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';

// Mock Modal to a simple wrapper
vi.mock('../Modal', () => ({
  Modal: ({
    isOpen,
    children,
    title,
    variant,
    footer,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    title?: React.ReactNode;
    variant?: string;
    footer?: React.ReactNode;
  }) =>
    isOpen
      ? React.createElement(
          'div',
          { role: 'dialog', 'data-variant': variant },
          title && React.createElement('h2', null, title),
          children,
          footer,
        )
      : null,
}));

// Mock TactileButton
vi.mock('../TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    disabled,
    type,
    'aria-describedby': describedBy,
    'aria-label': ariaLabel,
    block: _b,
    className: _c,
    variant: _v,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    'aria-describedby'?: string;
    'aria-label'?: string;
    block?: boolean;
    className?: string;
    variant?: string;
  }) =>
    React.createElement(
      'button',
      { onClick, disabled, type, 'aria-describedby': describedBy, 'aria-label': ariaLabel },
      children,
    ),
}));

vi.mock('../../hooks/useRelayAdministration', () => ({
  useRelayAdministration: () => ({ snapshot: null, canAdminister: true }),
}));

vi.mock('../settings/PrivilegedAccessPanel', () => ({
  PrivilegedAccessPanel: () => React.createElement('h2', null, 'Privileged access'),
}));

const { mockUsePrivilegedAccess, mockShowToast } = vi.hoisted(() => ({
  mockUsePrivilegedAccess: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('../Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: mockUsePrivilegedAccess,
}));

vi.mock('../settings/AdministrationSettings', () => ({
  AdministrationSettings: () => React.createElement('h2', null, 'Relay administration'),
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
};
const LAN_SERVER_ADDRESS = ['192', '168', '1', '25'].join('.');
const CONNECTION_SECRET = ['fixture', 'passphrase', '123'].join('-');

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * `globalThis.api` is typed as the complete preload bridge; SettingsModal only reaches for
 * these members. Tests assert against this object rather than re-reading `globalThis.api`,
 * so the spies they inspect are provably the ones the component was handed.
 */
function createBridgeMock() {
  return {
    runtime: ELECTRON_RUNTIME,
    getConfig: vi.fn().mockResolvedValue({
      mode: 'server',
      port: 8090,
      bindHost: '0.0.0.0',
      lanIp: LAN_SERVER_ADDRESS,
    }),
    getConnectionSecret: vi.fn().mockResolvedValue(CONNECTION_SECRET),
    clearConfig: vi.fn().mockResolvedValue(true),
    getWebServerState: vi.fn().mockResolvedValue({
      enabled: false,
      status: 'disabled',
      port: 8091,
    }),
    saveWebServerConfig: vi.fn(),
    retryWebServer: vi.fn(),
    getWorkstationAwakeState: vi.fn().mockResolvedValue({
      supported: true,
      enabled: true,
      status: 'active',
    }),
    setWorkstationAwakeEnabled: vi.fn(),
    writeClipboard: vi.fn(),
    getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
    getCachedReleaseNotes: vi.fn().mockResolvedValue([
      {
        version: '1.1.0',
        title: 'Relay v1.1.0',
        body: '## Highlights\n\n- Faster update preparation',
        publishedAt: '2026-08-12T12:44:01Z',
        immutable: true,
      },
      {
        version: '1.0.0',
        title: 'Relay v1.0.0',
        body: 'Initial protected release.',
        publishedAt: '2026-07-28T12:44:01Z',
        immutable: true,
      },
    ]),
    refreshReleaseNotes: vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          version: '1.1.0',
          title: 'Relay v1.1.0',
          body: '## Highlights\n\n- Faster update preparation',
          publishedAt: '2026-08-12T12:44:01Z',
          immutable: true,
        },
        {
          version: '1.0.0',
          title: 'Relay v1.0.0',
          body: 'Initial protected release.',
          publishedAt: '2026-07-28T12:44:01Z',
          immutable: true,
        },
      ],
    }),
    openReleasesPage: vi.fn().mockResolvedValue(true),
    getRecoveryState: vi.fn().mockResolvedValue({
      supported: false,
      status: 'unavailable',
      mode: 'unconfigured',
      currentBuildId: null,
      currentVersion: null,
      runningBuildId: null,
      runningVersion: null,
      fallbackActive: false,
      retainedBuilds: [],
    }),
    rollbackToRecoveryBuild: vi.fn().mockResolvedValue({ success: true, data: true }),
    repairRecoveryBuild: vi.fn().mockResolvedValue({ success: true, data: true }),
  };
}

describe('SettingsModal', () => {
  let mockApi: ReturnType<typeof createBridgeMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePrivilegedAccess.mockReturnValue({
      session: { state: 'active', role: 'admin' },
    });
    mockApi = createBridgeMock();
    vi.stubGlobal('api', mockApi);
  });

  it('renders nothing when closed', () => {
    render(<SettingsModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders modal when open', () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-variant', 'standard');
  });

  it('shows Relay Web controls only for the desktop server role', async () => {
    const { unmount } = render(<SettingsModal {...defaultProps} />);
    expect(await screen.findByText('Relay Web')).toBeVisible();
    unmount();

    (globalThis.api as Record<string, unknown>).getConfig = vi.fn().mockResolvedValue({
      mode: 'client',
      serverUrl: ['http', '://', LAN_SERVER_ADDRESS, ':8090'].join(''),
      allowInsecureHttp: true,
    });
    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Relay Client')).toBeVisible());
    expect(screen.queryByText('Relay Web')).toBeNull();
  });

  it('renders focused sections when used as the Settings page', () => {
    render(<SettingsModal {...defaultProps} presentation="page" onOpenDataManager={vi.fn()} />);

    // One-line shared page header, matching the other top-level tabs.
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toHaveClass(
      'tab-page-header__title',
    );
    expect(screen.queryByText(/operator access/i)).toBeNull();
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('radiogroup', { name: 'Accent color' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Relay Data' }));

    expect(screen.getByText('Open Data Manager…')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Accent color' })).toBeNull();
  });

  it('connects Settings tabs to their panel and supports arrow-key navigation', async () => {
    render(<SettingsModal {...defaultProps} presentation="page" />);
    await screen.findByRole('tab', { name: 'Workstation' });

    const appearanceTab = screen.getByRole('tab', { name: 'Appearance' });
    expect(appearanceTab).toHaveAttribute('aria-controls', 'settings-panel');
    expect(screen.getByRole('tabpanel', { name: 'Appearance' })).toHaveAttribute(
      'aria-labelledby',
      'settings-tab-appearance',
    );

    fireEvent.keyDown(appearanceTab, { key: 'ArrowRight' });

    const workstationTab = screen.getByRole('tab', { name: 'Workstation' });
    expect(workstationTab).toHaveAttribute('aria-selected', 'true');
    expect(workstationTab).toHaveFocus();
  });

  it('removes the obsolete Operator roster section', () => {
    render(<SettingsModal {...defaultProps} presentation="page" />);

    expect(screen.queryByRole('tab', { name: 'Operators' })).toBeNull();
  });

  it('offers local Windows inactivity protection as a peer Settings section', async () => {
    render(<SettingsModal {...defaultProps} presentation="page" />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Workstation' }));

    expect(screen.getByRole('tabpanel', { name: 'Workstation' })).toBeInTheDocument();
    expect(
      await screen.findByRole('switch', {
        name: 'Keep this PC awake while Relay is running',
      }),
    ).toBeChecked();
  });

  it('offers Access as a peer Settings page section', () => {
    render(<SettingsModal {...defaultProps} presentation="page" />);

    expect(screen.getByRole('tab', { name: 'Access' })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByRole('tab', { name: 'Access' }));

    expect(screen.getByRole('tabpanel', { name: 'Access' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Privileged access' })).toBeVisible();
  });

  it('offers the installed Relay version and releases action in About', async () => {
    render(<SettingsModal {...defaultProps} presentation="page" />);

    fireEvent.click(screen.getByRole('tab', { name: 'About' }));

    expect(screen.getByRole('tabpanel', { name: 'About' })).toBeInTheDocument();
    expect(await screen.findAllByText('v1.0.0')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'View Releases' }));
    await waitFor(() => expect(mockApi.openReleasesPage).toHaveBeenCalledOnce());
  });

  it('can open directly to About for the native Recovery shortcut', async () => {
    render(<SettingsModal {...defaultProps} presentation="page" initialSection="about" />);

    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'About Relay' })).toBeVisible();
  });

  it('shows cached release history immediately with latest and installed context', async () => {
    render(<SettingsModal {...defaultProps} presentation="page" />);
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));

    expect(await screen.findByRole('heading', { name: 'Release notes' })).toBeVisible();
    const latest = screen.getByRole('button', {
      name: /^v1\.1\.0 Relay v1\.1\.0, .+, Latest(, Installed)?, release notes$/,
    });
    expect(latest).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Latest')).toBeVisible();
    expect(screen.getByText('Installed')).toBeVisible();
    expect(screen.getByText('Faster update preparation')).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', { name: /^v1\.0\.0 Relay v1\.0\.0, .+release notes$/ }),
    );
    expect(screen.getByText('Initial protected release.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View v1.0.0 on GitHub' }));
    await waitFor(() => expect(mockApi.openReleasesPage).toHaveBeenCalledWith('1.0.0'));
  });

  it('keeps cached release notes readable when the background refresh is offline', async () => {
    mockApi.refreshReleaseNotes.mockResolvedValueOnce({ success: false, error: 'unavailable' });
    render(<SettingsModal {...defaultProps} presentation="page" />);
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));

    expect(await screen.findByText('Faster update preparation')).toBeVisible();
    const savedReleaseNotice = await screen.findByText(
      'Showing saved release notes. GitHub refresh unavailable.',
    );
    expect(savedReleaseNotice).toBeVisible();
    expect(savedReleaseNotice.closest('output')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeVisible();
  });

  it('lets the active Owner confirm a retained Windows rollback with a fresh password', async () => {
    mockUsePrivilegedAccess.mockReturnValue({
      session: { state: 'active', role: 'owner', accountId: 'account-owner' },
    });
    mockApi.getRecoveryState.mockResolvedValueOnce({
      supported: true,
      status: 'ready',
      mode: 'server',
      currentBuildId: 'r2-current',
      currentVersion: '1.6.0',
      runningBuildId: 'r2-current',
      runningVersion: '1.6.0',
      fallbackActive: false,
      retainedBuilds: [
        {
          buildId: 'r2-previous',
          version: '1.5.0',
          releaseTag: 'v1.5.0',
          installedAt: '2026-08-20T15:00:00.000Z',
          status: 'ready',
          rollbackAvailable: true,
          repairAvailable: false,
          githubFallbackAvailable: false,
        },
      ],
    });
    render(<SettingsModal {...defaultProps} presentation="page" />);
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));

    expect(await screen.findByRole('heading', { name: 'Recovery' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Roll Back to v1.5.0' }));
    expect(screen.getByText(/restore the server data snapshot/i)).toBeVisible();

    fireEvent.change(screen.getByLabelText('Owner password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Rollback' }));

    await waitFor(() =>
      expect(mockApi.rollbackToRecoveryBuild).toHaveBeenCalledWith({
        targetBuildId: 'r2-previous',
        password: 'correct horse battery staple',
      }),
    );
    const restartFeedback = await screen.findByText('Restarting Relay with v1.5.0…');
    expect(restartFeedback).toBeVisible();
    expect(restartFeedback.closest('output')).not.toBeNull();
  });

  it('lets the active Owner repair a missing retained runtime from its exact GitHub release', async () => {
    mockUsePrivilegedAccess.mockReturnValue({
      session: { state: 'active', role: 'owner', accountId: 'account-owner' },
    });
    const missingState = {
      supported: true,
      status: 'ready' as const,
      mode: 'client' as const,
      currentBuildId: 'r2-current',
      currentVersion: '1.6.0',
      runningBuildId: 'r2-current',
      runningVersion: '1.6.0',
      fallbackActive: false,
      retainedBuilds: [
        {
          buildId: 'r2-previous',
          version: '1.5.0',
          releaseTag: 'v1.5.0',
          installedAt: '2026-08-20T15:00:00.000Z',
          status: 'runtime-missing' as const,
          rollbackAvailable: false,
          repairAvailable: true,
          githubFallbackAvailable: true,
        },
      ],
    };
    mockApi.getRecoveryState.mockResolvedValueOnce(missingState).mockResolvedValueOnce({
      ...missingState,
      retainedBuilds: [
        {
          ...missingState.retainedBuilds[0],
          status: 'ready',
          rollbackAvailable: true,
          repairAvailable: false,
          githubFallbackAvailable: false,
        },
      ],
    });
    render(<SettingsModal {...defaultProps} presentation="page" />);
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Repair v1.5.0 from GitHub' }));
    expect(screen.getByText(/exact immutable v1\.5\.0 release/i)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Owner password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Repair' }));

    await waitFor(() =>
      expect(mockApi.repairRecoveryBuild).toHaveBeenCalledWith({
        targetBuildId: 'r2-previous',
        password: 'correct horse battery staple',
      }),
    );
    expect(await screen.findByText('v1.5.0 is repaired and ready to roll back.')).toBeVisible();
    expect(mockApi.getRecoveryState).toHaveBeenCalledTimes(2);
  });

  it('explains when Relay is running a retained recovery runtime', async () => {
    mockUsePrivilegedAccess.mockReturnValue({
      session: { state: 'active', role: 'owner', accountId: 'account-owner' },
    });
    mockApi.getRecoveryState.mockResolvedValueOnce({
      supported: true,
      status: 'ready',
      mode: 'server',
      currentBuildId: 'r2-current',
      currentVersion: '1.6.0',
      runningBuildId: 'r2-previous',
      runningVersion: '1.5.0',
      fallbackActive: true,
      retainedBuilds: [
        {
          buildId: 'r2-previous',
          version: '1.5.0',
          releaseTag: 'v1.5.0',
          installedAt: '2026-08-20T15:00:00.000Z',
          status: 'ready',
          rollbackAvailable: true,
          repairAvailable: false,
          githubFallbackAvailable: false,
        },
      ],
    });
    render(<SettingsModal {...defaultProps} presentation="page" />);
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));

    expect(await screen.findByText('Recovery runtime v1.5.0')).toBeVisible();
    const fallbackNotice = screen.getByText(/catalog still points to v1\.6\.0/i);
    expect(fallbackNotice).toBeVisible();
    expect(fallbackNotice.closest('output')).not.toBeNull();
  });

  it('offers Administration to the authenticated Relay administrator', () => {
    render(<SettingsModal {...defaultProps} presentation="page" />);

    fireEvent.click(screen.getByRole('tab', { name: 'Administration' }));

    expect(screen.getByRole('tabpanel', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Relay administration' })).toBeVisible();
  });

  it('offers Administration to the authenticated Relay owner', () => {
    mockUsePrivilegedAccess.mockReturnValue({
      session: { state: 'active', role: 'owner', accountId: 'account-owner' },
    });
    render(<SettingsModal {...defaultProps} presentation="page" />);

    fireEvent.click(screen.getByRole('tab', { name: 'Administration' }));

    expect(screen.getByRole('heading', { name: 'Relay administration' })).toBeVisible();
  });

  it('keeps the full-width operator roster out of the compact legacy modal', () => {
    render(<SettingsModal {...defaultProps} />);

    expect(screen.queryByRole('heading', { name: 'Operator roster' })).toBeNull();
  });

  it('directs server problem configuration to protected Administration without legacy token inputs', async () => {
    render(<SettingsModal {...defaultProps} presentation="page" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dynatrace' }));
    expect(
      await screen.findByText(/Configure or disable Dynatrace Problems in Administration/),
    ).toBeVisible();
    expect(
      screen
        .getByText(/Configure or disable Dynatrace Problems in Administration/)
        .closest('.settings-section'),
    ).toContainElement(screen.getByText('Dynatrace Problems'));
    expect(screen.queryByRole('button', { name: 'Test access' })).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Platform token · read-only Grail access'),
    ).not.toBeInTheDocument();
  });

  it('does not render the on-call board size selector inside settings', () => {
    render(<SettingsModal {...defaultProps} />);

    expect(screen.queryByRole('radiogroup', { name: 'On-call board size' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'On-call board text size' })).toBeNull();
  });

  it('shows "Open Data Manager…" when onOpenDataManager is provided', () => {
    const onOpenDataManager = vi.fn();
    render(<SettingsModal {...defaultProps} onOpenDataManager={onOpenDataManager} />);
    expect(screen.getByText('Open Data Manager…')).toBeInTheDocument();
  });

  it('calls onClose and onOpenDataManager when "Open Data Manager…" is clicked', () => {
    const onClose = vi.fn();
    const onOpenDataManager = vi.fn();
    render(
      <SettingsModal {...defaultProps} onClose={onClose} onOpenDataManager={onOpenDataManager} />,
    );
    fireEvent.click(screen.getByText('Open Data Manager…'));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenDataManager).toHaveBeenCalled();
  });

  it('does not show Data Manager button when onOpenDataManager is not provided', () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.queryByText('Open Data Manager…')).not.toBeInTheDocument();
  });

  it('shows PocketBase section with connection info', async () => {
    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/Embedded Server/)).toBeInTheDocument();
      expect(screen.getByText(`http://${LAN_SERVER_ADDRESS}:8090`)).toBeInTheDocument();
      expect(screen.queryByText(/IP:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Port:/)).not.toBeInTheDocument();
    });
  });

  it('shows the connection passphrase behind a fixed-length mask until revealed', async () => {
    render(<SettingsModal {...defaultProps} />);

    const fixedMask = '••••••••••••';
    await waitFor(() => {
      expect(screen.getByText('Passphrase').nextElementSibling).toHaveTextContent(fixedMask);
    });
    // The mask does not track the secret's length.
    expect(CONNECTION_SECRET).not.toHaveLength(fixedMask.length);
    expect(screen.getByText('Passphrase').nextElementSibling?.textContent).not.toContain(
      `${fixedMask}•`,
    );
    expect(screen.queryByText(CONNECTION_SECRET)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show passphrase' }));

    expect(screen.getByText(CONNECTION_SECRET)).toBeInTheDocument();
  });

  it('preserves revealed connection state across Settings page navigation without reloading config', async () => {
    render(<SettingsModal {...defaultProps} presentation="page" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Relay Data' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show passphrase' })).toBeVisible(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show passphrase' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Relay Data' }));

    expect(screen.getByText(CONNECTION_SECRET)).toBeVisible();
    expect(mockApi.getConfig).toHaveBeenCalledOnce();
    expect(mockApi.getConnectionSecret).toHaveBeenCalledOnce();
  });

  it('shows Reconfigure button', async () => {
    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Reconfigure…')).toBeInTheDocument();
    });
  });

  it('keeps connection details but hides desktop-only secrets and controls on the web', async () => {
    (globalThis.api as Record<string, unknown>).runtime = WEB_RUNTIME;
    render(<SettingsModal {...defaultProps} />);

    expect(await screen.findByText('Embedded Server')).toBeInTheDocument();
    expect(screen.queryByText('Passphrase')).not.toBeInTheDocument();
    expect(screen.queryByText('Reconfigure…')).not.toBeInTheDocument();
    expect(screen.queryByText('Relay Web')).not.toBeInTheDocument();
    expect(screen.getByText(/managed by Relay Desktop/i)).toBeInTheDocument();
    expect(mockApi.getConnectionSecret).not.toHaveBeenCalled();
  });

  it('shows "Not configured" when getConfig returns null', async () => {
    (globalThis.api as Record<string, unknown>).getConfig = vi.fn().mockResolvedValue(null);
    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Not configured')).toBeInTheDocument();
    });
  });

  it('calls clearConfig and onReconfigure once the reconfigure warning is confirmed', async () => {
    const onClose = vi.fn();
    const onReconfigure = vi.fn();
    render(<SettingsModal {...defaultProps} onClose={onClose} onReconfigure={onReconfigure} />);
    await waitFor(() => {
      expect(screen.getByText('Reconfigure…')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Reconfigure…'));

    fireEvent.click(await screen.findByText('Erase and Reconfigure'));

    await waitFor(() => {
      expect(mockApi.clearConfig).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(onReconfigure).toHaveBeenCalled();
    });
  });

  it('does not erase the saved config until the reconfigure warning is confirmed', async () => {
    const onClose = vi.fn();
    const onReconfigure = vi.fn();
    render(<SettingsModal {...defaultProps} onClose={onClose} onReconfigure={onReconfigure} />);
    await waitFor(() => {
      expect(screen.getByText('Reconfigure…')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reconfigure…'));

    expect(await screen.findByText('Reconfigure Relay connection?')).toBeInTheDocument();
    expect(
      screen.getByText(/erases the saved Relay server URL and the shared connection passphrase/i),
    ).toBeInTheDocument();
    expect(mockApi.clearConfig).not.toHaveBeenCalled();
    expect(onReconfigure).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() =>
      expect(screen.queryByText('Reconfigure Relay connection?')).not.toBeInTheDocument(),
    );
    expect(mockApi.clearConfig).not.toHaveBeenCalled();
    expect(onReconfigure).not.toHaveBeenCalled();
  });

  it('warns how many queued offline changes a reconfigure would discard', async () => {
    (globalThis.api as Record<string, unknown>).getPendingSyncStatus = vi
      .fn()
      .mockResolvedValue({ pendingCount: 3 });
    render(<SettingsModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Reconfigure…')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reconfigure…'));

    expect(await screen.findByText(/3 offline changes queued on this workstation/i)).toBeVisible();
  });

  it('shows Dynatrace dashboard settings and opens a saved dashboard', async () => {
    const openDashboard = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [
            {
              id: 'dt_1',
              name: 'NOC',
              url: 'https://abc.live.dynatrace.com/dashboard',
              state: 'closed',
            },
          ],
          addDashboard: vi.fn(),
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard,
          clearSession: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText('Dynatrace dashboards')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open NOC' }));

    await waitFor(() => {
      expect(openDashboard).toHaveBeenCalledWith('dt_1');
    });
  });

  it('adds a Dynatrace dashboard from Settings', async () => {
    const addDashboard = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [],
          addDashboard,
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'NOC' } });
    fireEvent.change(screen.getByLabelText('Dashboard URL'), {
      target: { value: 'https://abc.live.dynatrace.com/dashboard' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Dashboard' }));

    await waitFor(() =>
      expect(addDashboard).toHaveBeenCalledWith({
        name: 'NOC',
        url: 'https://abc.live.dynatrace.com/dashboard',
      }),
    );
  });

  it('keeps Add Dashboard enabled and focuses the first missing field instead of adding', () => {
    const addDashboard = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [],
          addDashboard,
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    const addButton = screen.getByRole('button', { name: 'Add Dashboard' });
    const nameField = screen.getByLabelText('Dashboard name');
    const urlField = screen.getByLabelText('Dashboard URL');
    expect(addButton).toBeEnabled();
    expect(addButton).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(/^Needs /)).not.toBeInTheDocument();
    // No errors before the first attempt.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The URL field names its constraint before anything is typed, with an example placeholder.
    expect(urlField).toHaveAttribute(
      'placeholder',
      expect.stringMatching(/^https:\/\/[^/]+\.dynatrace\.com\//),
    );
    expect(urlField).toHaveAccessibleDescription(
      "Copy the HTTPS dynatrace.com address from the dashboard's address bar, for example https://abc12345.live.dynatrace.com/ui/apps/dynatrace.dashboards/…",
    );

    fireEvent.click(addButton);
    expect(nameField).toHaveFocus();
    expect(nameField).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a dashboard name.')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Enter the dashboard URL.')).toHaveAttribute('role', 'alert');
    expect(addDashboard).not.toHaveBeenCalled();

    fireEvent.change(nameField, { target: { value: 'NOC' } });
    fireEvent.click(addButton);
    expect(urlField).toHaveFocus();
    expect(urlField).toHaveAttribute('aria-invalid', 'true');
    expect(addDashboard).not.toHaveBeenCalled();

    fireEvent.change(urlField, {
      target: { value: 'https://abc.live.dynatrace.com/dashboard' },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(addDashboard).not.toHaveBeenCalled();
  });

  it('shows inline validation for invalid Dynatrace dashboard URLs', () => {
    const addDashboard = vi.fn().mockResolvedValue(true);
    const insecureDynatraceUrl = ['http', '://abc.live.dynatrace.com/dashboard'].join('');

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [],
          addDashboard,
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'NOC' } });
    fireEvent.change(screen.getByLabelText('Dashboard URL'), {
      target: { value: insecureDynatraceUrl },
    });

    const dashboardUrl = screen.getByLabelText('Dashboard URL');
    const validation = screen.getByText('Dynatrace dashboard URLs must use HTTPS.');
    expect(dashboardUrl).toHaveAttribute('aria-invalid', 'true');
    expect(dashboardUrl).toHaveAttribute(
      'aria-describedby',
      `dynatrace-dashboard-url-hint ${validation.id}`,
    );
    const addButton = screen.getByRole('button', { name: 'Add Dashboard' });
    expect(addButton).toBeEnabled();
    fireEvent.click(addButton);
    expect(dashboardUrl).toHaveFocus();
    expect(addDashboard).not.toHaveBeenCalled();
  });

  it('marks a blank-only dashboard name invalid', () => {
    const addDashboard = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [],
          addDashboard,
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Dashboard URL'), {
      target: { value: 'https://abc.live.dynatrace.com/dashboard' },
    });

    const dashboardName = screen.getByLabelText('Dashboard name');
    const validation = screen.getByText('Enter a dashboard name.');
    expect(dashboardName).toHaveAttribute('aria-invalid', 'true');
    expect(dashboardName).toHaveAttribute('aria-describedby', validation.id);
    fireEvent.click(screen.getByRole('button', { name: 'Add Dashboard' }));
    expect(dashboardName).toHaveFocus();
    expect(addDashboard).not.toHaveBeenCalled();
  });

  it('flags an empty dashboard field under itself once the operator leaves it', () => {
    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [],
          addDashboard: vi.fn(),
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    const dashboardName = screen.getByLabelText('Dashboard name');
    const dashboardUrl = screen.getByLabelText('Dashboard URL');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.blur(dashboardName);
    const nameError = screen.getByText('Enter a dashboard name.');
    expect(nameError).toHaveClass('field-error');
    expect(dashboardName).toHaveAttribute('aria-invalid', 'true');
    expect(dashboardName).toHaveAttribute('aria-describedby', nameError.id);

    fireEvent.blur(dashboardUrl);
    const urlError = screen.getByText('Enter the dashboard URL.');
    expect(dashboardUrl).toHaveAttribute(
      'aria-describedby',
      `dynatrace-dashboard-url-hint ${urlError.id}`,
    );
    fireEvent.change(dashboardName, { target: { value: 'NOC' } });
    expect(dashboardName).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Enter a dashboard name.')).not.toBeInTheDocument();
  });

  it('updates a Dynatrace dashboard from Settings', async () => {
    const updateDashboard = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [
            {
              id: 'dt_1',
              name: 'NOC',
              url: 'https://abc.live.dynatrace.com/dashboard',
              state: 'live',
            },
          ],
          addDashboard: vi.fn(),
          updateDashboard,
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit NOC' }));
    expect(screen.getByLabelText('Dashboard name')).toHaveValue('NOC');
    expect(screen.getByLabelText('Dashboard URL')).toHaveValue(
      'https://abc.live.dynatrace.com/dashboard',
    );

    fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'NOC Main' } });
    fireEvent.change(screen.getByLabelText('Dashboard URL'), {
      target: { value: 'https://apps.dynatrace.com/dashboard/noc-main' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Dashboard' }));

    await waitFor(() =>
      expect(updateDashboard).toHaveBeenCalledWith('dt_1', {
        name: 'NOC Main',
        url: 'https://apps.dynatrace.com/dashboard/noc-main',
      }),
    );
  });

  it('refuses a newly entered Dynatrace URL that embeds credentials', () => {
    const addDashboard = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [],
          addDashboard,
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'NOC' } });
    fireEvent.change(screen.getByLabelText('Dashboard URL'), {
      target: { value: 'https://user:secret@abc.live.dynatrace.com/dashboard' },
    });
    const dashboardUrl = screen.getByLabelText('Dashboard URL');
    expect(dashboardUrl).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Add Dashboard' }));
    expect(dashboardUrl).toHaveFocus();
    expect(addDashboard).not.toHaveBeenCalled();
  });

  it('still saves an edited dashboard whose stored URL predates the credentials rule', async () => {
    const updateDashboard = vi.fn().mockResolvedValue(true);
    const legacyUrl = 'https://user:secret@abc.live.dynatrace.com/dashboard';

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [{ id: 'dt_1', name: 'NOC', url: legacyUrl, state: 'live' }],
          addDashboard: vi.fn(),
          updateDashboard,
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit NOC' }));
    expect(screen.getByLabelText('Dashboard URL')).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'NOC Main' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Dashboard' }));

    await waitFor(() =>
      expect(updateDashboard).toHaveBeenCalledWith('dt_1', { name: 'NOC Main', url: legacyUrl }),
    );
  });

  it('cancels Dynatrace dashboard editing without updating the dashboard', () => {
    const updateDashboard = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [
            {
              id: 'dt_1',
              name: 'NOC',
              url: 'https://abc.live.dynatrace.com/dashboard',
              state: 'live',
            },
          ],
          addDashboard: vi.fn(),
          updateDashboard,
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit NOC' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Edit' }));

    expect(screen.getByLabelText('Dashboard name')).toHaveValue('');
    expect(screen.getByLabelText('Dashboard URL')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Add Dashboard' })).toBeInTheDocument();
    expect(updateDashboard).not.toHaveBeenCalled();
  });

  it('clears the Dynatrace session from its own section only after confirmation', async () => {
    const clearSession = vi.fn().mockResolvedValue(true);

    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [],
          addDashboard: vi.fn(),
          updateDashboard: vi.fn(),
          removeDashboard: vi.fn(),
          openDashboard: vi.fn(),
          clearSession,
        }}
      />,
    );

    const clearButton = screen.getByRole('button', { name: 'Clear Dynatrace Session' });
    expect(clearButton.closest('form')).toBeNull();
    expect(screen.getByText('Dynatrace session')).toBeInTheDocument();

    fireEvent.click(clearButton);
    expect(screen.getByText('Clear Dynatrace session?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(clearSession).not.toHaveBeenCalled();
    expect(screen.queryByText('Clear Dynatrace session?')).not.toBeInTheDocument();

    fireEvent.click(clearButton);
    fireEvent.click(screen.getByRole('button', { name: 'Clear Session' }));

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledOnce();
    });
  });

  it('does not call local Dynatrace state setters after unmounting during async actions', async () => {
    const addDashboard = createDeferred<boolean>();
    const removeDashboard = createDeferred<boolean>();
    const clearSession = createDeferred<boolean>();
    const postUnmountStateUpdate = vi.fn();
    let isUnmounted = false;

    vi.resetModules();
    vi.doMock('react', async (importOriginal) => {
      // The ESM namespace Vitest hands back also carries the CJS default export,
      // which `typeof import('react')` alone does not describe.
      const actual = await importOriginal<
        typeof import('react') & { default: typeof import('react') }
      >();

      return {
        ...actual,
        default: actual.default,
        useState: <S,>(initialState: S | (() => S)) => {
          const [value, setValue] = actual.useState(initialState);
          const guardedSetValue: typeof setValue = (nextValue) => {
            if (isUnmounted) postUnmountStateUpdate();
            return setValue(nextValue);
          };
          return [value, guardedSetValue];
        },
      };
    });

    try {
      const { SettingsModal: InstrumentedSettingsModal } = await import('../SettingsModal');
      const addRender = render(
        <InstrumentedSettingsModal
          {...defaultProps}
          dynatrace={{
            dashboards: [],
            addDashboard: vi.fn().mockReturnValue(addDashboard.promise),
            updateDashboard: vi.fn(),
            removeDashboard: vi.fn(),
            openDashboard: vi.fn(),
            clearSession: vi.fn(),
          }}
        />,
      );

      fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'NOC' } });
      fireEvent.change(screen.getByLabelText('Dashboard URL'), {
        target: { value: 'https://abc.live.dynatrace.com/dashboard' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add Dashboard' }));

      addRender.unmount();
      isUnmounted = true;
      addDashboard.resolve(true);
      await addDashboard.promise;
      await Promise.resolve();

      isUnmounted = false;
      const removeRender = render(
        <InstrumentedSettingsModal
          {...defaultProps}
          dynatrace={{
            dashboards: [
              {
                id: 'dt_1',
                name: 'NOC',
                url: 'https://abc.live.dynatrace.com/dashboard',
                state: 'live',
              },
            ],
            addDashboard: vi.fn(),
            updateDashboard: vi.fn(),
            removeDashboard: vi.fn().mockReturnValue(removeDashboard.promise),
            openDashboard: vi.fn(),
            clearSession: vi.fn(),
          }}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit NOC' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove NOC' }));

      removeRender.unmount();
      isUnmounted = true;
      removeDashboard.resolve(true);
      await removeDashboard.promise;
      await Promise.resolve();

      isUnmounted = false;
      const clearRender = render(
        <InstrumentedSettingsModal
          {...defaultProps}
          dynatrace={{
            dashboards: [],
            addDashboard: vi.fn(),
            updateDashboard: vi.fn(),
            removeDashboard: vi.fn(),
            openDashboard: vi.fn(),
            clearSession: vi.fn().mockReturnValue(clearSession.promise),
          }}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Clear Dynatrace Session' }));
      fireEvent.click(screen.getByRole('button', { name: 'Clear Session' }));

      clearRender.unmount();
      isUnmounted = true;
      clearSession.resolve(true);
      await clearSession.promise;
      await Promise.resolve();

      expect(postUnmountStateUpdate).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('react');
      vi.resetModules();
    }
  });

  it('hides the Workstation tab when keep-awake is unsupported on this machine', async () => {
    mockApi.getWorkstationAwakeState.mockResolvedValue({
      supported: false,
      enabled: false,
      status: 'unsupported',
    });
    render(<SettingsModal {...defaultProps} presentation="page" />);

    await waitFor(() => expect(mockApi.getWorkstationAwakeState).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.getByRole('tab', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Workstation' })).toBeNull();
  });

  it('keeps unsaved Relay Web edits when switching Settings tabs', async () => {
    render(<SettingsModal {...defaultProps} presentation="page" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Relay Data' }));
    const port = await screen.findByRole('spinbutton', { name: 'Browser port' });
    await waitFor(() => expect(port).toHaveValue(8091));
    fireEvent.change(port, { target: { value: '8099' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Relay Data' }));

    expect(screen.getByRole('spinbutton', { name: 'Browser port' })).toHaveValue(8099);
    expect(mockApi.getWebServerState).toHaveBeenCalledOnce();
  });

  it('offers Undo after removing a Dynatrace dashboard', async () => {
    const removeDashboard = vi.fn().mockResolvedValue(true);
    const addDashboard = vi.fn().mockResolvedValue(true);
    render(
      <SettingsModal
        {...defaultProps}
        dynatrace={{
          dashboards: [
            {
              id: 'dt_1',
              name: 'NOC',
              url: 'https://abc.live.dynatrace.com/dashboard',
              state: 'live',
            },
          ],
          addDashboard,
          updateDashboard: vi.fn(),
          removeDashboard,
          openDashboard: vi.fn(),
          clearSession: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove NOC' }));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledOnce());
    const [message, type, options] = mockShowToast.mock.calls[0]!;
    expect(message).toBe('Removed NOC');
    expect(type).toBe('info');
    expect(options.action.label).toBe('Undo');
    options.action.onClick();
    expect(addDashboard).toHaveBeenCalledWith({
      name: 'NOC',
      url: 'https://abc.live.dynatrace.com/dashboard',
    });
  });

  it('sends server Dynatrace configuration to Access sign-in when Administration is unavailable', async () => {
    mockUsePrivilegedAccess.mockReturnValue({ session: { state: 'signed-out', role: null } });
    render(<SettingsModal {...defaultProps} presentation="page" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dynatrace' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Sign In to Administration' }));

    expect(screen.getByRole('tab', { name: 'Access' })).toHaveAttribute('aria-selected', 'true');
  });
});
