import { NotesProvider, PrivilegedAccessProvider, SearchProvider } from './contexts';
import {
  Activity,
  useEffect,
  useState,
  useCallback,
  useRef,
  Suspense,
  lazy,
  ComponentType,
  type PropsWithChildren,
} from 'react';
import { Sidebar } from './components/Sidebar';
import { WorldClock } from './components/WorldClock';
import { AssemblerTab } from './tabs/AssemblerTab';
import { WindowControls } from './components/WindowControls';
import { ToastProvider, NoopToastProvider, useToast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabFallback } from './components/TabFallback';
import { HeaderSearch } from './components/HeaderSearch';
import { AlertReminderManager } from './components/AlertReminderManager';
import { DynatraceProblemNotificationManager } from './components/DynatraceProblemNotificationManager';
import { ShortcutsModal } from './components/ShortcutsModal';
import { AddContactModal } from './components/AddContactModal';
import { SetupScreen } from './components/SetupScreen';
import { StartupErrorScreen } from './components/StartupErrorScreen';
import { ConnectionManager } from './components/ConnectionManager';
import { Contact, type PbAuthSession, type PublicRelayConfig } from '@shared/ipc';
import { loggers } from './utils/logger';
import { addContact as pbAddContact } from './services/contactService';
import { useAppData } from './hooks/useAppData';
import { useAppAssembler } from './hooks/useAppAssembler';
import { useAppCloudStatus } from './hooks/useAppCloudStatus';
import { useErrorNotifications } from './hooks/useErrorNotifications';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useModalState } from './hooks/useModalState';
import { useDynatraceDashboards } from './hooks/useDynatraceDashboards';
import {
  REMINDER_ALERT_LOAD_EVENT,
  type ReminderAlertLoadDetail,
} from './services/reminderAlertLoadEvent';
import {
  clampOnCallFontScale,
  getStoredOnCallFontScale,
  ON_CALL_FONT_SCALE_STORAGE_KEY,
  setOnCallFontScale,
} from './theme/onCallDisplay';
import {
  requestKnowledgeDocumentOpen,
  type KnowledgeOpenRequest,
} from './features/knowledge/knowledgeNavigation';
import {
  normalizeLegacyTabRequest,
  requestKnowledgeDestinationOpen,
  type KnowledgeContentDestination,
  type KnowledgeDestination,
} from './features/knowledge/knowledgeWorkspaceNavigation';
import { getRelayRuntime } from './runtime/relayRuntime';

// Lazy-load helper for named exports
function lazyTab<T extends Record<string, ComponentType>>(
  factory: () => Promise<T>,
  name: keyof T & string,
) {
  return lazy(() => factory().then((m) => ({ default: m[name] })));
}

// Lazy load non-default tabs and settings modal
const PersonnelTab = lazyTab(() => import('./tabs/PersonnelTab'), 'PersonnelTab');
const SettingsTab = lazyTab(() => import('./components/SettingsModal'), 'SettingsModal');
const DataManagerModal = lazyTab(() => import('./components/DataManagerModal'), 'DataManagerModal');
const KnowledgeWorkspace = lazyTab(
  () => import('./features/knowledge/KnowledgeWorkspace'),
  'KnowledgeWorkspace',
);
const CloudStatusTab = lazyTab(() => import('./tabs/CloudStatusTab'), 'CloudStatusTab');
const DynatraceProblemsTab = lazyTab(
  () => import('./tabs/DynatraceProblemsTab'),
  'DynatraceProblemsTab',
);
const AlertsTab = lazyTab(() => import('./tabs/AlertsTab'), 'AlertsTab');
const PopoutBoard = lazyTab(() => import('./components/PopoutBoard'), 'PopoutBoard');

const errorFallback = (reset: () => void) => <TabFallback error onReset={reset} />;
const getTabPanelClassName = (active: boolean) => `tab-panel${active ? ' tab-panel--active' : ''}`;
const STARTUP_CONNECTION_TIMEOUT_MS = 20_000;
const RETIRED_LOCAL_SELECTION_KEY = ['relay', 'selectedOperatorId'].join('.');

function getPreferredSearchResultType(
  activeTab: string,
  knowledgeDestination: KnowledgeDestination,
): 'contact' | 'server' | 'knowledge' | undefined {
  if (activeTab !== 'Knowledge') return undefined;

  switch (knowledgeDestination) {
    case 'contacts':
      return 'contact';
    case 'servers':
      return 'server';
    case 'wiki':
      return 'knowledge';
    default:
      return undefined;
  }
}

export function RetainedTabPanel({
  active,
  children,
}: PropsWithChildren<Readonly<{ active: boolean }>>) {
  return (
    <div
      className={getTabPanelClassName(active)}
      data-motion={active ? 'panel' : undefined}
      data-state={active ? 'active' : 'retained'}
    >
      <Activity mode={active ? 'visible' : 'hidden'}>{children}</Activity>
    </div>
  );
}

function withStartupTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('startup-timeout'));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export function MainApp({
  onReconfigure,
  relayConfig = null,
}: {
  readonly onReconfigure?: () => void;
  readonly relayConfig?: PublicRelayConfig | null;
} = {}) {
  const { showToast } = useToast();
  useErrorNotifications(showToast);

  const searchParams = new URLSearchParams(globalThis.location.search);
  const isPopout = searchParams.has('popout');
  const popoutRoute = searchParams.get('popout');
  const isDynatracePopout = popoutRoute === 'dynatrace';
  const dynatracePopoutName = searchParams.get('name')?.trim() || '';
  const dynatrace = useDynatraceDashboards(showToast, { enabled: !isPopout });
  const [onCallFontScale, setOnCallFontScaleState] = useState(() => getStoredOnCallFontScale());
  const handleOnCallFontScaleChange = useCallback((scale: number) => {
    setOnCallFontScale(scale);
    setOnCallFontScaleState(clampOnCallFontScale(scale));
  }, []);

  useEffect(() => {
    const handleFontScaleStorage = (event: StorageEvent) => {
      if (event.key !== ON_CALL_FONT_SCALE_STORAGE_KEY) return;
      setOnCallFontScaleState(clampOnCallFontScale(event.newValue));
    };

    globalThis.addEventListener('storage', handleFontScaleStorage);
    return () => globalThis.removeEventListener('storage', handleFontScaleStorage);
  }, []);

  const handleClientConnected = useCallback(
    (hostname: string) => showToast(`${hostname} connected`, 'info'),
    [showToast],
  );
  const { data, boardSettings, setBoardSettings } = useAppData(showToast);

  const {
    statusData: cloudStatusData,
    loading: cloudStatusLoading,
    refetch: cloudStatusRefetch,
  } = useAppCloudStatus(showToast);

  const {
    activeTab,
    setActiveTab,
    selectedGroupIds,
    setSelectedGroupIds,
    manualAdds,
    setManualAdds,
    manualRemoves,
    handleAddToAssembler,
    handleUndoRemove,
    handleReset,
    handleAddManual,
    handleRemoveManual,
    handleToggleGroup,
  } = useAppAssembler();
  const [knowledgeDestination, setKnowledgeDestination] = useState<KnowledgeDestination>('home');
  const handleOpenDynatraceProblems = useCallback(() => setActiveTab('Problems'), [setActiveTab]);
  const handleOpenSettings = useCallback(() => setActiveTab('Settings'), [setActiveTab]);
  const handleTabRequest = useCallback(
    (requestedTab: string) => {
      const normalized = normalizeLegacyTabRequest(requestedTab);
      if (normalized.knowledgeDestination) {
        setKnowledgeDestination(normalized.knowledgeDestination);
        requestKnowledgeDestinationOpen(normalized.knowledgeDestination);
      }
      setActiveTab(normalized.tab);
    },
    [setActiveTab],
  );
  const handleOpenKnowledgeDestination = useCallback(
    (destination: KnowledgeContentDestination) => {
      setKnowledgeDestination(destination);
      requestKnowledgeDestinationOpen(destination);
      setActiveTab('Knowledge');
    },
    [setActiveTab],
  );
  const handleOpenKnowledgeDocument = useCallback(
    (request: KnowledgeOpenRequest) => {
      setKnowledgeDestination('wiki');
      requestKnowledgeDocumentOpen(request);
      requestKnowledgeDestinationOpen('wiki');
      setActiveTab('Knowledge');
    },
    [setActiveTab],
  );

  // Track which tabs have been mounted at least once
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(new Set([activeTab]));
  const [loadedReminderAlert, setLoadedReminderAlert] = useState<ReminderAlertLoadDetail | null>(
    null,
  );

  useEffect(() => {
    setMountedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  useEffect(() => {
    const handleReminderAlertLoad = (event: Event) => {
      const detail = (event as CustomEvent<ReminderAlertLoadDetail>).detail;
      if (!detail) return;
      setLoadedReminderAlert(detail);
      setActiveTab('Alerts');
    };

    globalThis.addEventListener(REMINDER_ALERT_LOAD_EVENT, handleReminderAlertLoad);
    return () => globalThis.removeEventListener(REMINDER_ALERT_LOAD_EVENT, handleReminderAlertLoad);
  }, [setActiveTab]);

  // Header search ref (for Cmd+K focus)
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Modal states
  const shortcutsModal = useModalState();
  const dataManagerModal = useModalState();
  const addContactModal = useModalState();
  const [initialContactEmail, setInitialContactEmail] = useState('');

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    setActiveTab,
    openSettings: handleOpenSettings,
    setIsShortcutsOpen: shortcutsModal.open,
    searchInputRef,
  });

  // Handler for saving contact
  const handleContactSaved = async (contact: Partial<Contact>) => {
    try {
      await pbAddContact({
        name: contact.name || '',
        email: contact.email || '',
        phone: contact.phone || '',
        title: contact.title || '',
      });
      showToast('Contact created successfully', 'success');
    } catch (e) {
      loggers.app.error('Failed to save contact', { error: e });
      showToast('Failed to create contact', 'error');
    }
  };

  // Handler for loading group from command palette
  const handleLoadGroupFromPalette = useCallback(
    (groupId: string) => {
      // Toggle the group selection
      setSelectedGroupIds((prev) =>
        prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
      );
      setActiveTab('Compose');
    },
    [setSelectedGroupIds, setActiveTab],
  );

  // Platform and Global Interaction Logic
  useEffect(() => {
    const platform = globalThis.api?.platform || 'win32';
    document.body.classList.add(`platform-${platform}`);
    if (isPopout) {
      document.body.classList.add('is-popout');
    }
  }, [isPopout]);

  if (isPopout) {
    return (
      <div className={`popout-container${isDynatracePopout ? ' popout-container--dynatrace' : ''}`}>
        <div className="popout-header">
          <div className="popout-title-stack">
            <span className="popout-title">
              {isDynatracePopout ? 'RELAY' : 'RELAY ON-CALL BOARD'}
            </span>
            {isDynatracePopout && dynatracePopoutName && (
              <span className="popout-subtitle">{dynatracePopoutName}</span>
            )}
          </div>
        </div>
        <div className="popout-controls">
          <WindowControls />
        </div>
        <div className={`popout-body${isDynatracePopout ? ' popout-body--dynatrace' : ''}`}>
          {isDynatracePopout && <div className="dynatrace-shell-body" aria-hidden="true" />}
          {popoutRoute?.includes('board') && (
            <ErrorBoundary fallback={errorFallback}>
              <Suspense fallback={<TabFallback />}>
                <PopoutBoard
                  onCall={data.onCall}
                  contacts={data.contacts}
                  boardSettings={boardSettings}
                  onBoardSettingsChange={setBoardSettings}
                  onCallFontScale={onCallFontScale}
                  onOnCallFontScaleChange={handleOnCallFontScaleChange}
                />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>
      </div>
    );
  }

  return (
    <SearchProvider activeTab={activeTab} searchInputRef={searchInputRef}>
      <div className="app-container">
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabRequest}
          onOpenSettings={handleOpenSettings}
          relayMode={relayConfig?.mode}
          relayConfig={relayConfig}
          onClientConnected={handleClientConnected}
          dynatraceDashboards={dynatrace.dashboards}
          onOpenDynatraceDashboard={dynatrace.openDashboard}
        />

        <main className="main-content" aria-label="Application content">
          <header className="app-header" aria-label="Application navigation">
            <div className="header-title-container">
              <span className="header-breadcrumb">
                Relay /{' '}
                {{
                  Compose: 'Compose',
                  Personnel: 'On-Call',
                  Knowledge: 'Knowledge',
                  Status: 'Service Status',
                  Problems: 'Dynatrace Problems',
                  Alerts: 'Alerts',
                  Settings: 'Settings',
                }[activeTab] ?? activeTab}
              </span>
            </div>
            <div className="header-search-container">
              <HeaderSearch
                activeTab={activeTab}
                preferredResultType={getPreferredSearchResultType(activeTab, knowledgeDestination)}
                contacts={data.contacts}
                servers={data.servers}
                groups={data.groups}
                actions={{
                  onAddContactToBridge: (email) => {
                    handleAddManual(email);
                    setActiveTab('Compose');
                  },
                  onToggleGroup: handleLoadGroupFromPalette,
                  onNavigateToTab: handleTabRequest,
                  onOpenKnowledgeDestination: handleOpenKnowledgeDestination,
                  onOpenAddContact: (email) => {
                    setInitialContactEmail(email || '');
                    addContactModal.open();
                  },
                  onOpenKnowledgeDocument: handleOpenKnowledgeDocument,
                }}
              />
            </div>
            <div className="header-actions">
              <WorldClock />
            </div>
          </header>

          <div className="content-view">
            {mountedTabs.has('Compose') && (
              <RetainedTabPanel active={activeTab === 'Compose'}>
                <ErrorBoundary fallback={errorFallback}>
                  <AssemblerTab
                    groups={data.groups}
                    contacts={data.contacts}
                    onCall={data.onCall}
                    selectedGroupIds={selectedGroupIds}
                    manualAdds={manualAdds}
                    manualRemoves={manualRemoves}
                    onToggleGroup={handleToggleGroup}
                    onAddManual={handleAddManual}
                    onRemoveManual={handleRemoveManual}
                    onUndoRemove={handleUndoRemove}
                    onResetManual={handleReset}
                    setSelectedGroupIds={setSelectedGroupIds}
                    setManualAdds={setManualAdds}
                  />
                </ErrorBoundary>
              </RetainedTabPanel>
            )}
            {mountedTabs.has('Personnel') && (
              <RetainedTabPanel active={activeTab === 'Personnel'}>
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <PersonnelTab
                      onCall={data.onCall}
                      contacts={data.contacts}
                      boardSettings={boardSettings}
                      onBoardSettingsChange={setBoardSettings}
                      onCallFontScale={onCallFontScale}
                      onOnCallFontScaleChange={handleOnCallFontScaleChange}
                    />
                  </Suspense>
                </ErrorBoundary>
              </RetainedTabPanel>
            )}
            {mountedTabs.has('Knowledge') && (
              <RetainedTabPanel active={activeTab === 'Knowledge'}>
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <KnowledgeWorkspace
                      active={activeTab === 'Knowledge'}
                      contacts={data.contacts}
                      groups={data.groups}
                      servers={data.servers}
                      relayMode={relayConfig?.mode}
                      onAddToAssembler={handleAddToAssembler}
                      onDestinationChange={setKnowledgeDestination}
                    />
                  </Suspense>
                </ErrorBoundary>
              </RetainedTabPanel>
            )}
            {mountedTabs.has('Status') && (
              <RetainedTabPanel active={activeTab === 'Status'}>
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <CloudStatusTab
                      statusData={cloudStatusData}
                      loading={cloudStatusLoading}
                      refetch={cloudStatusRefetch}
                    />
                  </Suspense>
                </ErrorBoundary>
              </RetainedTabPanel>
            )}
            {mountedTabs.has('Problems') && (
              <RetainedTabPanel active={activeTab === 'Problems'}>
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <DynatraceProblemsTab relayMode={relayConfig?.mode} />
                  </Suspense>
                </ErrorBoundary>
              </RetainedTabPanel>
            )}
            {mountedTabs.has('Alerts') && (
              <RetainedTabPanel active={activeTab === 'Alerts'}>
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <AlertsTab
                      loadedReminderAlert={loadedReminderAlert}
                      onLoadedReminderAlertConsumed={() => setLoadedReminderAlert(null)}
                    />
                  </Suspense>
                </ErrorBoundary>
              </RetainedTabPanel>
            )}
            <RetainedTabPanel active={activeTab === 'Settings'}>
              <ErrorBoundary fallback={errorFallback}>
                <Suspense fallback={<TabFallback />}>
                  <SettingsTab
                    isOpen={activeTab === 'Settings'}
                    onClose={() => setActiveTab('Compose')}
                    onOpenDataManager={dataManagerModal.open}
                    onReconfigure={onReconfigure}
                    dynatrace={dynatrace}
                    presentation="page"
                  />
                </Suspense>
              </ErrorBoundary>
            </RetainedTabPanel>
          </div>
        </main>

        <div className="window-controls-container">
          <WindowControls />
        </div>

        <ErrorBoundary fallback={errorFallback}>
          <Suspense fallback={null}>
            <DataManagerModal isOpen={dataManagerModal.isOpen} onClose={dataManagerModal.close} />
          </Suspense>
        </ErrorBoundary>

        <ErrorBoundary fallback={null}>
          <ShortcutsModal isOpen={shortcutsModal.isOpen} onClose={shortcutsModal.close} />
        </ErrorBoundary>

        <ErrorBoundary fallback={null}>
          <AddContactModal
            isOpen={addContactModal.isOpen}
            onClose={addContactModal.close}
            onSave={handleContactSaved}
            initialEmail={initialContactEmail}
          />
        </ErrorBoundary>

        <ErrorBoundary fallback={null}>
          <AlertReminderManager />
        </ErrorBoundary>

        <ErrorBoundary fallback={null}>
          <DynatraceProblemNotificationManager onOpenProblems={handleOpenDynatraceProblems} />
        </ErrorBoundary>
      </div>
    </SearchProvider>
  );
}

type AppPhase =
  | { stage: 'checking' }
  | { stage: 'setup' }
  | {
      stage: 'connecting';
      pbUrl: string;
      pbAuth: PbAuthSession | null;
      offlineMode: boolean;
      relayConfig: PublicRelayConfig | null;
    }
  | { stage: 'error'; message: string; retryable: boolean };

function AppWithSetup({ onWebSessionRequired }: { readonly onWebSessionRequired?: () => void }) {
  const [phase, setPhase] = useState<AppPhase>({ stage: 'checking' });

  const checkConfig = useCallback(async () => {
    try {
      const configured = await globalThis.api!.isConfigured();
      if (!configured) {
        if (getRelayRuntime().kind === 'web') {
          onWebSessionRequired?.();
          return;
        }
        setPhase({ stage: 'setup' });
        return;
      }
      const relayConfig = await globalThis.api!.getConfig();
      const result = await withStartupTimeout(
        globalThis.api!.getPbConnection(),
        STARTUP_CONNECTION_TIMEOUT_MS,
      );
      if (!result.ok) {
        if (result.error === 'pb-unavailable' && result.offlineAvailable) {
          setPhase({
            stage: 'connecting',
            pbUrl: result.pbUrl,
            pbAuth: null,
            offlineMode: true,
            relayConfig,
          });
          return;
        }
        if (result.error === 'not-configured' || result.error === 'invalid-config') {
          setPhase({ stage: 'setup' });
          return;
        }

        setPhase(
          result.error === 'auth-failed'
            ? { stage: 'error', message: 'PocketBase authentication failed.', retryable: false }
            : { stage: 'error', message: 'PocketBase server is unavailable.', retryable: true },
        );
        return;
      }

      setPhase({
        stage: 'connecting',
        pbUrl: result.connection.pbUrl,
        pbAuth: result.connection.auth,
        offlineMode: false,
        relayConfig,
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'startup-timeout') {
        setPhase({
          stage: 'error',
          message: 'Connection timed out. The server may be unreachable.',
          retryable: true,
        });
        return;
      }

      loggers.app.error('Failed to check configuration', { error: err });
      setPhase({ stage: 'error', message: 'Failed to read configuration.', retryable: false });
    }
  }, [onWebSessionRequired]);

  useEffect(() => {
    void checkConfig();
  }, [checkConfig]);

  const handleSetupComplete = useCallback(
    async (config: {
      mode: 'server' | 'client';
      port?: number;
      bindHost?: '127.0.0.1' | '0.0.0.0';
      serverUrl?: string;
      allowInsecureHttp?: boolean;
      secret: string;
    }) => {
      try {
        const saved = await globalThis.api!.saveConfig(config);
        if (!saved) {
          setPhase({ stage: 'error', message: 'Failed to save configuration.', retryable: false });
          return;
        }
        // Ask the main process to rebuild per-mode runtime state, then reload this
        // window. A plain renderer reload leaves stale state — e.g. a lingering
        // embedded PocketBase after switching to client mode — that can misroute
        // or stall the connection.
        const relaunch = globalThis.api?.relaunchApp;
        if (relaunch) {
          await relaunch();
          return;
        }
        // Legacy/browser fallback: in server mode, start PocketBase before reconnecting.
        if (config.mode === 'server') {
          const started = await globalThis.api!.startPocketBase();
          if (!started) {
            setPhase({
              stage: 'error',
              message: 'Failed to start PocketBase server.',
              retryable: false,
            });
            return;
          }
        }
        globalThis.location.reload();
      } catch (err) {
        loggers.app.error('Failed to save configuration', { error: err });
        setPhase({ stage: 'error', message: 'Failed to save configuration.', retryable: false });
      }
    },
    [],
  );

  const handleRetry = useCallback(() => {
    setPhase({ stage: 'checking' });
    void checkConfig();
  }, [checkConfig]);

  if (phase.stage === 'checking') {
    return (
      <div className="app-state">
        <button
          className="app-state__close-btn"
          onClick={() => globalThis.window.api?.windowClose()}
          aria-label="Close"
        >
          &#10005;
        </button>
        <div className="app-state__spinner" />
        <p className="app-state__text">Initializing...</p>
      </div>
    );
  }

  if (phase.stage === 'setup') {
    return <SetupScreen onComplete={handleSetupComplete} />;
  }

  if (phase.stage === 'error') {
    return (
      <StartupErrorScreen
        message={phase.message}
        retryable={phase.retryable}
        onRetry={handleRetry}
        onReconfigure={() => setPhase({ stage: 'setup' })}
      />
    );
  }

  return (
    <ConnectionManager
      pbUrl={phase.pbUrl}
      pbAuth={phase.pbAuth}
      offlineMode={phase.offlineMode}
      onReconfigure={() => setPhase({ stage: 'setup' })}
    >
      <PrivilegedAccessProvider>
        <MainApp
          onReconfigure={() => setPhase({ stage: 'setup' })}
          relayConfig={phase.relayConfig}
        />
      </PrivilegedAccessProvider>
    </ConnectionManager>
  );
}

export default function App({
  onWebSessionRequired,
}: Readonly<{ onWebSessionRequired?: () => void }> = {}) {
  const isPopout = new URLSearchParams(globalThis.location.search).has('popout');
  const ToastWrapper = isPopout ? NoopToastProvider : ToastProvider;

  useEffect(() => {
    try {
      localStorage.removeItem(RETIRED_LOCAL_SELECTION_KEY);
    } catch {
      // Storage cleanup must never block ordinary passwordless Relay startup.
    }
  }, []);

  return (
    <ErrorBoundary>
      <ToastWrapper>
        <NotesProvider>
          <AppWithSetup onWebSessionRequired={onWebSessionRequired} />
        </NotesProvider>
      </ToastWrapper>
    </ErrorBoundary>
  );
}
