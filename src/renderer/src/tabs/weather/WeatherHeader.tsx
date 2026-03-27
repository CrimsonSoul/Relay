import React from 'react';
import { TactileButton } from '../../components/TactileButton';
import { CollapsibleHeader } from '../../components/CollapsibleHeader';
import type { SavedLocation } from '@shared/ipc';
import type { WeatherData } from './types';
import { getWeatherDescription } from './utils';
import { WeatherSearchPopover, type SearchPopoverProps } from './WeatherSearchPopover';
import { WeatherLocationMenu, type LocationMenuProps } from './WeatherLocationMenu';

type WeatherHeaderProps = SearchPopoverProps &
  LocationMenuProps & {
    activeSavedLocation: SavedLocation | null;
    weather: WeatherData | null;
    handleAutoLocate: () => void;
  };

export const WeatherHeader: React.FC<WeatherHeaderProps> = ({
  // Search popover props
  isSearching,
  loc,
  handleManualSearch,
  // Location menu props
  location,
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
  // Header-level props
  activeSavedLocation,
  weather,
  handleAutoLocate,
}) => {
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
      <WeatherSearchPopover
        isSearching={isSearching}
        loc={loc}
        handleManualSearch={handleManualSearch}
      />
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
      <WeatherLocationMenu
        location={location}
        showLocationMenu={showLocationMenu}
        setShowLocationMenu={setShowLocationMenu}
        locationMenuRef={locationMenuRef}
        savedLocations={savedLocations}
        setSaveModalOpen={setSaveModalOpen}
        handleSelectSavedLocation={handleSelectSavedLocation}
        handleOpenRename={handleOpenRename}
        setLocationToDelete={setLocationToDelete}
        clearDefaultLocation={clearDefaultLocation}
        setDefaultLocation={setDefaultLocation}
      />
    </CollapsibleHeader>
  );
};
