import React, { useState, useRef, useEffect } from "react";
import { TabFallback } from "../components/TabFallback";
import { CollapsibleHeader } from "../components/CollapsibleHeader";
import { TactileButton } from "../components/TactileButton";
import { SearchInput } from "../components/SearchInput";
import { WeatherAlertCard, HourlyForecast, DailyForecast, RadarPanel, getWeatherDescription, type WeatherTabProps } from "./weather";
import { useWeatherLocation } from "../hooks/useWeatherLocation";
import { useSavedLocations } from "../hooks/useSavedLocations";
import type { SavedLocation } from "@shared/ipc";

export const WeatherTab: React.FC<WeatherTabProps> = ({ weather, alerts, location, loading, onLocationChange, onManualRefresh }) => {
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const loc = useWeatherLocation(location, loading, onLocationChange, onManualRefresh);

  // Saved locations state
  const { locations: savedLocations, saveLocation, deleteLocation, setDefaultLocation, clearDefaultLocation, updateLocation } = useSavedLocations();
  const [showLocationMenu, setShowLocationMenu] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [renameModal, setRenameModal] = useState<SavedLocation | null>(null);
  const [renameName, setRenameName] = useState("");
  const [activeSavedLocation, setActiveSavedLocation] = useState<SavedLocation | null>(null);
  const locationMenuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showLocationMenu) return;
    const handler = (e: MouseEvent) => {
      if (locationMenuRef.current && !locationMenuRef.current.contains(e.target as Node)) {
        setShowLocationMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLocationMenu]);

  const handleSaveLocation = async () => {
    if (!saveName.trim() || !location) return;
    await saveLocation({
      name: saveName.trim(),
      lat: location.latitude,
      lon: location.longitude,
      isDefault: saveAsDefault,
    });
    setSaveName("");
    setSaveAsDefault(false);
    setSaveModalOpen(false);
  };

  const handleSelectSavedLocation = async (saved: SavedLocation) => {
    // Reverse geocode to get the city name
    try {
      const data = await window.api.searchLocation(`${saved.lat},${saved.lon}`);
      const cityName = data.results?.[0]
        ? `${data.results[0].name}, ${data.results[0].admin1 || ''} ${data.results[0].country_code}`.trim()
        : saved.name;
      onLocationChange({ name: cityName, latitude: saved.lat, longitude: saved.lon });
    } catch {
      onLocationChange({ name: saved.name, latitude: saved.lat, longitude: saved.lon });
    }
    setActiveSavedLocation(saved);
    onManualRefresh(saved.lat, saved.lon);
    setShowLocationMenu(false);
  };

  const handleOpenRename = (saved: SavedLocation) => {
    setRenameName(saved.name);
    setRenameModal(saved);
    setShowLocationMenu(false);
  };

  const handleRename = async () => {
    if (!renameModal || !renameName.trim()) return;
    await updateLocation(renameModal.id, { name: renameName.trim() });
    setRenameModal(null);
    setRenameName("");
  };

  // Wrappers to clear active saved location on manual actions
  const handleManualSearch = () => {
    setActiveSavedLocation(null);
    loc.handleManualSearch();
  };

  const handleAutoLocate = () => {
    setActiveSavedLocation(null);
    loc.handleAutoLocate();
  };

  if (!location && loading) return <TabFallback />;

  return (
    <div className="weather-scroll-container" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "var(--color-bg-app)", padding: "20px 24px", gap: "12px", overflow: "hidden" }}>
      <CollapsibleHeader
        title={activeSavedLocation ? `${activeSavedLocation.name} — ${location?.name || ""}` : (location?.name || "Weather")}
        subtitle={weather ? `${Math.round(weather.current_weather.temperature)}°F • ${getWeatherDescription(weather.current_weather.weathercode)}` : "Local weather conditions and alerts"}
        isCollapsed={false}
        search={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {loc.error && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 16px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.2)", color: "#ff8a8a", borderRadius: "16px", fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", height: "44px", animation: "fadeIn 0.2s ease-out", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                <span>Location not found</span>
              </div>
            )}
            <SearchInput style={{ height: "44px" }} placeholder="Search city..." value={loc.manualInput} onChange={(e) => loc.setManualInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleManualSearch()} />
          </div>
        }
      >
        <TactileButton onClick={handleManualSearch} variant="primary" title="Search" style={{ transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>} />
        <TactileButton onClick={handleAutoLocate} title="Detect Location" style={{ transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>} />

        {/* Saved Locations Dropdown */}
        <div style={{ position: "relative" }} ref={locationMenuRef}>
          <TactileButton
            onClick={() => setShowLocationMenu(!showLocationMenu)}
            title="Saved Locations"
            style={{ transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            }
          />

          {showLocationMenu && (
            <div
              className="animate-slide-down"
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                width: "280px",
                background: "var(--color-bg-surface-opaque)",
                borderRadius: "12px",
                border: "1px solid var(--color-border-medium)",
                boxShadow: "var(--shadow-lg)",
                overflow: "hidden",
                zIndex: 100,
              }}>
              {/* Save current location button */}
              {location && (
                <button
                  onClick={() => { setSaveModalOpen(true); setShowLocationMenu(false); }}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    background: "none",
                    border: "none",
                    borderBottom: "1px solid var(--color-border-subtle)",
                    color: "rgba(52, 211, 153, 1)",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    textAlign: "left",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Save "{location.name}"
                </button>
              )}

              {/* Saved locations list */}
              {savedLocations.length > 0 ? (
                <div style={{ maxHeight: "240px", overflowY: "auto" }}>
                  {savedLocations.map((saved) => (
                    <div
                      key={saved.id}
                      style={{
                        padding: "10px 16px",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        borderBottom: "1px solid var(--color-border-subtle)",
                        cursor: "pointer",
                        transition: "background 0.1s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      onClick={() => handleSelectSavedLocation(saved)}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "var(--color-text-primary)",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}>
                          {saved.name}
                          {saved.isDefault && (
                            <span style={{
                              fontSize: "10px",
                              background: "rgba(236, 201, 75, 0.15)",
                              color: "rgba(236, 201, 75, 1)",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontWeight: 700,
                            }}>
                              DEFAULT
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                          {saved.lat.toFixed(2)}, {saved.lon.toFixed(2)}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "4px" }}>
                        {/* Rename button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenRename(saved); }}
                          title="Rename"
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--color-text-tertiary)",
                            cursor: "pointer",
                            padding: "4px",
                            borderRadius: "4px",
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        {/* Set/Clear default button */}
                        {saved.isDefault ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); clearDefaultLocation(saved.id); }}
                            title="Clear default"
                            style={{
                              background: "none",
                              border: "none",
                              color: "rgba(236, 201, 75, 1)",
                              cursor: "pointer",
                              padding: "4px",
                              borderRadius: "4px",
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDefaultLocation(saved.id); }}
                            title="Set as default"
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--color-text-tertiary)",
                              cursor: "pointer",
                              padding: "4px",
                              borderRadius: "4px",
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                          </button>
                        )}
                        {/* Delete button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteLocation(saved.id); }}
                          title="Delete"
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--color-text-tertiary)",
                            cursor: "pointer",
                            padding: "4px",
                            borderRadius: "4px",
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  padding: "24px 16px",
                  textAlign: "center",
                  color: "var(--color-text-tertiary)",
                  fontSize: "13px",
                }}>
                  No saved locations yet
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleHeader>

      {/* Save Location Modal */}
      {saveModalOpen && (
        <div
          className="animate-fade-in"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={() => setSaveModalOpen(false)}
        >
          <div
            className="animate-scale-in"
            style={{
              width: "100%",
              maxWidth: "380px",
              background: "var(--color-bg-surface-opaque)",
              borderRadius: "12px",
              border: "1px solid var(--color-border-medium)",
              boxShadow: "var(--shadow-modal)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border-subtle)" }}>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                Save Location
              </div>
              <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
                {location?.name} ({location?.latitude.toFixed(4)}, {location?.longitude.toFixed(4)})
              </div>
            </div>
            <div style={{ padding: "20px" }}>
              <label style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--color-text-secondary)",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}>
                Name
              </label>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g., HQ, Store #1234"
                autoFocus
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "14px",
                  background: "rgba(0, 0, 0, 0.2)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "8px",
                  color: "var(--color-text-primary)",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <label style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginTop: "16px",
                cursor: "pointer",
                fontSize: "13px",
                color: "var(--color-text-secondary)",
              }}>
                <input
                  type="checkbox"
                  checked={saveAsDefault}
                  onChange={(e) => setSaveAsDefault(e.target.checked)}
                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                />
                Set as default location
              </label>
            </div>
            <div style={{
              padding: "16px 20px",
              borderTop: "1px solid var(--color-border-subtle)",
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
            }}>
              <button
                onClick={() => setSaveModalOpen(false)}
                style={{
                  padding: "10px 20px",
                  fontSize: "13px",
                  fontWeight: 600,
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "var(--color-text-secondary)",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLocation}
                disabled={!saveName.trim()}
                style={{
                  padding: "10px 20px",
                  fontSize: "13px",
                  fontWeight: 600,
                  background: saveName.trim() ? "rgba(52, 211, 153, 0.15)" : "rgba(255, 255, 255, 0.05)",
                  color: saveName.trim() ? "rgba(52, 211, 153, 1)" : "var(--color-text-tertiary)",
                  border: "none",
                  borderRadius: "8px",
                  cursor: saveName.trim() ? "pointer" : "not-allowed",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (saveName.trim()) e.currentTarget.style.background = "rgba(52, 211, 153, 0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = saveName.trim() ? "rgba(52, 211, 153, 0.15)" : "rgba(255, 255, 255, 0.05)";
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Location Modal */}
      {renameModal && (
        <div
          className="animate-fade-in"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={() => setRenameModal(null)}
        >
          <div
            className="animate-scale-in"
            style={{
              width: "100%",
              maxWidth: "380px",
              background: "var(--color-bg-surface-opaque)",
              borderRadius: "12px",
              border: "1px solid var(--color-border-medium)",
              boxShadow: "var(--shadow-modal)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border-subtle)" }}>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                Rename Location
              </div>
              <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
                {renameModal.lat.toFixed(4)}, {renameModal.lon.toFixed(4)}
              </div>
            </div>
            <div style={{ padding: "20px" }}>
              <label style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--color-text-secondary)",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}>
                Name
              </label>
              <input
                type="text"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder="Location name"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && renameName.trim() && handleRename()}
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "14px",
                  background: "rgba(0, 0, 0, 0.2)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "8px",
                  color: "var(--color-text-primary)",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
            </div>
            <div style={{
              padding: "16px 20px",
              borderTop: "1px solid var(--color-border-subtle)",
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
            }}>
              <button
                onClick={() => setRenameModal(null)}
                style={{
                  padding: "10px 20px",
                  fontSize: "13px",
                  fontWeight: 600,
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "var(--color-text-secondary)",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={!renameName.trim()}
                style={{
                  padding: "10px 20px",
                  fontSize: "13px",
                  fontWeight: 600,
                  background: renameName.trim() ? "rgba(59, 130, 246, 0.15)" : "rgba(255, 255, 255, 0.05)",
                  color: renameName.trim() ? "rgba(59, 130, 246, 1)" : "var(--color-text-tertiary)",
                  border: "none",
                  borderRadius: "8px",
                  cursor: renameName.trim() ? "pointer" : "not-allowed",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (renameName.trim()) e.currentTarget.style.background = "rgba(59, 130, 246, 0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = renameName.trim() ? "rgba(59, 130, 246, 0.15)" : "rgba(255, 255, 255, 0.05)";
                }}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="weather-tab-root weather-scroll-container" style={{ display: "flex", gap: "16px", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div className="weather-forecast-column weather-scroll-container" style={{ display: "flex", flexDirection: "column", gap: "16px", flex: "0 0 35%", minWidth: "300px", overflowY: "auto" }}>
          {alerts.length > 0 && alerts.map((alert) => <WeatherAlertCard key={alert.id} alert={alert} isExpanded={expandedAlert === alert.id} onToggle={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)} />)}
          <HourlyForecast weather={weather} />
          <DailyForecast weather={weather} />
        </div>
        <RadarPanel location={location} />
      </div>
    </div>
  );
};
