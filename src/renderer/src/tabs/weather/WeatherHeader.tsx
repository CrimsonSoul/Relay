import React from "react";
import { TactileButton } from "../../components/TactileButton";
import { SearchInput } from "../../components/SearchInput";
import { CollapsibleHeader } from "../../components/CollapsibleHeader";
import type { Location, SavedLocation } from "../../shared/ipc";
import type { WeatherData } from "./types";
import { getWeatherDescription } from "./utils";

type WeatherHeaderProps = {
  location: Location | null;
  activeSavedLocation: SavedLocation | null;
  weather: WeatherData | null;
  loading: boolean;
  isSearching: boolean;
  loc: {
    manualInput: string;
    setManualInput: (val: string) => void;
    error: string | null;
  };
  handleManualSearch: () => void;
  handleAutoLocate: () => void;
  showLocationMenu: boolean;
  setShowLocationMenu: (show: boolean) => void;
  locationMenuRef: React.RefObject<HTMLDivElement>;
  savedLocations: SavedLocation[];
  setSaveModalOpen: (open: boolean) => void;
  handleSelectSavedLocation: (saved: SavedLocation) => void;
  handleOpenRename: (saved: SavedLocation) => void;
  setLocationToDelete: (loc: SavedLocation | null) => void;
  clearDefaultLocation: (id: string) => void;
  setDefaultLocation: (id: string) => void;
};

export const WeatherHeader: React.FC<WeatherHeaderProps> = ({
  location,
  activeSavedLocation,
  weather,
  isSearching,
  loc,
  handleManualSearch,
  handleAutoLocate,
  showLocationMenu,
  setShowLocationMenu,
  locationMenuRef,
  savedLocations,
  setSaveModalOpen,
  handleSelectSavedLocation,
  handleOpenRename,
  setLocationToDelete,
  clearDefaultLocation,
  setDefaultLocation,
}) => {
  return (
    <CollapsibleHeader
      title={activeSavedLocation ? `${activeSavedLocation.name} — ${location?.name || ""}` : (location?.name || "Weather")}
      subtitle={weather ? `${Math.round(weather.current_weather.temperature)}°F • ${getWeatherDescription(weather.current_weather.weathercode)}` : "Local weather conditions and alerts"}
      isCollapsed={false}
      search={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {loc.error && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 16px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.2)", color: "#ff8a8a", borderRadius: "16px", fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", height: "44px", animation: "fadeIn 0.2s ease-out", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><title>Error</title><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <span>{loc.error}</span>
            </div>
          )}
          <SearchInput 
            style={{ height: "44px" }} 
            placeholder={isSearching ? "Searching..." : "Search city..."} 
            value={loc.manualInput} 
            onChange={(e) => loc.setManualInput(e.target.value)} 
            onKeyDown={(e) => e.key === "Enter" && handleManualSearch()} 
            disabled={isSearching}
          />
        </div>
      }
    >
      <TactileButton 
        onClick={handleManualSearch} 
        variant="primary" 
        title="Search" 
        aria-label="Search city"
        disabled={isSearching}
        style={{ transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} 
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><title>Search</title><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>} 
      />
      <TactileButton 
        onClick={handleAutoLocate} 
        title="Detect Location" 
        aria-label="Detect current location"
        disabled={isSearching}
        style={{ transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} 
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><title>Locate</title><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>} 
      />

      <div style={{ position: "relative" }} ref={locationMenuRef}>
        <TactileButton
          onClick={() => setShowLocationMenu(!showLocationMenu)}
          title="Saved Locations"
          aria-label="Toggle saved locations menu"
          style={{ transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <title>Saved Locations</title>
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
            {location && (
              <button
                type="button"
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
                  <title>Add</title>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Save "{location.name}"
              </button>
            )}

            {savedLocations.length > 0 ? (
              <div style={{ maxHeight: "240px", overflowY: "auto" }}>
                {savedLocations.map((saved) => (
                  <button
                    key={saved.id}
                    type="button"
                    className="weather-saved-location-item"
                    onKeyDown={(e) => e.key === "Enter" && handleSelectSavedLocation(saved)}
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
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleOpenRename(saved); }}
                        title="Rename"
                        aria-label={`Rename ${saved.name}`}
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
                          <title>Edit</title>
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      {saved.isDefault ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void clearDefaultLocation(saved.id); }}
                          title="Clear default"
                          aria-label={`Remove ${saved.name} as default`}
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
                            <title>Favorite</title>
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void setDefaultLocation(saved.id); }}
                          title="Set as default"
                          aria-label={`Set ${saved.name} as default`}
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
                            <title>Make Favorite</title>
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setLocationToDelete(saved); setShowLocationMenu(false); }}
                        title="Delete"
                        aria-label={`Delete ${saved.name}`}
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
                          <title>Delete</title>
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px" }}>
                No saved locations yet
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleHeader>
  );
};
