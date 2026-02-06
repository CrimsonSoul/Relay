import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TabFallback } from '../components/TabFallback';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  WeatherAlertCard,
  HourlyForecast,
  DailyForecast,
  RadarPanel,
  WeatherHeader,
  SaveLocationModal,
  RenameLocationModal,
  type WeatherTabProps,
} from './weather';
import { useWeatherLocation } from '../hooks/useWeatherLocation';
import { useSavedLocations } from '../hooks/useSavedLocations';
import type { SavedLocation } from '@shared/ipc';

export const WeatherTab: React.FC<WeatherTabProps> = ({
  weather,
  alerts,
  location,
  loading,
  onLocationChange,
  onManualRefresh,
}) => {
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const loc = useWeatherLocation(location, loading, onLocationChange, onManualRefresh);

  // Saved locations state
  const {
    locations: savedLocations,
    saveLocation,
    deleteLocation,
    setDefaultLocation,
    clearDefaultLocation,
    updateLocation,
  } = useSavedLocations();
  const [showLocationMenu, setShowLocationMenu] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [renameModal, setRenameModal] = useState<SavedLocation | null>(null);
  const [activeSavedLocation, setActiveSavedLocation] = useState<SavedLocation | null>(null);
  const [locationToDelete, setLocationToDelete] = useState<SavedLocation | null>(null);
  const locationMenuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showLocationMenu) return;
    const handler = (e: MouseEvent) => {
      if (locationMenuRef.current && !locationMenuRef.current.contains(e.target as Node)) {
        setShowLocationMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showLocationMenu]);

  const handleSaveLocation = useCallback(
    async (name: string, isDefault: boolean) => {
      if (!name.trim() || !location) return;
      await saveLocation({
        name: name.trim(),
        lat: location.latitude,
        lon: location.longitude,
        isDefault: isDefault,
      });
      setSaveModalOpen(false);
    },
    [location, saveLocation],
  );

  const handleSelectSavedLocation = useCallback(
    async (saved: SavedLocation) => {
      // Reverse geocode to get the city name
      setIsSearching(true);
      try {
        if (!window.api) {
          throw new Error('API not available');
        }
        const data = await window.api.searchLocation(`${saved.lat},${saved.lon}`);
        const cityName = data.results?.[0]
          ? `${data.results[0].name}, ${data.results[0].admin1 || ''} ${data.results[0].country_code}`.trim()
          : saved.name;
        onLocationChange({ name: cityName, latitude: saved.lat, longitude: saved.lon });
      } catch {
        onLocationChange({ name: saved.name, latitude: saved.lat, longitude: saved.lon });
      } finally {
        setIsSearching(false);
      }
      setActiveSavedLocation(saved);
      onManualRefresh(saved.lat, saved.lon);
      setShowLocationMenu(false);
    },
    [onLocationChange, onManualRefresh],
  );

  const handleOpenRename = useCallback((saved: SavedLocation) => {
    setRenameModal(saved);
    setShowLocationMenu(false);
  }, []);

  const handleRename = useCallback(
    async (newName: string) => {
      if (!renameModal || !newName.trim()) return;
      await updateLocation(renameModal.id, { name: newName.trim() });
      setRenameModal(null);
    },
    [renameModal, updateLocation],
  );

  const handleManualSearch = useCallback(async () => {
    setActiveSavedLocation(null);
    setIsSearching(true);
    try {
      await loc.handleManualSearch();
    } finally {
      setIsSearching(false);
    }
  }, [loc]);

  const handleAutoLocate = useCallback(async () => {
    setActiveSavedLocation(null);
    setIsSearching(true);
    try {
      await loc.handleAutoLocate();
    } finally {
      setIsSearching(false);
    }
  }, [loc]);

  if (!location && loading) return <TabFallback />;

  return (
    <div
      className="weather-font-surface weather-scroll-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'transparent',
        padding: '24px 32px',
        gap: '24px',
        overflow: 'hidden',
      }}
    >
      <WeatherHeader
        location={location}
        activeSavedLocation={activeSavedLocation}
        weather={weather}
        isSearching={isSearching}
        loc={loc}
        handleManualSearch={handleManualSearch}
        handleAutoLocate={handleAutoLocate}
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

      {/* Confirmation Modals */}
      {locationToDelete && (
        <ConfirmModal
          isOpen={!!locationToDelete}
          onClose={() => setLocationToDelete(null)}
          onConfirm={async () => {
            if (locationToDelete) {
              await deleteLocation(locationToDelete.id);
              setLocationToDelete(null);
            }
          }}
          title="Delete Location"
          message={`Are you sure you want to delete "${locationToDelete.name}"?`}
          confirmLabel="Delete"
          isDanger
        />
      )}

      {/* Save Location Modal */}
      {saveModalOpen && (
        <SaveLocationModal
          location={location}
          onClose={() => setSaveModalOpen(false)}
          onSave={handleSaveLocation}
        />
      )}

      {/* Rename Location Modal */}
      {renameModal && (
        <RenameLocationModal
          location={renameModal}
          onClose={() => setRenameModal(null)}
          onRename={handleRename}
        />
      )}

      <div
        className="weather-tab-root weather-scroll-container"
        style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0, overflow: 'hidden' }}
      >
        <div
          className="weather-forecast-column weather-scroll-container"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            flex: '0 0 35%',
            minWidth: '300px',
            overflowY: 'auto',
          }}
        >
          {alerts.length > 0 &&
            alerts.map((alert) => (
              <WeatherAlertCard
                key={alert.id}
                alert={alert}
                isExpanded={expandedAlert === alert.id}
                onToggle={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
              />
            ))}
          <HourlyForecast weather={weather} />
          <DailyForecast weather={weather} />
        </div>
        <RadarPanel location={location} />
      </div>
    </div>
  );
};
