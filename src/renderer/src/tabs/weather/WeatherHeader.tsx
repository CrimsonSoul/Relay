import React, { useState, useRef, useEffect } from 'react';
import { TactileButton } from '../../components/TactileButton';
import { CollapsibleHeader } from '../../components/CollapsibleHeader';
import type { SavedLocation } from '@shared/ipc';
import type { Location, WeatherData } from './types';
import { getWeatherDescription } from './utils';

type WeatherHeaderProps = {
  location: Location | null;
  activeSavedLocation: SavedLocation | null;
  weather: WeatherData | null;
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
  const [showSearchPopover, setShowSearchPopover] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showSearchPopover) {
      searchInputRef.current?.focus();
    }
  }, [showSearchPopover]);

  useEffect(() => {
    if (!showSearchPopover) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (searchPopoverRef.current && !searchPopoverRef.current.contains(e.target as Node)) {
        setShowSearchPopover(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSearchPopover]);

  const handleSearchSubmit = () => {
    if (loc.manualInput.trim()) {
      handleManualSearch();
      setShowSearchPopover(false);
    }
  };

  return (
    <CollapsibleHeader
      title={activeSavedLocation ? `${activeSavedLocation.name}` : location?.name || 'Weather'}
      subtitle={
        weather
          ? `${Math.round(weather.current_weather.temperature)}°F • ${getWeatherDescription(weather.current_weather.weathercode)}`
          : undefined
      }
      isCollapsed={false}
    >
      <div className="weather-search-popover-anchor" ref={searchPopoverRef}>
        <TactileButton
          onClick={() => setShowSearchPopover(!showSearchPopover)}
          variant={showSearchPopover ? 'primary' : 'ghost'}
          title="Search"
          aria-label="Search city"
          disabled={isSearching}
          icon={
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
        />
        {showSearchPopover && (
          <div className="animate-slide-down weather-search-popover">
            {loc.error && (
              <div className="weather-error-badge">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <title>Error</title>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{loc.error}</span>
              </div>
            )}
            <input
              ref={searchInputRef}
              className="weather-search-popover-input"
              type="text"
              placeholder={isSearching ? 'Searching...' : 'Search city...'}
              value={loc.manualInput}
              onChange={(e) => loc.setManualInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearchSubmit();
                if (e.key === 'Escape') setShowSearchPopover(false);
              }}
              disabled={isSearching}
            />
          </div>
        )}
      </div>
      <TactileButton
        variant="ghost"
        onClick={handleAutoLocate}
        title="Detect Location"
        aria-label="Detect current location"
        disabled={isSearching}
        icon={
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M23 4v6h-6" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        }
      />

      <div className="weather-location-menu-anchor" ref={locationMenuRef}>
        <TactileButton
          variant="ghost"
          onClick={() => setShowLocationMenu(!showLocationMenu)}
          title="Saved Locations"
          aria-label="Toggle saved locations menu"
          icon={
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          }
        />

        {showLocationMenu && (
          <div className="animate-slide-down weather-location-menu">
            {location && (
              <button
                type="button"
                onClick={() => {
                  setSaveModalOpen(true);
                  setShowLocationMenu(false);
                }}
                className="weather-save-location-btn"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <title>Add</title>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Save "{location.name}"
              </button>
            )}

            {savedLocations.length > 0 ? (
              <div className="weather-saved-list">
                {savedLocations.map((saved) => (
                  <div key={saved.id} className="weather-saved-location-item">
                    <button
                      type="button"
                      aria-label={`Load ${saved.name}`}
                      className="weather-saved-item-info weather-saved-item-info-btn"
                      onClick={() => handleSelectSavedLocation(saved)}
                    >
                      <div className="weather-saved-item-name">
                        {saved.name}
                        {saved.isDefault && (
                          <span className="weather-saved-item-default-badge">DEFAULT</span>
                        )}
                      </div>
                      <div className="weather-saved-item-coords">
                        {saved.lat.toFixed(2)}, {saved.lon.toFixed(2)}
                      </div>
                    </button>
                    <div className="weather-saved-item-actions">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenRename(saved);
                        }}
                        title="Rename"
                        aria-label={`Rename ${saved.name}`}
                        className="weather-saved-action-btn"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <title>Edit</title>
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      {saved.isDefault ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearDefaultLocation(saved.id);
                          }}
                          title="Clear default"
                          aria-label={`Remove ${saved.name} as default`}
                          className="weather-saved-action-btn weather-saved-action-btn--active"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <title>Favorite</title>
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDefaultLocation(saved.id);
                          }}
                          title="Set as default"
                          aria-label={`Set ${saved.name} as default`}
                          className="weather-saved-action-btn"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <title>Make Favorite</title>
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocationToDelete(saved);
                          setShowLocationMenu(false);
                        }}
                        title="Delete"
                        aria-label={`Delete ${saved.name}`}
                        className="weather-saved-action-btn"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <title>Delete</title>
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="weather-location-empty">No saved locations yet</div>
            )}
          </div>
        )}
      </div>
    </CollapsibleHeader>
  );
};
