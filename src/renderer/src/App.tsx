import { LocationProvider, useLocation, NotesProvider } from './contexts';
import { useEffect, useState, useCallback, Suspense, lazy } from 'react';
import { Sidebar } from './components/Sidebar';
import { WorldClock } from './components/WorldClock';
import { AssemblerTab } from './tabs/AssemblerTab';
import { WindowControls } from './components/WindowControls';
import { ToastProvider, NoopToastProvider, useToast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabFallback } from './components/TabFallback';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsModal } from './components/ShortcutsModal';
import { AddContactModal } from './components/AddContactModal';
import { Contact } from '@shared/ipc';
import { loggers } from './utils/logger';
// Hooks
import { useAppWeather } from './hooks/useAppWeather';
import { useAppData } from './hooks/useAppData';
import { useAppAssembler } from './hooks/useAppAssembler';

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
const AIChatTab = lazy(() => import('./tabs/AIChatTab').then((m) => ({ default: m.AIChatTab })));
const PopoutBoard = lazy(() =>
  import('./components/PopoutBoard').then((m) => ({ default: m.PopoutBoard })),
);

export function MainApp() {
  const { showToast } = useToast();
  const deviceLocation = useLocation();

  const searchParams = new URLSearchParams(window.location.search);
  const isPopout = searchParams.has('popout');
  const popoutRoute = searchParams.get('popout');

  const { data, isReloading, handleSync } = useAppData(showToast);

  const {
    weatherLocation,
    setWeatherLocation,
    weatherData,
    weatherAlerts,
    weatherLoading,
    fetchWeather,
  } = useAppWeather(deviceLocation, showToast);

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

  // Command Palette and Shortcuts modal state
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isDataManagerOpen, setIsDataManagerOpen] = useState(false);
  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState(false);
  const [initialContactEmail, setInitialContactEmail] = useState('');

  // Handler for saving contact
  const handleContactSaved = async (contact: Partial<Contact>) => {
    if (!window.api) {
      showToast('API not available', 'error');
      return;
    }
    try {
      const result = await window.api.addContact(contact);
      if (result.success) {
        showToast('Contact created successfully', 'success');
      } else {
        showToast(result.error || 'Failed to create contact', 'error');
      }
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
    const platform = window.api?.platform || 'win32';
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
      '7': 'AI',
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+K for Command Palette
      if (mod && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
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
        setActiveTab(tabMap[e.key]);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTab, setSettingsOpen]); // Removed setIsCommandPaletteOpen, setIsShortcutsOpen

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
            <ErrorBoundary fallback={<TabFallback error />}>
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
              Relay / {activeTab === 'Personnel' ? 'On-Call Board' : activeTab}
            </span>
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
              <ErrorBoundary fallback={<TabFallback error />}>
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
              <ErrorBoundary fallback={<TabFallback error />}>
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
              <ErrorBoundary fallback={<TabFallback error />}>
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
              <ErrorBoundary fallback={<TabFallback error />}>
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
              <ErrorBoundary fallback={<TabFallback error />}>
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
              <ErrorBoundary fallback={<TabFallback error />}>
                <Suspense fallback={<TabFallback />}>
                  <RadarTab />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
          {mountedTabs.has('AI') && (
            <div
              className={`tab-panel animate-fade-in${activeTab === 'AI' ? ' tab-panel--active' : ''}`}
            >
              <ErrorBoundary fallback={<TabFallback error />}>
                <Suspense fallback={<TabFallback />}>
                  <AIChatTab />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </div>
      </main>

      <div className="window-controls-container">
        <WindowControls />
      </div>

      <ErrorBoundary fallback={<TabFallback error />}>
        <Suspense fallback={null}>
          {settingsOpen && (
            <SettingsModal
              isOpen={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              isSyncing={isReloading}
              onSync={handleSync}
              onOpenDataManager={() => setIsDataManagerOpen(true)}
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
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          contacts={data.contacts}
          servers={data.servers}
          groups={data.groups}
          onAddContactToBridge={(email) => {
            handleAddManual(email);
            setActiveTab('Compose');
          }}
          onToggleGroup={handleLoadGroupFromPalette}
          onNavigateToTab={setActiveTab}
          onOpenAddContact={(email) => {
            setInitialContactEmail(email || '');
            setIsAddContactModalOpen(true);
          }}
        />
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
  );
}

export default function App() {
  const isPopout = new URLSearchParams(window.location.search).has('popout');
  const ToastWrapper = isPopout ? NoopToastProvider : ToastProvider;

  return (
    <ErrorBoundary>
      <ToastWrapper>
        <LocationProvider>
          <NotesProvider>
            <MainApp />
          </NotesProvider>
        </LocationProvider>
      </ToastWrapper>
    </ErrorBoundary>
  );
}
