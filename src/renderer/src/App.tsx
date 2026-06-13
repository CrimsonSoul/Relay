import { NotesProvider, SearchProvider } from './contexts';
import { useEffect, useState, useCallback, useRef, Suspense, lazy, ComponentType } from 'react';
import { Sidebar } from './components/Sidebar';
import { WorldClock } from './components/WorldClock';
import { AssemblerTab } from './tabs/AssemblerTab';
import { WindowControls } from './components/WindowControls';
import { ToastProvider, NoopToastProvider, useToast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabFallback } from './components/TabFallback';
import { HeaderSearch } from './components/HeaderSearch';
import { AlertReminderManager } from './components/AlertReminderManager';
import { ShortcutsModal } from './components/ShortcutsModal';
import { AddContactModal } from './components/AddContactModal';
import { SetupScreen } from './components/SetupScreen';
import { StartupErrorScreen } from './components/StartupErrorScreen';
import { ConnectionManager } from './components/ConnectionManager';
import { Contact, TabName, type PbAuthSession, type PublicRelayConfig } from '@shared/ipc';
import { loggers } from './utils/logger';
import { addContact as pbAddContact } from './services/contactService';
import { useAppData } from './hooks/useAppData';
import { useAppAssembler } from './hooks/useAppAssembler';
import { useAppCloudStatus } from './hooks/useAppCloudStatus';
import { useErrorNotifications } from './hooks/useErrorNotifications';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useModalState } from './hooks/useModalState';
import { useClientPresence } from './hooks/useClientPresence';
import {
  REMINDER_ALERT_LOAD_EVENT,
  type ReminderAlertLoadDetail,
} from './services/reminderAlertLoadEvent';

// Lazy-load helper for named exports
function lazyTab<T extends Record<string, ComponentType>>(
  factory: () => Promise<T>,
  name: keyof T & string,
) {
  return lazy(() => factory().then((m) => ({ default: m[name] })));
}

// Lazy load non-default tabs and settings modal
const DirectoryTab = lazyTab(() => import('./tabs/DirectoryTab'), 'DirectoryTab');
const ServersTab = lazyTab(() => import('./tabs/ServersTab'), 'ServersTab');
const PersonnelTab = lazyTab(() => import('./tabs/PersonnelTab'), 'PersonnelTab');
const SettingsModal = lazyTab(() => import('./components/SettingsModal'), 'SettingsModal');
const DataManagerModal = lazyTab(() => import('./components/DataManagerModal'), 'DataManagerModal');
const NotesTab = lazyTab(() => import('./tabs/NotesTab'), 'NotesTab');
const CloudStatusTab = lazyTab(() => import('./tabs/CloudStatusTab'), 'CloudStatusTab');
const AlertsTab = lazyTab(() => import('./tabs/AlertsTab'), 'AlertsTab');
const PopoutBoard = lazyTab(() => import('./components/PopoutBoard'), 'PopoutBoard');

const errorFallback = (reset: () => void) => <TabFallback error onReset={reset} />;
const STARTUP_CONNECTION_TIMEOUT_MS = 20_000;

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
  const handleClientConnected = useCallback(
    (hostname: string) => showToast(`${hostname} connected`, 'info'),
    [showToast],
  );
  const clientPresence = useClientPresence(relayConfig, handleClientConnected, {
    enabled: !isPopout,
  });

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
    settingsOpen,
    setSettingsOpen,
    handleAddToAssembler,
    handleUndoRemove,
    handleReset,
    handleAddManual,
    handleRemoveManual,
    handleToggleGroup,
  } = useAppAssembler();

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
    setSettingsOpen,
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
      <div className="popout-container">
        <div className="popout-header">
          <span className="popout-title">RELAY ON-CALL BOARD</span>
        </div>
        <div className="popout-controls">
          <WindowControls />
        </div>
        <div className="popout-body">
          {popoutRoute?.includes('board') && (
            <ErrorBoundary fallback={errorFallback}>
              <Suspense fallback={<TabFallback />}>
                <PopoutBoard
                  onCall={data.onCall}
                  contacts={data.contacts}
                  boardSettings={boardSettings}
                  onBoardSettingsChange={setBoardSettings}
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
          onTabChange={setActiveTab}
          onOpenSettings={() => setSettingsOpen(true)}
          clientPresence={clientPresence}
          relayMode={relayConfig?.mode}
        />

        <main className="main-content" aria-label="Application content">
          <header className="app-header" aria-label="Application navigation">
            <div className="header-title-container">
              <span className="header-breadcrumb">
                Relay /{' '}
                {{
                  Compose: 'Compose',
                  Personnel: 'On-Call',
                  People: 'People',
                  Servers: 'Servers',
                  Notes: 'Notes',
                  Status: 'Service Status',
                  Alerts: 'Alerts',
                }[activeTab] ?? activeTab}
              </span>
            </div>
            <div className="header-search-container">
              <HeaderSearch
                activeTab={activeTab}
                contacts={data.contacts}
                servers={data.servers}
                groups={data.groups}
                actions={{
                  onAddContactToBridge: (email) => {
                    handleAddManual(email);
                    setActiveTab('Compose');
                  },
                  onToggleGroup: handleLoadGroupFromPalette,
                  onNavigateToTab: (tab) => setActiveTab(tab as TabName),
                  onOpenAddContact: (email) => {
                    setInitialContactEmail(email || '');
                    addContactModal.open();
                  },
                }}
              />
            </div>
            <div className="header-actions">
              <WorldClock />
            </div>
          </header>

          <div className="content-view">
            {mountedTabs.has('Compose') && (
              <div className={`tab-panel${activeTab === 'Compose' ? ' tab-panel--active' : ''}`}>
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
              </div>
            )}
            {mountedTabs.has('Personnel') && (
              <div className={`tab-panel${activeTab === 'Personnel' ? ' tab-panel--active' : ''}`}>
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <PersonnelTab
                      onCall={data.onCall}
                      contacts={data.contacts}
                      boardSettings={boardSettings}
                      onBoardSettingsChange={setBoardSettings}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {mountedTabs.has('People') && (
              <div className={`tab-panel${activeTab === 'People' ? ' tab-panel--active' : ''}`}>
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <DirectoryTab
                      contacts={data.contacts}
                      groups={data.groups}
                      servers={data.servers}
                      onAddToAssembler={handleAddToAssembler}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {mountedTabs.has('Servers') && (
              <div className={`tab-panel${activeTab === 'Servers' ? ' tab-panel--active' : ''}`}>
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <ServersTab servers={data.servers} contacts={data.contacts} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {mountedTabs.has('Notes') && (
              <div className={`tab-panel${activeTab === 'Notes' ? ' tab-panel--active' : ''}`}>
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <NotesTab />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {mountedTabs.has('Status') && (
              <div className={`tab-panel${activeTab === 'Status' ? ' tab-panel--active' : ''}`}>
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <CloudStatusTab
                      statusData={cloudStatusData}
                      loading={cloudStatusLoading}
                      refetch={cloudStatusRefetch}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {mountedTabs.has('Alerts') && (
              <div className={`tab-panel${activeTab === 'Alerts' ? ' tab-panel--active' : ''}`}>
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <AlertsTab
                      loadedReminderAlert={loadedReminderAlert}
                      onLoadedReminderAlertConsumed={() => setLoadedReminderAlert(null)}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
          </div>
        </main>

        <div className="window-controls-container">
          <WindowControls />
        </div>

        <ErrorBoundary fallback={errorFallback}>
          <Suspense fallback={null}>
            {settingsOpen && (
              <SettingsModal
                isOpen={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                onOpenDataManager={dataManagerModal.open}
                onReconfigure={onReconfigure}
              />
            )}
            {dataManagerModal.isOpen && (
              <DataManagerModal isOpen={dataManagerModal.isOpen} onClose={dataManagerModal.close} />
            )}
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
      pbAuth: PbAuthSession;
      relayConfig: PublicRelayConfig | null;
    }
  | { stage: 'error'; message: string; retryable: boolean };

function AppWithSetup() {
  const [phase, setPhase] = useState<AppPhase>({ stage: 'checking' });

  const checkConfig = useCallback(async () => {
    try {
      const configured = await globalThis.api!.isConfigured();
      if (!configured) {
        setPhase({ stage: 'setup' });
        return;
      }
      const relayConfig = await globalThis.api!.getConfig();
      const result = await withStartupTimeout(
        globalThis.api!.getPbConnection(),
        STARTUP_CONNECTION_TIMEOUT_MS,
      );
      if (!result.ok) {
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
  }, []);

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
      onReconfigure={() => setPhase({ stage: 'setup' })}
    >
      <MainApp onReconfigure={() => setPhase({ stage: 'setup' })} relayConfig={phase.relayConfig} />
    </ConnectionManager>
  );
}

export default function App() {
  const isPopout = new URLSearchParams(globalThis.location.search).has('popout');
  const ToastWrapper = isPopout ? NoopToastProvider : ToastProvider;

  return (
    <ErrorBoundary>
      <ToastWrapper>
        <NotesProvider>
          <AppWithSetup />
        </NotesProvider>
      </ToastWrapper>
    </ErrorBoundary>
  );
}
