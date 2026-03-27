import { useCallback, useMemo } from 'react';
import type { SavedLocation } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { useCollection } from './useCollection';
import {
  addLocation as pbAddLocation,
  updateLocation as pbUpdateLocation,
  deleteLocation as pbDeleteLocation,
  setDefaultLocation as pbSetDefaultLocation,
} from '../services/savedLocationService';
import type { SavedLocationRecord } from '../services/savedLocationService';

function toSavedLocation(r: SavedLocationRecord): SavedLocation {
  return {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    isDefault: r.isDefault,
  };
}

export function useSavedLocations() {
  const { showToast } = useToast();
  const {
    data: locationRecords,
    loading,
    refetch: reloadLocations,
  } = useCollection<SavedLocationRecord>('saved_locations', { sort: '-created' });

  const locations = useMemo(() => locationRecords.map(toSavedLocation), [locationRecords]);

  const saveLocation = useCallback(
    async (location: Omit<SavedLocation, 'id'>) => {
      try {
        const created = await pbAddLocation({
          name: location.name,
          lat: location.lat,
          lon: location.lon,
          isDefault: location.isDefault || false,
        });
        return toSavedLocation(created);
      } catch (e) {
        loggers.location.error('[useSavedLocations] Failed to save location', { error: e });
        showToast('Failed to save location', 'error');
        return null;
      }
    },
    [showToast],
  );

  const deleteLocation = useCallback(
    async (id: string) => {
      try {
        await pbDeleteLocation(id);
        return true;
      } catch (e) {
        loggers.location.error('[useSavedLocations] Failed to delete location', { error: e });
        showToast('Failed to delete location', 'error');
        return false;
      }
    },
    [showToast],
  );

  const setDefaultLocation = useCallback(
    async (id: string) => {
      try {
        await pbSetDefaultLocation(id);
        return true;
      } catch (e) {
        loggers.location.error('[useSavedLocations] Failed to set default location', { error: e });
        showToast('Failed to set default location', 'error');
        return false;
      }
    },
    [showToast],
  );

  const clearDefaultLocation = useCallback(
    async (id: string) => {
      try {
        await pbUpdateLocation(id, { isDefault: false });
        return true;
      } catch (e) {
        loggers.location.error('[useSavedLocations] Failed to clear default location', {
          error: e,
        });
        showToast('Failed to clear default location', 'error');
        return false;
      }
    },
    [showToast],
  );

  const updateLocation = useCallback(
    async (id: string, updates: Partial<Omit<SavedLocation, 'id'>>) => {
      try {
        await pbUpdateLocation(id, updates);
        return true;
      } catch (e) {
        loggers.location.error('[useSavedLocations] Failed to update location', { error: e });
        showToast('Failed to update location', 'error');
        return false;
      }
    },
    [showToast],
  );

  const getDefaultLocation = useCallback(() => {
    return locations.find((l) => l.isDefault);
  }, [locations]);

  return {
    locations,
    loading,
    saveLocation,
    deleteLocation,
    setDefaultLocation,
    clearDefaultLocation,
    updateLocation,
    getDefaultLocation,
    reloadLocations,
  };
}
