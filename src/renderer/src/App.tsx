import { LocationProvider, useLocation, NotesProvider } from './contexts';
import React, { useEffect, useState, useCallback, Suspense, lazy } from "react";
import { Sidebar } from "./components/Sidebar";
import { WorldClock } from "./components/WorldClock";
import { AssemblerTab } from "./tabs/AssemblerTab";
import { WindowControls } from "./components/WindowControls";
import { ToastProvider, useToast } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TabFallback } from "./components/TabFallback";
import { CommandPalette } from "./components/CommandPalette";
import { ShortcutsModal } from "./components/ShortcutsModal";
import "./styles.css";

// Hooks
import { useAppWeather } from "./hooks/useAppWeather";
import { useAppData } from "./hooks/useAppData";
import { useAppAssembler } from "./hooks/useAppAssembler";

// Lazy load non-default tabs and settings modal
const DirectoryTab = lazy(() => import("./tabs/DirectoryTab").then((m) => ({ default: m.DirectoryTab })));
const ServersTab = lazy(() => import("./tabs/ServersTab").then((m) => ({ default: m.ServersTab })));
const RadarTab = lazy(() => import("./tabs/RadarTab").then((m) => ({ default: m.RadarTab })));
const WeatherTab = lazy(() => import("./tabs/WeatherTab").then((m) => ({ default: m.WeatherTab })));
const PersonnelTab = lazy(() => import("./tabs/PersonnelTab").then((m) => ({ default: m.PersonnelTab })));
const SettingsModal = lazy(() => import("./components/SettingsModal").then((m) => ({ default: m.SettingsModal })));
const DataManagerModal = lazy(() => import("./components/DataManagerModal").then((m) => ({ default: m.DataManagerModal })));
const AIChatTab = lazy(() => import("./tabs/AIChatTab").then((m) => ({ default: m.AIChatTab })));

export function MainApp() {
  const { showToast } = useToast();
  const deviceLocation = useLocation();

  const { data, isReloading, handleSync } = useAppData(showToast);
  
  const {
    weatherLocation, setWeatherLocation, weatherData,
    weatherAlerts, weatherLoading, fetchWeather
  } = useAppWeather(deviceLocation, showToast);

  const {
    activeTab, setActiveTab, selectedGroupIds, setSelectedGroupIds, manualAdds, setManualAdds,
    manualRemoves, settingsOpen, setSettingsOpen,
    handleAddToAssembler, handleUndoRemove, handleReset,
    handleAddManual, handleRemoveManual, handleToggleGroup,
  } = useAppAssembler(isReloading);

  // Command Palette and Shortcuts modal state
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isDataManagerOpen, setIsDataManagerOpen] = useState(false);

  // Handler for loading group from command palette
  const handleLoadGroupFromPalette = useCallback((groupId: string) => {
    // Toggle the group selection
    setSelectedGroupIds(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
    setActiveTab("Compose");
  }, [setSelectedGroupIds, setActiveTab]);

  // Platform and Global Interaction Logic
  useEffect(() => {
    const platform = window.api?.platform || (navigator.platform.toLowerCase().includes("mac") ? "darwin" : "win32");
    document.body.classList.add(`platform-${platform}`);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const tabMap: Record<string, string> = {
      "1": "Compose",
      "2": "Personnel",
      "3": "People",
      "4": "Weather",
      "5": "Servers",
      "6": "Radar",
      "7": "AI",
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+K for Command Palette
      if (mod && e.key === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      // Cmd/Ctrl+, for Settings
      if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }

      // Cmd/Ctrl+? for Shortcuts (Shift+/)
      if (mod && e.shiftKey && (e.key === "/" || e.key === "?")) {
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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setActiveTab, setSettingsOpen, setIsCommandPaletteOpen, setIsShortcutsOpen]);

  return (
    <div className="app-container">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="main-content">
        <header className="app-header">
          <div className="header-title-container">
            <span className="header-breadcrumb">Relay / {activeTab === "Personnel" ? "On-Call Board" : activeTab}</span>
          </div>
          <div className="header-actions">
            <WorldClock />
          </div>
        </header>

        <div className="content-view">
          {activeTab === "Compose" && (
            <div className="animate-fade-in" style={{ height: "100%" }}>
              <AssemblerTab
                groups={data.groups} contacts={data.contacts} onCall={data.onCall}
                selectedGroupIds={selectedGroupIds} manualAdds={manualAdds} manualRemoves={manualRemoves}
                onToggleGroup={handleToggleGroup} onAddManual={handleAddManual}
                onRemoveManual={handleRemoveManual} onUndoRemove={handleUndoRemove} onResetManual={handleReset}
                setSelectedGroupIds={setSelectedGroupIds} setManualAdds={setManualAdds}
              />
            </div>
          )}
          {activeTab === "Personnel" && (
            <div className="animate-fade-in" style={{ height: "100%" }}>
              <Suspense fallback={<TabFallback />}>
                <PersonnelTab onCall={data.onCall} contacts={data.contacts} />
              </Suspense>
            </div>
          )}
          {activeTab === "People" && (
            <div className="animate-fade-in" style={{ height: "100%" }}>
              <Suspense fallback={<TabFallback />}>
                <DirectoryTab contacts={data.contacts} groups={data.groups} onAddToAssembler={handleAddToAssembler} />
              </Suspense>
            </div>
          )}
          {activeTab === "Weather" && (
            <div className="animate-fade-in" style={{ height: "100%" }}>
              <Suspense fallback={<TabFallback />}>
                <WeatherTab
                  weather={weatherData} alerts={weatherAlerts} location={weatherLocation}
                  loading={weatherLoading} onLocationChange={setWeatherLocation}
                  onManualRefresh={(lat: number, lon: number) => fetchWeather(lat, lon)}
                />
              </Suspense>
            </div>
          )}
          {activeTab === "Servers" && (
            <div className="animate-fade-in" style={{ height: "100%" }}>
              <Suspense fallback={<TabFallback />}>
                <ServersTab servers={data.servers} contacts={data.contacts} />
              </Suspense>
            </div>
          )}
          {activeTab === "Radar" && (
            <div className="animate-fade-in" style={{ height: "100%" }}>
              <Suspense fallback={<TabFallback />}>
                <RadarTab />
              </Suspense>
            </div>
          )}
          {activeTab === "AI" && (
            <div className="animate-fade-in" style={{ height: "100%" }}>
              <Suspense fallback={<TabFallback />}>
                <AIChatTab />
              </Suspense>
            </div>
          )}
        </div>
      </main>

      <div className="window-controls-container">
        <WindowControls />
      </div>

      <Suspense fallback={null}>
        {settingsOpen && (
          <SettingsModal
            isOpen={settingsOpen} onClose={() => setSettingsOpen(false)}
            isSyncing={isReloading} onSync={handleSync}
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

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        contacts={data.contacts}
        servers={data.servers}
        groups={data.groups}
        onAddContactToBridge={(email) => {
          handleAddManual(email);
          setActiveTab("Compose");
        }}
        onToggleGroup={handleLoadGroupFromPalette}
        onNavigateToTab={setActiveTab}
      />

      <ShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <LocationProvider>
          <NotesProvider>
            <MainApp />
          </NotesProvider>
        </LocationProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
