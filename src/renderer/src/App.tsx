import { LocationProvider, useLocation } from './contexts';
import React, { useEffect, Suspense, lazy } from "react";
import { Sidebar } from "./components/Sidebar";
import { WorldClock } from "./components/WorldClock";
import { AssemblerTab } from "./tabs/AssemblerTab";
import { WindowControls } from "./components/WindowControls";
import { ToastProvider, useToast } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TabFallback } from "./components/TabFallback";
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
    activeTab, setActiveTab, selectedGroups, manualAdds,
    manualRemoves, settingsOpen, setSettingsOpen,
    handleAddToAssembler, handleUndoRemove, handleReset,
    handleAddManual, handleRemoveManual, handleToggleGroup,
    handleImportGroups, handleImportContacts, handleImportServers
  } = useAppAssembler(isReloading);

  // Platform and Global Interaction Logic
  useEffect(() => {
    const platform = window.api?.platform || (navigator.platform.toLowerCase().includes("mac") ? "darwin" : "win32");
    document.body.classList.add(`platform-${platform}`);
  }, []);

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
                selectedGroups={selectedGroups} manualAdds={manualAdds} manualRemoves={manualRemoves}
                onToggleGroup={handleToggleGroup} onAddManual={handleAddManual}
                onRemoveManual={handleRemoveManual} onUndoRemove={handleUndoRemove} onResetManual={handleReset}
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
            onImportGroups={handleImportGroups} onImportContacts={handleImportContacts} onImportServers={handleImportServers}
          />
        )}
      </Suspense>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <LocationProvider>
          <MainApp />
        </LocationProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
