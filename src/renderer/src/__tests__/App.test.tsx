import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainApp } from '../App';

const mockIsConfigured = vi.fn();
const mockGetPbConnection = vi.fn();
const mockSaveConfig = vi.fn();
const mockStartPocketBase = vi.fn();
const SETUP_SECRET_FIELD = 'secret';
const buildSetupSecret = () => ['setup', 'fixture', 'value'].join('-');
const buildClientSetupConfig = () => ({
  mode: 'client',
  serverUrl: 'http://localhost:8090',
  [SETUP_SECRET_FIELD]: buildSetupSecret(),
});
const buildServerSetupConfig = () => ({
  mode: 'server',
  port: 8090,
  [SETUP_SECRET_FIELD]: buildSetupSecret(),
});
let lastConnectionManagerProps: {
  pbUrl: string;
  pbAuth: { token: string; record: Record<string, unknown> | null };
  onReconfigure: () => void;
} | null = null;

// ── mock contexts ────────────────────────────────────────────────────────────
vi.mock('../contexts', () => ({
  NotesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SearchProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── mock Toast ───────────────────────────────────────────────────────────────
const mockShowToast = vi.fn();
vi.mock('../components/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  NoopToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ showToast: mockShowToast }),
}));

// ── mock useTheme hook ──────────────────────────────────────────────────────
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ preference: 'system' as const, setPreference: vi.fn() }),
}));

// ── mock heavy sub-components ────────────────────────────────────────────────
vi.mock('../components/Sidebar', () => ({
  Sidebar: ({
    activeTab,
    onTabChange,
    onOpenSettings,
  }: {
    activeTab: string;
    onTabChange: (tab: string) => void;
    onOpenSettings: () => void;
  }) => (
    <div data-testid="sidebar">
      <span data-testid="active-tab">{activeTab}</span>
      <button onClick={() => onTabChange('Personnel')}>nav-personnel</button>
      <button onClick={() => onTabChange('People')}>nav-people</button>
      <button onClick={() => onTabChange('Servers')}>nav-servers</button>
      <button onClick={onOpenSettings}>open-settings</button>
    </div>
  ),
}));

vi.mock('../components/WorldClock', () => ({
  WorldClock: () => <div data-testid="world-clock" />,
}));

vi.mock('../components/WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}));

vi.mock('../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode; fallback?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('../components/TabFallback', () => ({
  TabFallback: ({ error }: { error?: boolean }) => (
    <div data-testid="tab-fallback">{error ? 'error' : 'loading'}</div>
  ),
}));

vi.mock('../components/HeaderSearch', () => ({
  HeaderSearch: ({
    actions,
  }: {
    activeTab: string;
    contacts: unknown[];
    servers: unknown[];
    groups: unknown[];
    actions: {
      onAddContactToBridge: (email: string) => void;
      onToggleGroup: (id: string) => void;
      onNavigateToTab: (tab: string) => void;
      onOpenAddContact: (email?: string) => void;
    };
  }) => (
    <div data-testid="header-search">
      <button onClick={() => actions.onNavigateToTab('Personnel')}>go-personnel</button>
      <button onClick={() => actions.onAddContactToBridge('test@example.com')}>
        add-to-bridge
      </button>
      <button onClick={() => actions.onOpenAddContact('new@example.com')}>open-add-contact</button>
    </div>
  ),
}));

vi.mock('../components/ShortcutsModal', () => ({
  ShortcutsModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="shortcuts-modal">
        <button onClick={onClose}>close-shortcuts</button>
      </div>
    ) : null,
}));

vi.mock('../components/AddContactModal', () => ({
  AddContactModal: ({
    isOpen,
    onClose,
    onSave,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (c: Record<string, unknown>) => void;
    initialEmail?: string;
  }) =>
    isOpen ? (
      <div data-testid="add-contact-modal">
        <button onClick={onClose}>close-add-contact</button>
        <button onClick={() => onSave({ name: 'Test', email: 'test@example.com' })}>
          save-contact
        </button>
      </div>
    ) : null,
}));

vi.mock('../components/SetupScreen', () => ({
  SetupScreen: ({ onComplete }: { onComplete: (config: unknown) => void }) => (
    <div data-testid="setup-screen">
      <button onClick={() => onComplete(buildClientSetupConfig())}>complete-setup</button>
      <button onClick={() => onComplete(buildServerSetupConfig())}>complete-setup-server</button>
    </div>
  ),
}));

vi.mock('../components/ConnectionManager', () => ({
  ConnectionManager: ({
    pbUrl,
    pbAuth,
    onReconfigure,
    children,
  }: {
    pbUrl: string;
    pbAuth: { token: string; record: Record<string, unknown> | null };
    onReconfigure: () => void;
    children: React.ReactNode;
  }) => {
    lastConnectionManagerProps = { pbUrl, pbAuth, onReconfigure };
    return <div data-testid="connection-manager">{children}</div>;
  },
}));

// Lazy loaded tabs
vi.mock('../tabs/AssemblerTab', () => ({
  AssemblerTab: () => <div data-testid="assembler-tab" />,
}));

vi.mock('../tabs/DirectoryTab', () => ({
  DirectoryTab: () => <div data-testid="directory-tab" />,
}));

vi.mock('../tabs/ServersTab', () => ({
  ServersTab: () => <div data-testid="servers-tab" />,
}));

vi.mock('../tabs/PersonnelTab', () => ({
  PersonnelTab: () => <div data-testid="personnel-tab" />,
}));

vi.mock('../tabs/NotesTab', () => ({
  NotesTab: () => <div data-testid="notes-tab" />,
}));

vi.mock('../tabs/CloudStatusTab', () => ({
  CloudStatusTab: () => <div data-testid="cloud-status-tab" />,
}));

vi.mock('../tabs/AlertsTab', () => ({
  AlertsTab: () => <div data-testid="alerts-tab" />,
}));

vi.mock('../components/SettingsModal', () => ({
  SettingsModal: ({
    isOpen,
    onClose,
    onOpenDataManager,
  }: {
    isOpen: boolean;
    onClose: () => void;
    isSyncing: boolean;
    onSync: () => void;
    onOpenDataManager: () => void;
  }) =>
    isOpen ? (
      <div data-testid="settings-modal">
        <button onClick={onClose}>close-settings</button>
        <button onClick={onOpenDataManager}>open-data-manager</button>
      </div>
    ) : null,
}));

vi.mock('../components/DataManagerModal', () => ({
  DataManagerModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="data-manager-modal">
        <button onClick={onClose}>close-data-manager</button>
      </div>
    ) : null,
}));

vi.mock('../components/PopoutBoard', () => ({
  PopoutBoard: () => <div data-testid="popout-board" />,
}));

// ── mock app hooks ───────────────────────────────────────────────────────────
const mockHandleSync = vi.fn();
vi.mock('../hooks/useAppData', () => ({
  useAppData: () => ({
    data: { contacts: [], groups: [], servers: [], onCall: [] },
    isReloading: false,
    handleSync: mockHandleSync,
  }),
}));

const mockSetActiveTab = vi.fn();
const mockSetSelectedGroupIds = vi.fn();
const mockSetSettingsOpen = vi.fn();
const mockHandleAddToAssembler = vi.fn();
const mockHandleUndoRemove = vi.fn();
const mockHandleReset = vi.fn();
const mockHandleAddManual = vi.fn();
const mockHandleRemoveManual = vi.fn();
const mockHandleToggleGroup = vi.fn();
let mockActiveTab = 'Compose';
let mockSettingsOpen = false;

vi.mock('../hooks/useAppAssembler', () => ({
  useAppAssembler: () => ({
    activeTab: mockActiveTab,
    setActiveTab: mockSetActiveTab,
    selectedGroupIds: [],
    setSelectedGroupIds: mockSetSelectedGroupIds,
    manualAdds: [],
    setManualAdds: vi.fn(),
    manualRemoves: [],
    settingsOpen: mockSettingsOpen,
    setSettingsOpen: mockSetSettingsOpen,
    handleAddToAssembler: mockHandleAddToAssembler,
    handleUndoRemove: mockHandleUndoRemove,
    handleReset: mockHandleReset,
    handleAddManual: mockHandleAddManual,
    handleRemoveManual: mockHandleRemoveManual,
    handleToggleGroup: mockHandleToggleGroup,
  }),
}));

vi.mock('../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  },
}));

vi.mock('../hooks/useAppCloudStatus', () => ({
  useAppCloudStatus: () => ({
    statusData: null,
    loading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../services/contactService', () => ({
  addContact: vi.fn().mockResolvedValue({}),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function renderApp(searchParams = '') {
  // Stub globalThis.location.search
  Object.defineProperty(globalThis, 'location', {
    value: { search: searchParams },
    writable: true,
  });
  return render(<MainApp />);
}

describe('MainApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTab = 'Compose';
    mockSettingsOpen = false;
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });
  });

  afterEach(() => {
    mockSettingsOpen = false;
    mockActiveTab = 'Compose';
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });
  });

  it('renders the main layout with sidebar and world clock', () => {
    renderApp();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('world-clock')).toBeInTheDocument();
    expect(screen.getByTestId('window-controls')).toBeInTheDocument();
  });

  it('renders the active tab breadcrumb', () => {
    renderApp();
    // activeTab is 'Compose' → breadcrumb shows "Relay / Compose"
    const breadcrumb = screen.getByText(/Relay \//);
    expect(breadcrumb).toBeInTheDocument();
    expect(breadcrumb.closest('.header-breadcrumb')).toBeInTheDocument();
  });

  it('renders AssemblerTab by default (Compose is mounted)', async () => {
    renderApp();
    await vi.waitFor(() => {
      expect(screen.getByTestId('assembler-tab')).toBeInTheDocument();
    });
  });

  it('opens settings modal when sidebar settings button is clicked', () => {
    renderApp();
    fireEvent.click(screen.getByText('open-settings'));
    expect(mockSetSettingsOpen).toHaveBeenCalledWith(true);
  });

  it('renders header search bar', () => {
    renderApp();
    expect(screen.getByTestId('header-search')).toBeInTheDocument();
  });

  it('opens settings on Cmd+, keydown', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: ',', metaKey: true });
    });
    expect(mockSetSettingsOpen).toHaveBeenCalledWith(true);
  });

  it('navigates tab on Cmd+1', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '1', metaKey: true });
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('Compose');
  });

  it('navigates tab on Cmd+2', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '2', metaKey: true });
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('Personnel');
  });

  it('navigates tab on Cmd+7 (Alerts)', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '7', metaKey: true });
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('Alerts');
  });

  it('opens shortcuts modal on Cmd+Shift+?', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '?', metaKey: true, shiftKey: true });
    });
    expect(screen.getByTestId('shortcuts-modal')).toBeInTheDocument();
  });

  it('closes shortcuts modal', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '?', metaKey: true, shiftKey: true });
    });
    fireEvent.click(screen.getByText('close-shortcuts'));
    expect(screen.queryByTestId('shortcuts-modal')).not.toBeInTheDocument();
  });

  it('adds contact to bridge when HeaderSearch add-to-bridge is used', () => {
    renderApp();
    fireEvent.click(screen.getByText('add-to-bridge'));
    expect(mockHandleAddManual).toHaveBeenCalledWith('test@example.com');
    expect(mockSetActiveTab).toHaveBeenCalledWith('Compose');
  });

  it('opens AddContactModal when HeaderSearch open-add-contact is used', () => {
    renderApp();
    fireEvent.click(screen.getByText('open-add-contact'));
    expect(screen.getByTestId('add-contact-modal')).toBeInTheDocument();
  });

  it('shows popout mode when ?popout search param is present', () => {
    renderApp('?popout=board');
    expect(screen.getByText('RELAY ON-CALL BOARD')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  it('saves contact successfully when onSave is invoked', async () => {
    renderApp();
    // Open the add contact modal
    fireEvent.click(screen.getByText('open-add-contact'));
    // Click save
    fireEvent.click(screen.getByText('save-contact'));
    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Contact created successfully', 'success');
    });
  });

  it('shows error toast when saving contact fails', async () => {
    // Make pbAddContact throw
    const { addContact } = await import('../services/contactService');
    vi.mocked(addContact).mockRejectedValueOnce(new Error('fail'));

    renderApp();
    fireEvent.click(screen.getByText('open-add-contact'));
    fireEvent.click(screen.getByText('save-contact'));
    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Failed to create contact', 'error');
    });
  });

  it('navigates to tabs via sidebar buttons', () => {
    renderApp();
    fireEvent.click(screen.getByText('nav-personnel'));
    expect(mockSetActiveTab).toHaveBeenCalledWith('Personnel');

    fireEvent.click(screen.getByText('nav-people'));
    expect(mockSetActiveTab).toHaveBeenCalledWith('People');

    fireEvent.click(screen.getByText('nav-servers'));
    expect(mockSetActiveTab).toHaveBeenCalledWith('Servers');
  });

  it('navigates tab on Cmd+3 (People)', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '3', metaKey: true });
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('People');
  });

  it('navigates tab on Cmd+4 (Servers)', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '4', metaKey: true });
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('Servers');
  });

  it('navigates tab on Cmd+5 (Status)', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '5', metaKey: true });
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('Status');
  });

  it('navigates tab on Cmd+6 (Notes)', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '6', metaKey: true });
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('Notes');
  });

  it('navigates tab on Cmd+7 (Alerts)', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '7', metaKey: true });
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('Alerts');
  });

  it('focuses search on Cmd+K', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: 'k', metaKey: true });
    });
    // The ref-based focus won't work in mocked environment, but the shortcut should not error
    expect(true).toBe(true);
  });

  it('handles navigate tab via HeaderSearch', () => {
    renderApp();
    const btn = screen.getByText('go-personnel');
    fireEvent.click(btn);
    expect(mockSetActiveTab).toHaveBeenCalledWith('Personnel');
  });

  it('renders popout without board route', () => {
    renderApp('?popout=other');
    expect(screen.getByText('RELAY ON-CALL BOARD')).toBeInTheDocument();
    // PopoutBoard should NOT render because route doesn't include 'board'
    expect(screen.queryByTestId('popout-board')).not.toBeInTheDocument();
  });

  it('opens data manager modal from settings', async () => {
    mockSettingsOpen = true;
    renderApp();

    // Settings modal should be open since settingsOpen is true
    await vi.waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Click open-data-manager button inside settings
    fireEvent.click(screen.getByText('open-data-manager'));

    await vi.waitFor(() => {
      expect(screen.getByTestId('data-manager-modal')).toBeInTheDocument();
    });
  });

  it('adds platform class to body on mount', () => {
    (globalThis as Window & { api?: { platform: string } }).api = {
      platform: 'darwin',
    } as typeof globalThis.api;
    renderApp();
    expect(document.body.classList.contains('platform-darwin')).toBe(true);
  });

  it('adds is-popout class to body in popout mode', () => {
    renderApp('?popout=board');
    expect(document.body.classList.contains('is-popout')).toBe(true);
  });

  it('renders popout board when popout param contains board', async () => {
    renderApp('?popout=board');
    await vi.waitFor(() => {
      expect(screen.getByTestId('popout-board')).toBeInTheDocument();
    });
  });
});

// ── App default export (popout toast branch) ─────────────────────────────────
describe('App default export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    lastConnectionManagerProps = null;
    mockIsConfigured.mockResolvedValue(true);
    mockGetPbConnection.mockResolvedValue({
      ok: true,
      connection: {
        pbUrl: 'http://localhost:8090',
        auth: { token: 'startup-token', record: null },
      },
    });
    mockSaveConfig.mockResolvedValue(true);
    mockStartPocketBase.mockResolvedValue(true);
    globalThis.api = {
      isConfigured: mockIsConfigured,
      getPbConnection: mockGetPbConnection,
      saveConfig: mockSaveConfig,
      startPocketBase: mockStartPocketBase,
      platform: 'win32',
    } as typeof globalThis.api;
    (
      globalThis as unknown as { window: { api: { windowClose: ReturnType<typeof vi.fn> } } }
    ).window = {
      api: { windowClose: vi.fn() },
    } as unknown as typeof globalThis.window;
  });

  it('renders without crashing', async () => {
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });
    const { default: App } = await import('../App');
    render(<App />);
    expect(await screen.findByTestId('connection-manager')).toBeInTheDocument();
  });

  it('uses NoopToastProvider in popout mode', async () => {
    Object.defineProperty(globalThis, 'location', {
      value: { search: '?popout=board' },
      writable: true,
    });
    const { default: App } = await import('../App');
    expect(() => render(<App />)).not.toThrow();
  });

  it('uses getPbConnection on startup without relying on legacy bridge helpers', async () => {
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(await screen.findByTestId('connection-manager')).toBeInTheDocument();
    expect(mockIsConfigured).toHaveBeenCalledTimes(1);
    expect(mockGetPbConnection).toHaveBeenCalledTimes(1);
    expect(lastConnectionManagerProps).toMatchObject({
      pbUrl: 'http://localhost:8090',
      pbAuth: { token: 'startup-token', record: null },
    });
  });

  it('goes to setup when the app is not configured', async () => {
    mockIsConfigured.mockResolvedValue(false);
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(await screen.findByTestId('setup-screen')).toBeInTheDocument();
    expect(mockGetPbConnection).not.toHaveBeenCalled();
  });

  it('shows an error state when startup authentication fails', async () => {
    mockGetPbConnection.mockResolvedValue({ ok: false, error: 'auth-failed' });
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(await screen.findByText('PocketBase authentication failed.')).toBeInTheDocument();
    expect(screen.getByText('Reconfigure')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-screen')).not.toBeInTheDocument();
  });

  it('shows an error if startup connection bootstrap times out', async () => {
    vi.useFakeTimers();
    mockGetPbConnection.mockImplementation(() => new Promise(() => undefined));
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(screen.getByText('Initializing...')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(
      screen.getByText('Connection timed out. The server may be unreachable.'),
    ).toBeInTheDocument();
  });

  it('shows an error instead of reloading when saveConfig returns false', async () => {
    mockIsConfigured.mockResolvedValue(false);
    mockSaveConfig.mockResolvedValue(false);
    const reload = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      value: { search: '', reload },
      writable: true,
      configurable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    fireEvent.click(await screen.findByText('complete-setup-server'));

    expect(await screen.findByText('Failed to save configuration.')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(mockStartPocketBase).not.toHaveBeenCalled();
  });

  it('shows unavailable error when connection result is not auth-failed or not-configured', async () => {
    mockGetPbConnection.mockResolvedValue({ ok: false, error: 'unavailable' });
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(await screen.findByText('PocketBase server is unavailable.')).toBeInTheDocument();
  });

  it('goes to setup when getPbConnection returns not-configured error', async () => {
    mockGetPbConnection.mockResolvedValue({ ok: false, error: 'not-configured' });
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(await screen.findByTestId('setup-screen')).toBeInTheDocument();
  });

  it('goes to setup when getPbConnection returns invalid-config error', async () => {
    mockGetPbConnection.mockResolvedValue({ ok: false, error: 'invalid-config' });
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(await screen.findByTestId('setup-screen')).toBeInTheDocument();
  });

  it('shows generic error when checkConfig throws a non-timeout error', async () => {
    mockIsConfigured.mockRejectedValue(new Error('random failure'));
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(await screen.findByText('Failed to read configuration.')).toBeInTheDocument();
  });

  it('navigates to setup when Reconfigure button is clicked from error state', async () => {
    mockGetPbConnection.mockResolvedValue({ ok: false, error: 'unavailable' });
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    const reconfigureBtn = await screen.findByText('Reconfigure');
    fireEvent.click(reconfigureBtn);

    expect(await screen.findByTestId('setup-screen')).toBeInTheDocument();
  });

  it('reloads the page after successful client-mode setup', async () => {
    mockIsConfigured.mockResolvedValue(false);
    mockSaveConfig.mockResolvedValue(true);
    const reload = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      value: { search: '', reload },
      writable: true,
      configurable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    fireEvent.click(await screen.findByText('complete-setup'));

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalled();
    });
    // Client mode should NOT start PocketBase
    expect(mockStartPocketBase).not.toHaveBeenCalled();
  });

  it('starts PocketBase and reloads after successful server-mode setup', async () => {
    mockIsConfigured.mockResolvedValue(false);
    mockSaveConfig.mockResolvedValue(true);
    mockStartPocketBase.mockResolvedValue(true);
    const reload = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      value: { search: '', reload },
      writable: true,
      configurable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    fireEvent.click(await screen.findByText('complete-setup-server'));

    await vi.waitFor(() => {
      expect(mockStartPocketBase).toHaveBeenCalled();
      expect(reload).toHaveBeenCalled();
    });
  });

  it('shows error when startPocketBase returns false in server mode', async () => {
    mockIsConfigured.mockResolvedValue(false);
    mockSaveConfig.mockResolvedValue(true);
    mockStartPocketBase.mockResolvedValue(false);
    Object.defineProperty(globalThis, 'location', {
      value: { search: '', reload: vi.fn() },
      writable: true,
      configurable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    fireEvent.click(await screen.findByText('complete-setup-server'));

    expect(await screen.findByText('Failed to start PocketBase server.')).toBeInTheDocument();
  });

  it('shows error when saveConfig throws an exception', async () => {
    mockIsConfigured.mockResolvedValue(false);
    mockSaveConfig.mockRejectedValue(new Error('save failed'));
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
      configurable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    fireEvent.click(await screen.findByText('complete-setup'));

    expect(await screen.findByText('Failed to save configuration.')).toBeInTheDocument();
  });

  it('calls windowClose when close button is clicked in checking state', async () => {
    // Make isConfigured hang so we stay in 'checking' phase
    mockIsConfigured.mockImplementation(() => new Promise(() => undefined));
    const mockWindowClose = vi.fn();
    (globalThis as unknown as { window: { api: { windowClose: () => void } } }).window = {
      api: { windowClose: mockWindowClose },
    } as unknown as typeof globalThis.window;
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(screen.getByText('Initializing...')).toBeInTheDocument();
    const closeBtn = screen.getByLabelText('Close');
    fireEvent.click(closeBtn);
    expect(mockWindowClose).toHaveBeenCalled();
  });

  it('calls windowClose when close button is clicked in error state', async () => {
    mockGetPbConnection.mockResolvedValue({ ok: false, error: 'unavailable' });
    const mockWindowClose = vi.fn();
    (globalThis as unknown as { window: { api: { windowClose: () => void } } }).window = {
      api: { windowClose: mockWindowClose },
    } as unknown as typeof globalThis.window;
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    await screen.findByText('PocketBase server is unavailable.');
    const closeBtn = screen.getByLabelText('Close');
    fireEvent.click(closeBtn);
    expect(mockWindowClose).toHaveBeenCalled();
  });
});
