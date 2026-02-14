import React from 'react';
import { TactileButton } from '../../components/TactileButton';
import { SearchInput } from '../../components/SearchInput';
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
  return (
    <CollapsibleHeader
      title={activeSavedLocation ? `${activeSavedLocation.name}` : location?.name || 'Weather'}
      subtitle={
        weather
          ? `${Math.round(weather.current_weather.temperature)}°F • ${getWeatherDescription(weather.current_weather.weathercode)}`
          : 'Local weather conditions and alerts'
      }
      isCollapsed={false}
      expandedTitleSize="clamp(24px, 4vw, 36px)"
      collapsedTitleSize="clamp(20px, 3.2vw, 30px)"
      search={
        <div className="weather-search-bar">
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
          <SearchInput
            style={{ height: '40px' }}
            placeholder={isSearching ? 'Searching...' : 'Search city...'}
            value={loc.manualInput}
            onChange={(e) => loc.setManualInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
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
        icon={
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Search</title>
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        }
      />
      <TactileButton
        onClick={handleAutoLocate}
        title="Detect Location"
        aria-label="Detect current location"
        disabled={isSearching}
        icon={
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Locate</title>
            <path d="M23 4v6h-6"></path>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
        }
      />

      <div className="weather-location-menu-anchor" ref={locationMenuRef}>
        <TactileButton
          onClick={() => setShowLocationMenu(!showLocationMenu)}
          title="Saved Locations"
          aria-label="Toggle saved locations menu"
          icon={
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>Saved Locations</title>
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
                  <button
                    key={saved.id}
                    type="button"
                    className="weather-saved-location-item"
                    onKeyDown={(e) => e.key === 'Enter' && handleSelectSavedLocation(saved)}
                    onClick={() => handleSelectSavedLocation(saved)}
                  >
                    <div className="weather-saved-item-info">
                      <div className="weather-saved-item-name">
                        {saved.name}
                        {saved.isDefault && (
                          <span className="weather-saved-item-default-badge">DEFAULT</span>
                        )}
                      </div>
                      <div className="weather-saved-item-coords">
                        {saved.lat.toFixed(2)}, {saved.lon.toFixed(2)}
                      </div>
                    </div>
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
                            void clearDefaultLocation(saved.id);
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
                            void setDefaultLocation(saved.id);
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
                  </button>
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
