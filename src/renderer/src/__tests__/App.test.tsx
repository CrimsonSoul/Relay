import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainApp, RetainedTabPanel } from '../App';
import type { DynatraceDashboardInput, DynatraceDashboardState } from '@shared/dynatrace';
import {
  acknowledgeKnowledgeDestinationOpen,
  getPendingKnowledgeDestinationOpen,
  OPEN_KNOWLEDGE_DESTINATION_EVENT,
} from '../features/knowledge/knowledgeWorkspaceNavigation';
import {
  acknowledgeKnowledgeDocumentOpen,
  getPendingKnowledgeDocumentOpen,
  OPEN_KNOWLEDGE_DOCUMENT_EVENT,
  type KnowledgeOpenRequest,
} from '../features/knowledge/knowledgeNavigation';
import type {
  KnowledgeRecordOpenRequest,
  KnowledgeRecordTarget,
} from '../features/knowledge/knowledgeRecordNavigation';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import type { BridgeAPI, CloudStatusProvider } from '@shared/ipc';

const mockIsConfigured = vi.fn();
const mockGetConfig = vi.fn();
const mockGetPbConnection = vi.fn();
const mockSaveConfig = vi.fn();
const mockStartPocketBase = vi.fn();
const mockRelaunchApp = vi.fn();
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
const LAN_SERVER_ADDRESS = ['192', '168', '1', '25'].join('.');
const LAN_SERVER_LABEL = ['LAN ', LAN_SERVER_ADDRESS, ':8090'].join('');
const LAN_SERVER_URL = ['http', '://', 'noc-admin-pc', ':8090'].join('');
let lastConnectionManagerProps: {
  pbUrl: string;
  pbAuth: { token: string; record: Record<string, unknown> | null } | null;
  offlineMode?: boolean;
  onReconfigure: () => void;
} | null = null;
let lastSidebarProps: {
  relayMode?: 'server' | 'client';
  dynatraceDashboards?: DynatraceDashboardState[];
  onOpenDynatraceDashboard?: (id: string) => void | Promise<void>;
} | null = null;
let lastSettingsModalProps: {
  dynatrace?: {
    dashboards: DynatraceDashboardState[];
    addDashboard: (input: DynatraceDashboardInput) => Promise<boolean>;
    updateDashboard: (id: string, input: DynatraceDashboardInput) => Promise<boolean>;
    removeDashboard: (id: string) => Promise<boolean>;
    openDashboard: (id: string) => Promise<boolean>;
    clearSession: () => Promise<boolean>;
  };
} | null = null;
let lastDataManagerModalProps: { isOpen: boolean } | null = null;
let lastPersonnelTabProps: {
  onCallFontScale?: number;
  onOnCallFontScaleChange?: (scale: number) => void;
} | null = null;
let lastKnowledgeWorkspaceProps: {
  active: boolean;
  relayMode?: string;
  contacts: unknown[];
  groups: unknown[];
  servers: unknown[];
  onAddToAssembler: (contact: never) => void;
  recordOpenRequest?: KnowledgeRecordOpenRequest | null;
  onRecordUnavailable?: (request: KnowledgeRecordOpenRequest) => void;
} | null = null;
let lastCloudStatusTabProps: {
  selectedProvider?: CloudStatusProvider | null;
  onSelectedProviderChange?: (provider: CloudStatusProvider | null) => void;
} | null = null;
let lastDynatraceProblemsProps: {
  relayMode?: string;
  active?: boolean;
} | null = null;
let lastCloudStatusOpenProvider: ((provider: CloudStatusProvider) => void) | undefined;
const mockDynatraceDashboards: DynatraceDashboardState[] = [
  {
    id: 'dt_1',
    name: 'NOC',
    url: 'https://abc.live.dynatrace.com/dashboard',
    state: 'live',
  },
];
const mockAddDynatraceDashboard = vi.fn();
const mockUpdateDynatraceDashboard = vi.fn();
const mockRemoveDynatraceDashboard = vi.fn();
const mockOpenDynatraceDashboard = vi.fn();
const mockClearDynatraceSession = vi.fn();
const mockRefreshDynatraceDashboards = vi.fn();
const mockDynatraceHookState = {
  dashboards: mockDynatraceDashboards,
  loading: false,
  error: null,
  refresh: mockRefreshDynatraceDashboards,
  addDashboard: mockAddDynatraceDashboard,
  updateDashboard: mockUpdateDynatraceDashboard,
  removeDashboard: mockRemoveDynatraceDashboard,
  openDashboard: mockOpenDynatraceDashboard,
  clearSession: mockClearDynatraceSession,
};
const mockUseDynatraceDashboards = vi.fn(() => mockDynatraceHookState);

// ── mock contexts ────────────────────────────────────────────────────────────
vi.mock('../contexts', () => ({
  NotesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SearchProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PrivilegedAccessProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="privileged-access-provider">{children}</div>
  ),
}));

// ── mock Toast ───────────────────────────────────────────────────────────────
const mockShowToast = vi.fn();
vi.mock('../components/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  NoopToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ showToast: mockShowToast }),
}));

// ── mock heavy sub-components ────────────────────────────────────────────────
vi.mock('../components/Sidebar', () => ({
  Sidebar: ({
    activeTab,
    onTabChange,
    onOpenSettings,
    relayMode,
    dynatraceDashboards,
    onOpenDynatraceDashboard,
  }: {
    activeTab: string;
    onTabChange: (tab: string) => void;
    onOpenSettings: () => void;
    relayMode?: 'server' | 'client';
    dynatraceDashboards?: DynatraceDashboardState[];
    onOpenDynatraceDashboard?: (id: string) => void | Promise<void>;
  }) =>
    (() => {
      lastSidebarProps = {
        relayMode,
        dynatraceDashboards,
        onOpenDynatraceDashboard,
      };
      return (
        <div data-testid="sidebar">
          <span data-testid="active-tab">{activeTab}</span>
          <button onClick={() => onTabChange('Personnel')}>nav-personnel</button>
          <button onClick={() => onTabChange('People')}>nav-people</button>
          <button onClick={() => onTabChange('Servers')}>nav-servers</button>
          <button onClick={() => onTabChange('Notes')}>nav-notes</button>
          <button onClick={onOpenSettings}>open-settings</button>
        </div>
      );
    })(),
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
      onOpenKnowledgeDestination: (destination: 'wiki' | 'contacts' | 'servers') => void;
      onOpenKnowledgeRecord: (target: KnowledgeRecordTarget) => void;
      onOpenAddContact: (email?: string) => void;
      onOpenKnowledgeDocument: (request: KnowledgeOpenRequest) => void;
    };
  }) => (
    <div data-testid="header-search">
      <button onClick={() => actions.onNavigateToTab('Personnel')}>go-personnel</button>
      <button onClick={() => actions.onAddContactToBridge('test@example.com')}>
        add-to-bridge
      </button>
      <button onClick={() => actions.onOpenAddContact('new@example.com')}>open-add-contact</button>
      <button
        onClick={() =>
          actions.onOpenKnowledgeDocument({
            documentId: 'kb-1',
            headingId: 'failover',
            pageIndex: 3,
            highlightText: 'failover',
            normalizedStart: 48,
            normalizedEnd: 56,
          })
        }
      >
        open-knowledge
      </button>
      <button onClick={() => actions.onOpenKnowledgeDestination('contacts')}>go-contacts</button>
      <button onClick={() => actions.onOpenKnowledgeDestination('servers')}>go-servers</button>
      <button
        onClick={() =>
          actions.onOpenKnowledgeRecord({ destination: 'contacts', recordKey: 'id:contact_1' })
        }
      >
        open-contact-record
      </button>
      <button
        onClick={() =>
          actions.onOpenKnowledgeRecord({ destination: 'servers', recordKey: 'id:server_1' })
        }
      >
        open-server-record
      </button>
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
    offlineMode,
    onReconfigure,
    children,
  }: {
    pbUrl: string;
    pbAuth: { token: string; record: Record<string, unknown> | null } | null;
    offlineMode?: boolean;
    onReconfigure: () => void;
    children: React.ReactNode;
  }) => {
    lastConnectionManagerProps = { pbUrl, pbAuth, offlineMode, onReconfigure };
    return <div data-testid="connection-manager">{children}</div>;
  },
}));

vi.mock('../components/AlertReminderManager', () => ({
  AlertReminderManager: () => <div data-testid="alert-reminder-manager" />,
}));

vi.mock('../components/DynatraceProblemNotificationManager', () => ({
  DynatraceProblemNotificationManager: () => (
    <div data-testid="dynatrace-problem-notification-manager" />
  ),
}));

vi.mock('../components/RadarQueueNotificationManager', () => ({
  RadarQueueNotificationManager: ({ onOpenRadar }: { onOpenRadar: () => void }) => (
    <button data-testid="radar-queue-notification-manager" onClick={onOpenRadar}>
      Open Radar notification
    </button>
  ),
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
  PersonnelTab: ({
    onCallFontScale,
    onOnCallFontScaleChange,
  }: {
    onCallFontScale?: number;
    onOnCallFontScaleChange?: (scale: number) => void;
  }) => {
    lastPersonnelTabProps = { onCallFontScale, onOnCallFontScaleChange };
    return <div data-testid="personnel-tab" />;
  },
}));

vi.mock('../features/knowledge/KnowledgeWorkspace', () => ({
  KnowledgeWorkspace: (props: NonNullable<typeof lastKnowledgeWorkspaceProps>) => {
    lastKnowledgeWorkspaceProps = props;
    return (
      <div
        data-testid="knowledge-workspace"
        data-active={props.active}
        data-relay-mode={props.relayMode}
      />
    );
  },
}));

vi.mock('../tabs/CloudStatusTab', () => ({
  CloudStatusTab: (props: NonNullable<typeof lastCloudStatusTabProps>) => {
    lastCloudStatusTabProps = props;
    return <div data-testid="cloud-status-tab" />;
  },
}));

vi.mock('../tabs/DynatraceProblemsTab', () => ({
  DynatraceProblemsTab: (props: NonNullable<typeof lastDynatraceProblemsProps>) => {
    lastDynatraceProblemsProps = props;
    return <div data-testid="dynatrace-problems-tab" data-active={props.active} />;
  },
}));

vi.mock('../tabs/AlertsTab', () => ({
  AlertsTab: () => <div data-testid="alerts-tab" />,
}));

vi.mock('../components/SettingsModal', () => ({
  SettingsModal: ({
    isOpen,
    onClose,
    onOpenDataManager,
    dynatrace,
  }: {
    isOpen: boolean;
    onClose: () => void;
    isSyncing: boolean;
    onSync: () => void;
    onOpenDataManager: () => void;
    dynatrace?: typeof mockDynatraceHookState;
  }) =>
    (() => {
      lastSettingsModalProps = { dynatrace };
      return isOpen ? (
        <div data-testid="settings-tab">
          <button onClick={onClose}>close-settings</button>
          <button onClick={onOpenDataManager}>open-data-manager</button>
        </div>
      ) : null;
    })(),
}));

vi.mock('../components/DataManagerModal', () => ({
  DataManagerModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    lastDataManagerModalProps = { isOpen };
    return isOpen ? (
      <div data-testid="data-manager-modal">
        <button onClick={onClose}>close-data-manager</button>
      </div>
    ) : null;
  },
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

const { mockLoggerWarn } = vi.hoisted(() => ({ mockLoggerWarn: vi.fn() }));
vi.mock('../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: mockLoggerWarn, debug: vi.fn() },
  },
}));

vi.mock('../hooks/useAppCloudStatus', () => ({
  useAppCloudStatus: (
    _showToast: unknown,
    onOpenProvider?: (provider: CloudStatusProvider) => void,
  ) => {
    lastCloudStatusOpenProvider = onOpenProvider;
    return {
      statusData: null,
      loading: false,
      refetch: vi.fn(),
    };
  },
}));

vi.mock('../hooks/useDynatraceDashboards', () => ({
  useDynatraceDashboards: (...args: Parameters<typeof mockUseDynatraceDashboards>) =>
    mockUseDynatraceDashboards(...args),
}));

vi.mock('../services/contactService', () => ({
  addContact: vi.fn().mockResolvedValue({}),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * `globalThis.api` is typed as the complete preload bridge, but these tests only install the
 * handful of members `App` actually reaches for. `vi.stubGlobal` installs the partial without a
 * cast, while `Partial<BridgeAPI>` keeps every stubbed member checked against the real contract.
 */
function stubBridgeApi(overrides: Partial<BridgeAPI>): void {
  vi.stubGlobal('api', overrides);
}

/**
 * `App` and `WindowControls` close through `globalThis.window.api`, so these tests swap in a
 * stand-in window carrying only that bridge member. `globalThis.window` is declared as the full
 * DOM `Window`, so it has to be reached through a structural view of the global object.
 */
function stubWindowBridge(api: Pick<BridgeAPI, 'windowClose'>): void {
  (globalThis as { window: unknown }).window = { api };
}

function renderApp(searchParams = '', props: Partial<React.ComponentProps<typeof MainApp>> = {}) {
  // Stub globalThis.location.search
  Object.defineProperty(globalThis, 'location', {
    value: { search: searchParams },
    writable: true,
  });
  return render(<MainApp {...props} />);
}

describe('MainApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTab = 'Compose';
    mockSettingsOpen = false;
    lastSidebarProps = null;
    lastSettingsModalProps = null;
    lastDataManagerModalProps = null;
    lastKnowledgeWorkspaceProps = null;
    lastCloudStatusTabProps = null;
    lastDynatraceProblemsProps = null;
    lastCloudStatusOpenProvider = undefined;
    lastPersonnelTabProps = null;
    localStorage.removeItem('relay-oncall-display-size');
    localStorage.removeItem('relay-oncall-font-scale');
    acknowledgeKnowledgeDestinationOpen('wiki');
    acknowledgeKnowledgeDestinationOpen('contacts');
    acknowledgeKnowledgeDestinationOpen('servers');
    acknowledgeKnowledgeDocumentOpen('kb-1');
    mockUseDynatraceDashboards.mockReturnValue(mockDynatraceHookState);
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });
  });

  afterEach(() => {
    mockSettingsOpen = false;
    mockActiveTab = 'Compose';
    lastSidebarProps = null;
    lastSettingsModalProps = null;
    lastDataManagerModalProps = null;
    lastCloudStatusTabProps = null;
    lastDynatraceProblemsProps = null;
    lastCloudStatusOpenProvider = undefined;
    acknowledgeKnowledgeDestinationOpen('wiki');
    acknowledgeKnowledgeDestinationOpen('contacts');
    acknowledgeKnowledgeDestinationOpen('servers');
    acknowledgeKnowledgeDocumentOpen('kb-1');
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

  it('mounts Radar queue notifications in the desktop main window and opens Radar', () => {
    const previousApi = globalThis.api;
    globalThis.api = { ...previousApi, runtime: ELECTRON_RUNTIME } as typeof globalThis.api;

    try {
      renderApp();
      fireEvent.click(screen.getByTestId('radar-queue-notification-manager'));

      expect(mockSetActiveTab).toHaveBeenCalledWith('Radar');
    } finally {
      globalThis.api = previousApi;
    }
  });

  it('checks GitHub releases from the desktop main window', async () => {
    const previousApi = globalThis.api;
    const checkForUpdates = vi.fn().mockResolvedValue({
      success: true,
      data: {
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        updateAvailable: true,
      },
    });
    globalThis.api = {
      ...previousApi,
      runtime: ELECTRON_RUNTIME,
      checkForUpdates,
      openReleasesPage: vi.fn().mockResolvedValue(true),
    } as typeof globalThis.api;

    try {
      renderApp();
      const reminder = await screen.findByRole('button', {
        name: 'Relay v1.1.0 is available. View release',
      });
      expect(checkForUpdates).toHaveBeenCalledOnce();
      expect(reminder.closest('.header-actions')).not.toBeNull();
      expect(screen.getAllByRole('button', { name: /Relay v1\.1\.0 is available/u })).toHaveLength(
        1,
      );
    } finally {
      globalThis.api = previousApi;
    }
  });

  it('does not mount Radar queue notifications in a desktop popout', () => {
    const previousApi = globalThis.api;
    globalThis.api = { ...previousApi, runtime: ELECTRON_RUNTIME } as typeof globalThis.api;

    try {
      renderApp('?popout=dynatrace');

      expect(screen.queryByTestId('radar-queue-notification-manager')).not.toBeInTheDocument();
    } finally {
      globalThis.api = previousApi;
    }
  });

  it('mounts Radar queue notifications in Relay Web and opens Radar', () => {
    const previousApi = globalThis.api;
    globalThis.api = { ...previousApi, runtime: WEB_RUNTIME } as typeof globalThis.api;

    try {
      renderApp();
      fireEvent.click(screen.getByTestId('radar-queue-notification-manager'));

      expect(mockSetActiveTab).toHaveBeenCalledWith('Radar');
    } finally {
      globalThis.api = previousApi;
    }
  });

  it('renders the active tab breadcrumb', () => {
    renderApp();
    // activeTab is 'Compose' → breadcrumb shows "Relay / Compose"
    const breadcrumb = screen.getByText(/Relay \//);
    expect(breadcrumb).toBeInTheDocument();
    expect(breadcrumb.closest('.header-breadcrumb')).toBeInTheDocument();
  });

  it('marks the retained Problems tab active only while it is selected', async () => {
    mockActiveTab = 'Problems';
    const { rerender } = renderApp();

    await vi.waitFor(() => expect(lastDynatraceProblemsProps?.active).toBe(true));

    mockActiveTab = 'Compose';
    rerender(<MainApp />);
    expect(lastDynatraceProblemsProps?.active).toBe(false);

    mockActiveTab = 'Problems';
    rerender(<MainApp />);
    expect(lastDynatraceProblemsProps?.active).toBe(true);
  });

  it('renders AssemblerTab by default (Compose is mounted)', async () => {
    renderApp();
    await vi.waitFor(() => {
      expect(screen.getByTestId('assembler-tab')).toBeInTheDocument();
    });
  });

  it('does not mount closed settings or data-management surfaces at startup', () => {
    renderApp();

    expect(lastSettingsModalProps).toBeNull();
    expect(lastDataManagerModalProps).toBeNull();
  });

  it('renders Knowledge as a retained top-level tab with the correct breadcrumb', async () => {
    mockActiveTab = 'Knowledge';
    renderApp('', { relayConfig: { mode: 'server', port: 8090 } as never });

    await vi.waitFor(() => expect(screen.getByTestId('knowledge-workspace')).toBeInTheDocument());
    expect(screen.getByTestId('knowledge-workspace')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('knowledge-workspace')).toHaveAttribute('data-relay-mode', 'server');
    expect(screen.getByText('Relay / Knowledge')).toBeInTheDocument();
    expect(lastKnowledgeWorkspaceProps?.contacts).toEqual([]);
    expect(lastKnowledgeWorkspaceProps?.groups).toEqual([]);
    expect(lastKnowledgeWorkspaceProps?.servers).toEqual([]);
    expect(lastKnowledgeWorkspaceProps?.onAddToAssembler).toBe(mockHandleAddToAssembler);
  });

  it('navigates to Settings when the sidebar settings button is clicked', () => {
    renderApp();
    fireEvent.click(screen.getByText('open-settings'));
    expect(mockSetActiveTab).toHaveBeenCalledWith('Settings');
  });

  it('renders header search bar', () => {
    renderApp();
    expect(screen.getByTestId('header-search')).toBeInTheDocument();
  });

  it('durably routes a global document result to Knowledge and Wiki before activation', () => {
    const calls: string[] = [];
    const onDocument = () => calls.push('document');
    const onDestination = (event: Event) => {
      calls.push(`destination:${(event as CustomEvent).detail}`);
      expect(mockSetActiveTab).not.toHaveBeenCalled();
    };
    globalThis.addEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, onDocument);
    globalThis.addEventListener(OPEN_KNOWLEDGE_DESTINATION_EVENT, onDestination);
    renderApp();
    fireEvent.click(screen.getByText('open-knowledge'));

    expect(calls).toEqual(['document', 'destination:wiki']);
    expect(getPendingKnowledgeDocumentOpen()).toEqual({
      documentId: 'kb-1',
      headingId: 'failover',
      pageIndex: 3,
      highlightText: 'failover',
      normalizedStart: 48,
      normalizedEnd: 56,
    });
    expect(getPendingKnowledgeDestinationOpen()).toBe('wiki');
    expect(mockSetActiveTab).toHaveBeenCalledWith('Knowledge');
    globalThis.removeEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, onDocument);
    globalThis.removeEventListener(OPEN_KNOWLEDGE_DESTINATION_EVENT, onDestination);
  });

  it('mounts global alert reminders', () => {
    renderApp();
    expect(screen.getByTestId('alert-reminder-manager')).toBeInTheDocument();
  });

  it('switches to Alerts when a reminder asks to load an attached alert', () => {
    renderApp();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('relay:load-alert-reminder', {
          detail: {
            reminderId: 'rem-1',
            title: 'Stored reminder',
            severity: 'ISSUE',
            subject: 'Stored outage alert',
            bodyHtml: '<p>Stored body</p>',
            sender: 'Ops',
          },
        }),
      );
    });

    expect(mockSetActiveTab).toHaveBeenCalledWith('Alerts');
  });

  it('does not show server connection details in the main header', () => {
    renderApp('', {
      relayConfig: {
        mode: 'server',
        port: 8090,
        bindHost: '0.0.0.0',
        lanIp: LAN_SERVER_ADDRESS,
      },
    });

    expect(screen.queryByLabelText('Relay server connection details')).not.toBeInTheDocument();
    expect(screen.queryByText(LAN_SERVER_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText('Server')).not.toBeInTheDocument();
    expect(screen.queryByText('LAN access')).not.toBeInTheDocument();
    expect(screen.queryByText(LAN_SERVER_URL)).not.toBeInTheDocument();
  });

  it('does not show server connection details in client mode', () => {
    renderApp('', {
      relayConfig: {
        mode: 'client',
        serverUrl: LAN_SERVER_URL,
      },
    });

    expect(screen.queryByText(LAN_SERVER_LABEL)).not.toBeInTheDocument();
  });

  it('passes the relay mode to Sidebar', () => {
    renderApp('', {
      relayConfig: {
        mode: 'client',
        serverUrl: LAN_SERVER_URL,
      },
    });

    expect(lastSidebarProps).toMatchObject({ relayMode: 'client' });
  });

  it('passes Dynatrace dashboards and opener to Sidebar', () => {
    renderApp();

    expect(mockUseDynatraceDashboards).toHaveBeenCalledWith(mockShowToast, { enabled: true });
    expect(lastSidebarProps?.dynatraceDashboards).toBe(mockDynatraceDashboards);
    expect(lastSidebarProps?.onOpenDynatraceDashboard).toBe(mockOpenDynatraceDashboard);
  });

  it('disables Dynatrace dashboard subscriptions in popout mode', () => {
    renderApp('?popout=dynatrace');

    expect(mockUseDynatraceDashboards).toHaveBeenCalledWith(mockShowToast, { enabled: false });
  });

  it('passes the Dynatrace bundle to the Settings tab', async () => {
    mockActiveTab = 'Settings';
    renderApp();

    await vi.waitFor(() => {
      expect(screen.getByTestId('settings-tab')).toBeInTheDocument();
    });

    expect(lastSettingsModalProps?.dynatrace).toBe(mockDynatraceHookState);
  });

  it('does not pass on-call board display controls to the Settings tab', async () => {
    mockActiveTab = 'Settings';
    renderApp();

    await vi.waitFor(() => {
      expect(screen.getByTestId('settings-tab')).toBeInTheDocument();
    });

    expect('onCallFontScale' in (lastSettingsModalProps ?? {})).toBe(false);
    expect('onOnCallFontScaleChange' in (lastSettingsModalProps ?? {})).toBe(false);
  });

  it('passes and persists the selected on-call board font scale through the main board', async () => {
    localStorage.setItem('relay-oncall-font-scale', '125');
    mockActiveTab = 'Personnel';

    renderApp();

    await vi.waitFor(() => {
      expect(lastPersonnelTabProps?.onCallFontScale).toBe(125);
    });

    act(() => {
      lastPersonnelTabProps?.onOnCallFontScaleChange?.(115);
    });

    expect(localStorage.getItem('relay-oncall-font-scale')).toBe('115');
    expect(lastPersonnelTabProps?.onCallFontScale).toBe(115);
  });

  it('opens settings on Cmd+, keydown', () => {
    renderApp();
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(mockSetActiveTab).toHaveBeenCalledWith('Settings');
  });

  it.each([
    ['1', 'Compose'],
    ['2', 'Alerts'],
    ['3', 'Personnel'],
    ['4', 'Knowledge'],
    ['5', 'Status'],
    ['6', 'Problems'],
  ])('navigates on Cmd+%s to %s', (key, destination) => {
    renderApp();
    fireEvent.keyDown(window, { key, metaKey: true });
    expect(mockSetActiveTab).toHaveBeenCalledWith(destination);
  });

  it.each(['8', '9'])('does not assign Cmd+%s', (key) => {
    renderApp();
    fireEvent.keyDown(window, { key, metaKey: true });
    expect(mockSetActiveTab).not.toHaveBeenCalled();
  });

  it('opens shortcuts modal on Cmd+Shift+?', () => {
    renderApp();
    fireEvent.keyDown(window, { key: '?', metaKey: true, shiftKey: true });
    expect(screen.getByTestId('shortcuts-modal')).toBeInTheDocument();
  });

  it('closes shortcuts modal', () => {
    renderApp();
    fireEvent.keyDown(window, { key: '?', metaKey: true, shiftKey: true });
    fireEvent.click(screen.getByText('close-shortcuts'));
    expect(screen.queryByTestId('shortcuts-modal')).not.toBeInTheDocument();
  });

  it('adds contact to bridge when HeaderSearch add-to-bridge is used', () => {
    renderApp();
    fireEvent.click(screen.getByText('add-to-bridge'));
    expect(mockHandleAddManual).toHaveBeenCalledWith('test@example.com');
    expect(mockSetActiveTab).toHaveBeenCalledWith('Compose');
  });

  it('routes a contact result to an exact one-shot Knowledge request without changing Compose', () => {
    mockActiveTab = 'Knowledge';
    renderApp();

    fireEvent.click(screen.getByText('open-contact-record'));

    expect(lastKnowledgeWorkspaceProps?.recordOpenRequest).toMatchObject({
      destination: 'contacts',
      recordKey: 'id:contact_1',
    });
    expect(mockHandleAddManual).not.toHaveBeenCalled();
  });

  it('keeps the exact-record request identity stable across unrelated App rerenders', () => {
    mockActiveTab = 'Knowledge';
    const { rerender } = renderApp();
    fireEvent.click(screen.getByText('open-server-record'));
    const request = lastKnowledgeWorkspaceProps?.recordOpenRequest;

    rerender(<MainApp />);

    expect(lastKnowledgeWorkspaceProps?.recordOpenRequest).toBe(request);
  });

  it('reports a missing exact record without changing Compose', () => {
    mockActiveTab = 'Knowledge';
    renderApp();
    fireEvent.click(screen.getByText('open-contact-record'));
    const request = lastKnowledgeWorkspaceProps?.recordOpenRequest;
    expect(request).toBeDefined();
    if (!request) throw new Error('Expected a Knowledge record-open request');

    act(() => lastKnowledgeWorkspaceProps?.onRecordUnavailable?.(request));

    expect(mockShowToast).toHaveBeenCalledWith('That contact is no longer available.', 'info');
    expect(mockHandleAddManual).not.toHaveBeenCalled();
  });

  it('opens AddContactModal when HeaderSearch open-add-contact is used', () => {
    renderApp();
    fireEvent.click(screen.getByText('open-add-contact'));
    expect(screen.getByTestId('add-contact-modal')).toBeInTheDocument();
  });

  it('shows popout mode when ?popout search param is present', () => {
    renderApp('?popout=dynatrace');
    expect(screen.getByText('RELAY')).toBeInTheDocument();
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

  it('normalizes legacy sidebar tab requests through the retained workspace', () => {
    const destinations: string[] = [];
    const onDestination = (event: Event) => {
      destinations.push((event as CustomEvent).detail);
    };
    globalThis.addEventListener(OPEN_KNOWLEDGE_DESTINATION_EVENT, onDestination);
    renderApp();
    fireEvent.click(screen.getByText('nav-personnel'));
    expect(mockSetActiveTab).toHaveBeenCalledWith('Personnel');

    mockSetActiveTab.mockClear();
    fireEvent.click(screen.getByText('nav-people'));
    expect(destinations).toEqual(['contacts']);
    expect(getPendingKnowledgeDestinationOpen()).toBe('contacts');
    expect(mockSetActiveTab).toHaveBeenCalledWith('Knowledge');

    mockSetActiveTab.mockClear();
    fireEvent.click(screen.getByText('nav-servers'));
    expect(destinations).toEqual(['contacts', 'servers']);
    expect(getPendingKnowledgeDestinationOpen()).toBe('servers');
    expect(mockSetActiveTab).toHaveBeenCalledWith('Knowledge');

    mockSetActiveTab.mockClear();
    fireEvent.click(screen.getByText('nav-notes'));
    expect(mockSetActiveTab).toHaveBeenCalledWith('Compose');
    globalThis.removeEventListener(OPEN_KNOWLEDGE_DESTINATION_EVENT, onDestination);
  });

  it('opens the selected provider when a cloud-status toast action is used', async () => {
    mockActiveTab = 'Status';
    renderApp();
    await vi.waitFor(() => expect(screen.getByTestId('cloud-status-tab')).toBeInTheDocument());

    act(() => lastCloudStatusOpenProvider?.('mist_emea'));

    expect(mockSetActiveTab).toHaveBeenCalledWith('Status');
    expect(lastCloudStatusTabProps?.selectedProvider).toBe('mist_emea');

    act(() => lastCloudStatusTabProps?.onSelectedProviderChange?.(null));
    expect(lastCloudStatusTabProps?.selectedProvider).toBeNull();
  });

  it('focuses search on Cmd+K', () => {
    renderApp();
    const handled = fireEvent.keyDown(window, {
      key: 'k',
      metaKey: true,
      cancelable: true,
    });
    expect(handled).toBe(false);
  });

  it('handles navigate tab via HeaderSearch', () => {
    renderApp();
    const btn = screen.getByText('go-personnel');
    fireEvent.click(btn);
    expect(mockSetActiveTab).toHaveBeenCalledWith('Personnel');
  });

  it.each([
    ['go-contacts', 'contacts'],
    ['go-servers', 'servers'],
  ] as const)(
    'opens %s inside Knowledge before activating the outer tab',
    (button, destination) => {
      const calls: string[] = [];
      const onDestination = (event: Event) => {
        calls.push((event as CustomEvent).detail);
        expect(mockSetActiveTab).not.toHaveBeenCalled();
      };
      globalThis.addEventListener(OPEN_KNOWLEDGE_DESTINATION_EVENT, onDestination);
      renderApp();

      fireEvent.click(screen.getByText(button));

      expect(calls).toEqual([destination]);
      expect(getPendingKnowledgeDestinationOpen()).toBe(destination);
      expect(mockSetActiveTab).toHaveBeenCalledWith('Knowledge');
      globalThis.removeEventListener(OPEN_KNOWLEDGE_DESTINATION_EVENT, onDestination);
    },
  );

  it('renders the Dynatrace popout shell', () => {
    renderApp('?popout=dynatrace&name=NOC%20Dashboard');

    expect(screen.getByText('RELAY')).toBeInTheDocument();
    expect(screen.getByText('NOC Dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('window-controls')).toBeInTheDocument();
    expect(screen.queryByText('RELAY DYNATRACE')).not.toBeInTheDocument();
  });

  it('opens data manager modal from settings', async () => {
    mockActiveTab = 'Settings';
    renderApp();

    // Settings tab should be active.
    await vi.waitFor(() => {
      expect(screen.getByTestId('settings-tab')).toBeInTheDocument();
    });

    // Click open-data-manager button inside settings
    fireEvent.click(screen.getByText('open-data-manager'));

    await vi.waitFor(() => {
      expect(screen.getByTestId('data-manager-modal')).toBeInTheDocument();
    });
  });

  it('adds platform class to body on mount', () => {
    stubBridgeApi({ platform: 'darwin' });
    renderApp();
    expect(document.body.classList.contains('platform-darwin')).toBe(true);
  });

  it('adds is-popout class to body in popout mode', () => {
    renderApp('?popout=dynatrace');
    expect(document.body.classList.contains('is-popout')).toBe(true);
  });
});

describe('RetainedTabPanel', () => {
  it('keeps exactly one active class while switching between retained siblings', () => {
    const { container, rerender } = render(
      <>
        <RetainedTabPanel active>
          <div>Alerts</div>
        </RetainedTabPanel>
        <RetainedTabPanel active={false}>
          <div>Notes</div>
        </RetainedTabPanel>
      </>,
    );

    rerender(
      <>
        <RetainedTabPanel active={false}>
          <div>Alerts</div>
        </RetainedTabPanel>
        <RetainedTabPanel active>
          <div>Notes</div>
        </RetainedTabPanel>
      </>,
    );

    expect(container.querySelectorAll('.tab-panel--active')).toHaveLength(1);
    expect(container.querySelector('.tab-panel--active')).toHaveTextContent('Notes');
    expect(container.querySelector('.tab-panel--active')).toHaveAttribute('data-state', 'active');
    expect(container.querySelector('.tab-panel:not(.tab-panel--active)')).toHaveAttribute(
      'data-state',
      'retained',
    );
  });

  it('preserves local state while cleaning up hidden effects', () => {
    const effectMounted = vi.fn();
    const effectCleaned = vi.fn();

    function StatefulPanel() {
      const [value, setValue] = React.useState('draft');
      React.useEffect(() => {
        effectMounted();
        return effectCleaned;
      }, []);
      return <input value={value} onChange={(event) => setValue(event.target.value)} />;
    }

    const { container, rerender } = render(
      <RetainedTabPanel active>
        <StatefulPanel />
      </RetainedTabPanel>,
    );
    fireEvent.change(container.querySelector('input')!, { target: { value: 'operator draft' } });

    rerender(
      <RetainedTabPanel active={false}>
        <StatefulPanel />
      </RetainedTabPanel>,
    );

    expect(effectCleaned).toHaveBeenCalledOnce();
    expect(container.querySelector('input')).toHaveValue('operator draft');

    rerender(
      <RetainedTabPanel active>
        <StatefulPanel />
      </RetainedTabPanel>,
    );

    expect(effectMounted).toHaveBeenCalledTimes(2);
    expect(container.querySelector('input')).toHaveValue('operator draft');
  });
});

// ── App default export (popout toast branch) ─────────────────────────────────
describe('App default export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    lastConnectionManagerProps = null;
    mockIsConfigured.mockResolvedValue(true);
    mockGetConfig.mockResolvedValue({
      mode: 'server',
      port: 8090,
      bindHost: '0.0.0.0',
      lanIp: LAN_SERVER_ADDRESS,
    });
    mockGetPbConnection.mockResolvedValue({
      ok: true,
      connection: {
        pbUrl: 'http://localhost:8090',
        auth: { token: 'startup-token', record: null },
      },
    });
    mockSaveConfig.mockResolvedValue(true);
    mockStartPocketBase.mockResolvedValue(true);
    stubBridgeApi({
      isConfigured: mockIsConfigured,
      getConfig: mockGetConfig,
      getPbConnection: mockGetPbConnection,
      saveConfig: mockSaveConfig,
      startPocketBase: mockStartPocketBase,
      relaunchApp: mockRelaunchApp,
      platform: 'win32',
    });
    stubWindowBridge({ windowClose: vi.fn() });
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

  it('clears the retired local selection during startup without blocking Relay', async () => {
    const retiredSelectionKey = ['relay', 'selectedOperatorId'].join('.');
    localStorage.setItem(retiredSelectionKey, 'retired-record');
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(await screen.findByTestId('connection-manager')).toBeInTheDocument();
    expect(localStorage.getItem(retiredSelectionKey)).toBeNull();
  });

  it('mounts privileged access directly inside the initialized connection', async () => {
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });
    const { default: App } = await import('../App');
    render(<App />);

    const connectionManager = await screen.findByTestId('connection-manager');
    const privilegedProvider = screen.getByTestId('privileged-access-provider');
    expect(connectionManager).toContainElement(privilegedProvider);
    expect(screen.queryByTestId('operator-provider')).toBeNull();
  });

  it('uses NoopToastProvider in popout mode', async () => {
    Object.defineProperty(globalThis, 'location', {
      value: { search: '?popout=dynatrace' },
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

  it('returns an unauthenticated web runtime to the outer session gate', async () => {
    mockIsConfigured.mockResolvedValue(false);
    const onWebSessionRequired = vi.fn();
    globalThis.api = {
      ...globalThis.api,
      runtime: WEB_RUNTIME,
    } as typeof globalThis.api;
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App onWebSessionRequired={onWebSessionRequired} />);

    await vi.waitFor(() => expect(onWebSessionRequired).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('setup-screen')).not.toBeInTheDocument();
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

  it('starts the main app from a verified cache when the LAN server is unavailable', async () => {
    mockGetPbConnection.mockResolvedValue({
      ok: false,
      error: 'pb-unavailable',
      offlineAvailable: true,
      pbUrl: 'https://relay.example.com',
      lastSyncAt: 200,
    });
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(await screen.findByTestId('connection-manager')).toBeInTheDocument();
    expect(lastConnectionManagerProps).toMatchObject({
      pbUrl: 'https://relay.example.com',
      pbAuth: null,
      offlineMode: true,
    });
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

  it('treats a failed saveConfig result object as a failure, not a truthy success', async () => {
    mockIsConfigured.mockResolvedValue(false);
    // The handler may answer with a result object rather than a bare boolean;
    // read as a plain truthy value this relaunched into a half-written config.
    mockSaveConfig.mockResolvedValue({ ok: false, discardedPendingCount: 0 });
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
    expect(mockRelaunchApp).not.toHaveBeenCalled();
  });

  it('accepts a successful saveConfig result object and reports discarded offline changes', async () => {
    mockIsConfigured.mockResolvedValue(false);
    mockSaveConfig.mockResolvedValue({ ok: true, discardedPendingCount: 2 });
    Object.defineProperty(globalThis, 'location', {
      value: { search: '', reload: vi.fn() },
      writable: true,
      configurable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    fireEvent.click(await screen.findByText('complete-setup-server'));

    await vi.waitFor(() => expect(mockRelaunchApp).toHaveBeenCalled());
    expect(screen.queryByText('Failed to save configuration.')).not.toBeInTheDocument();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Reconfiguration discarded unsynced offline changes',
      { discardedPendingCount: 2 },
    );
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

  it('returns invalid browser configuration to the outer session gate', async () => {
    mockGetPbConnection.mockResolvedValue({ ok: false, error: 'invalid-config' });
    const onWebSessionRequired = vi.fn();
    globalThis.api = {
      ...globalThis.api,
      runtime: WEB_RUNTIME,
    } as typeof globalThis.api;
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App onWebSessionRequired={onWebSessionRequired} />);

    await vi.waitFor(() => expect(onWebSessionRequired).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('setup-screen')).not.toBeInTheDocument();
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

  it('reconfigures the runtime after successful client-mode setup', async () => {
    mockIsConfigured.mockResolvedValue(false);
    mockSaveConfig.mockResolvedValue(true);
    mockRelaunchApp.mockResolvedValue(undefined);
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
      expect(mockRelaunchApp).toHaveBeenCalled();
    });
    expect(reload).not.toHaveBeenCalled();
    expect(mockStartPocketBase).not.toHaveBeenCalled();
  });

  it('lets runtime reconfigure start PocketBase once after successful server-mode setup', async () => {
    mockIsConfigured.mockResolvedValue(false);
    mockSaveConfig.mockResolvedValue(true);
    mockRelaunchApp.mockResolvedValue(undefined);
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
      expect(mockRelaunchApp).toHaveBeenCalled();
    });
    expect(mockStartPocketBase).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('starts PocketBase and reloads after server-mode setup when runtime reconfigure is unavailable', async () => {
    mockIsConfigured.mockResolvedValue(false);
    mockSaveConfig.mockResolvedValue(true);
    mockStartPocketBase.mockResolvedValue(true);
    const reload = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      value: { search: '', reload },
      writable: true,
      configurable: true,
    });
    const apiWithoutRelaunch = { ...globalThis.api };
    delete apiWithoutRelaunch.relaunchApp;
    globalThis.api = apiWithoutRelaunch as typeof globalThis.api;

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
    const apiWithoutRelaunch = { ...globalThis.api };
    delete apiWithoutRelaunch.relaunchApp;
    globalThis.api = apiWithoutRelaunch as typeof globalThis.api;

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
    stubWindowBridge({ windowClose: mockWindowClose });
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

  it('does not expose desktop window controls while browser startup is checking', async () => {
    mockIsConfigured.mockImplementation(() => new Promise(() => undefined));
    globalThis.api = {
      ...globalThis.api,
      runtime: WEB_RUNTIME,
    } as typeof globalThis.api;
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });

    const { default: App } = await import('../App');
    render(<App />);

    expect(screen.getByText('Initializing...')).toBeInTheDocument();
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });

  it('calls windowClose when close button is clicked in error state', async () => {
    mockGetPbConnection.mockResolvedValue({ ok: false, error: 'unavailable' });
    const mockWindowClose = vi.fn();
    stubWindowBridge({ windowClose: mockWindowClose });
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
