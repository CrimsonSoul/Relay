import { LocationProvider, useLocation, NotesProvider, SearchProvider } from './contexts';
import { useEffect, useState, useCallback, useRef, Suspense, lazy } from 'react';
import { Sidebar } from './components/Sidebar';
import { WorldClock } from './components/WorldClock';
import { AssemblerTab } from './tabs/AssemblerTab';
import { WindowControls } from './components/WindowControls';
import { ToastProvider, NoopToastProvider, useToast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabFallback } from './components/TabFallback';
import { HeaderSearch } from './components/HeaderSearch';
import { ShortcutsModal } from './components/ShortcutsModal';
import { AddContactModal } from './components/AddContactModal';
import { SetupScreen } from './components/SetupScreen';
import { TactileButton } from './components/TactileButton';
import { ConnectionStatus } from './components/ConnectionStatus';
import { Contact, TabName } from '@shared/ipc';
import { loggers } from './utils/logger';
import { addContact as pbAddContact } from './services/contactService';
// Hooks
import { useAppWeather } from './hooks/useAppWeather';
import { useAppData } from './hooks/useAppData';
import { useAppAssembler } from './hooks/useAppAssembler';
import { useAppCloudStatus } from './hooks/useAppCloudStatus';
import { usePocketBase } from './hooks/usePocketBase';

// Lazy load non-default tabs and settings modal
const DirectoryTab = lazy(() =>
  import('./tabs/DirectoryTab').then((m) => ({ default: m.DirectoryTab })),
);
const ServersTab = lazy(() => import('./tabs/ServersTab').then((m) => ({ default: m.ServersTab })));
const RadarTab = lazy(() => import('./tabs/RadarTab').then((m) => ({ default: m.RadarTab })));
const WeatherTab = lazy(() => import('./tabs/WeatherTab').then((m) => ({ default: m.WeatherTab })));
const PersonnelTab = lazy(() =>
  import('./tabs/PersonnelTab').then((m) => ({ default: m.PersonnelTab })),
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);
const DataManagerModal = lazy(() =>
  import('./components/DataManagerModal').then((m) => ({ default: m.DataManagerModal })),
);
const NotesTab = lazy(() => import('./tabs/NotesTab').then((m) => ({ default: m.NotesTab })));
const CloudStatusTab = lazy(() =>
  import('./tabs/CloudStatusTab').then((m) => ({ default: m.CloudStatusTab })),
);
const AlertsTab = lazy(() => import('./tabs/AlertsTab').then((m) => ({ default: m.AlertsTab })));
const PopoutBoard = lazy(() =>
  import('./components/PopoutBoard').then((m) => ({ default: m.PopoutBoard })),
);

const errorFallback = (reset: () => void) => <TabFallback error onReset={reset} />;

export function MainApp({ onReconfigure }: { readonly onReconfigure?: () => void } = {}) {
  const { showToast } = useToast();
  const deviceLocation = useLocation();

  const searchParams = new URLSearchParams(globalThis.location.search);
  const isPopout = searchParams.has('popout');
  const popoutRoute = searchParams.get('popout');

  const { data } = useAppData(showToast);

  const {
    weatherLocation,
    setWeatherLocation,
    weatherData,
    weatherAlerts,
    weatherLoading,
    fetchWeather,
  } = useAppWeather(deviceLocation, showToast);

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

  useEffect(() => {
    setMountedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  // Header search ref (for Cmd+K focus)
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Shortcuts modal state
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isDataManagerOpen, setIsDataManagerOpen] = useState(false);
  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState(false);
  const [initialContactEmail, setInitialContactEmail] = useState('');

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

  // Global keyboard shortcuts
  useEffect(() => {
    const tabMap: Record<string, string> = {
      '1': 'Compose',
      '2': 'Personnel',
      '3': 'People',
      '4': 'Weather',
      '5': 'Servers',
      '6': 'Radar',
      '7': 'Status',
      '8': 'Notes',
      '9': 'Alerts',
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+K to focus header search bar
      if (mod && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Cmd/Ctrl+, for Settings
      if (mod && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }

      // Cmd/Ctrl+? for Shortcuts (Shift+/)
      if (mod && e.shiftKey && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        setIsShortcutsOpen(true);
        return;
      }

      // Cmd/Ctrl+1-7 for tab navigation
      if (mod && !e.shiftKey && tabMap[e.key]) {
        e.preventDefault();
        setActiveTab(tabMap[e.key] as TabName);
      }
    };

    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTab, setSettingsOpen]);

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
                  teamLayout={data.teamLayout}
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
                  Radar: 'Radar',
                  Weather: 'Weather',
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
                onAddContactToBridge={(email) => {
                  handleAddManual(email);
                  setActiveTab('Compose');
                }}
                onToggleGroup={handleLoadGroupFromPalette}
                onNavigateToTab={(tab) => setActiveTab(tab as TabName)}
                onOpenAddContact={(email) => {
                  setInitialContactEmail(email || '');
                  setIsAddContactModalOpen(true);
                }}
              />
            </div>
            <div className="header-actions">
              <WorldClock />
            </div>
          </header>

          <div className="content-view">
            {mountedTabs.has('Compose') && (
              <div
                className={`tab-panel animate-fade-in${activeTab === 'Compose' ? ' tab-panel--active' : ''}`}
              >
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
              <div
                className={`tab-panel animate-fade-in${activeTab === 'Personnel' ? ' tab-panel--active' : ''}`}
              >
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <PersonnelTab
                      onCall={data.onCall}
                      contacts={data.contacts}
                      teamLayout={data.teamLayout}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {mountedTabs.has('People') && (
              <div
                className={`tab-panel animate-fade-in${activeTab === 'People' ? ' tab-panel--active' : ''}`}
              >
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <DirectoryTab
                      contacts={data.contacts}
                      groups={data.groups}
                      onAddToAssembler={handleAddToAssembler}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {mountedTabs.has('Weather') && (
              <div
                className={`tab-panel animate-fade-in${activeTab === 'Weather' ? ' tab-panel--active' : ''}`}
              >
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <WeatherTab
                      weather={weatherData}
                      alerts={weatherAlerts}
                      location={weatherLocation}
                      loading={weatherLoading}
                      onLocationChange={setWeatherLocation}
                      onManualRefresh={(lat: number, lon: number) => fetchWeather(lat, lon)}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {mountedTabs.has('Servers') && (
              <div
                className={`tab-panel animate-fade-in${activeTab === 'Servers' ? ' tab-panel--active' : ''}`}
              >
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <ServersTab servers={data.servers} contacts={data.contacts} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {mountedTabs.has('Radar') && (
              <div
                className={`tab-panel animate-fade-in${activeTab === 'Radar' ? ' tab-panel--active' : ''}`}
              >
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <RadarTab />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {mountedTabs.has('Notes') && (
              <div
                className={`tab-panel animate-fade-in${activeTab === 'Notes' ? ' tab-panel--active' : ''}`}
              >
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <NotesTab />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {mountedTabs.has('Status') && (
              <div
                className={`tab-panel animate-fade-in${activeTab === 'Status' ? ' tab-panel--active' : ''}`}
              >
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
              <div
                className={`tab-panel animate-fade-in${activeTab === 'Alerts' ? ' tab-panel--active' : ''}`}
              >
                <ErrorBoundary fallback={errorFallback}>
                  <Suspense fallback={<TabFallback />}>
                    <AlertsTab />
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
                onOpenDataManager={() => setIsDataManagerOpen(true)}
                onReconfigure={onReconfigure}
              />
            )}
            {isDataManagerOpen && (
              <DataManagerModal
                isOpen={isDataManagerOpen}
                onClose={() => setIsDataManagerOpen(false)}
              />
            )}
          </Suspense>
        </ErrorBoundary>

        <ErrorBoundary fallback={null}>
          <ShortcutsModal isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
        </ErrorBoundary>

        <ErrorBoundary fallback={null}>
          <AddContactModal
            isOpen={isAddContactModalOpen}
            onClose={() => setIsAddContactModalOpen(false)}
            onSave={handleContactSaved}
            initialEmail={initialContactEmail}
          />
        </ErrorBoundary>
      </div>
    </SearchProvider>
  );
}

type AppPhase =
  | { stage: 'checking' }
  | { stage: 'setup' }
  | { stage: 'connecting'; pbUrl: string; pbSecret: string }
  | { stage: 'error'; message: string };

function AppWithSetup() {
  const [phase, setPhase] = useState<AppPhase>({ stage: 'checking' });

  const checkConfig = useCallback(async () => {
    try {
      const configured = await globalThis.api!.isConfigured();
      if (!configured) {
        setPhase({ stage: 'setup' });
        return;
      }
      const pbUrl = await globalThis.api!.getPbUrl();
      const pbSecret = await globalThis.api!.getPbSecret();
      if (!pbUrl || !pbSecret) {
        setPhase({ stage: 'setup' });
        return;
      }
      setPhase({ stage: 'connecting', pbUrl, pbSecret });
    } catch (err) {
      loggers.app.error('Failed to check configuration', { error: err });
      setPhase({ stage: 'error', message: 'Failed to read configuration.' });
    }
  }, []);

  useEffect(() => {
    void checkConfig();
  }, [checkConfig]);

  const handleSetupComplete = useCallback(
    async (config: {
      mode: 'server' | 'client';
      port?: number;
      serverUrl?: string;
      secret: string;
    }) => {
      try {
        await globalThis.api!.saveConfig(config);
        // In server mode, start PocketBase before connecting
        if (config.mode === 'server') {
          const started = await globalThis.api!.startPocketBase();
          if (!started) {
            setPhase({ stage: 'error', message: 'Failed to start PocketBase server.' });
            return;
          }
        }
        // Go straight to connecting — we already know the URL and secret,
        // no need for another IPC roundtrip through checkConfig().
        const pbUrl = await globalThis.api!.getPbUrl();
        if (!pbUrl) {
          setPhase({ stage: 'error', message: 'Server not reachable.' });
          return;
        }
        setPhase({ stage: 'connecting', pbUrl, pbSecret: config.secret });
      } catch (err) {
        loggers.app.error('Failed to save configuration', { error: err });
        setPhase({ stage: 'error', message: 'Failed to save configuration.' });
      }
    },
    [],
  );

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
      <div className="app-state">
        <button
          className="app-state__close-btn"
          onClick={() => globalThis.window.api?.windowClose()}
          aria-label="Close"
        >
          &#10005;
        </button>
        <div className="app-state__error-icon" aria-hidden="true">
          !
        </div>
        <p className="app-state__error-text">{phase.message}</p>
        <TactileButton variant="primary" onClick={() => setPhase({ stage: 'setup' })}>
          Reconfigure
        </TactileButton>
      </div>
    );
  }

  return (
    <ConnectedApp
      pbUrl={phase.pbUrl}
      pbSecret={phase.pbSecret}
      onReconfigure={() => setPhase({ stage: 'setup' })}
    />
  );
}

function ConnectedApp({
  pbUrl,
  pbSecret,
  onReconfigure,
}: {
  readonly pbUrl: string;
  readonly pbSecret: string;
  readonly onReconfigure: () => void;
}) {
  const { connectionState, error } = usePocketBase(pbUrl, pbSecret);

  if (error) {
    return (
      <div className="app-state">
        <button
          className="app-state__close-btn"
          onClick={() => globalThis.window.api?.windowClose()}
          aria-label="Close"
        >
          &#10005;
        </button>
        <div className="app-state__error-icon" aria-hidden="true">
          !
        </div>
        <p className="app-state__error-text">{error}</p>
        <TactileButton variant="primary" onClick={onReconfigure}>
          Reconfigure
        </TactileButton>
      </div>
    );
  }

  if (connectionState === 'connecting') {
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
        <p className="app-state__text">Connecting to server...</p>
      </div>
    );
  }

  return (
    <>
      <MainApp onReconfigure={onReconfigure} />
      <ConnectionStatus />
    </>
  );
}

export default function App() {
  const isPopout = new URLSearchParams(globalThis.location.search).has('popout');
  const ToastWrapper = isPopout ? NoopToastProvider : ToastProvider;

  return (
    <ErrorBoundary>
      <ToastWrapper>
        <LocationProvider>
          <NotesProvider>
            <AppWithSetup />
          </NotesProvider>
        </LocationProvider>
      </ToastWrapper>
    </ErrorBoundary>
  );
}
