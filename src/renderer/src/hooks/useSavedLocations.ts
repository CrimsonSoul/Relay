import { useState, useEffect, useCallback } from 'react';
import type { SavedLocation } from '@shared/ipc';
import { loggers } from '../utils/logger';

export function useSavedLocations() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLocations = useCallback(async () => {
    try {
      const data = await globalThis.api?.getSavedLocations();
      setLocations(data || []);
    } catch (e) {
      loggers.location.error('Failed to load saved locations', { error: e });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLocations().catch((error_) => {
      loggers.location.error('Failed to run initial saved-locations load', { error: error_ });
    });
  }, [loadLocations]);

  const saveLocation = useCallback(async (location: Omit<SavedLocation, 'id'>) => {
    try {
      if (!globalThis.api) {
        loggers.api.error('[useSavedLocations] API not available');
        return null;
      }
      const result = await globalThis.api.saveLocation(location);
      if (result) {
        // If new location is default, update existing
        if (result.isDefault) {
          setLocations((prev) => [...prev.map((l) => ({ ...l, isDefault: false })), result]);
        } else {
          setLocations((prev) => [...prev, result]);
        }
      }
      return result;
    } catch (e) {
      loggers.location.error('[useSavedLocations] Failed to save location', { error: e });
      return null;
    }
  }, []);

  const deleteLocation = useCallback(async (id: string) => {
    try {
      if (!globalThis.api) {
        loggers.api.error('[useSavedLocations] API not available');
        return false;
      }
      const success = await globalThis.api.deleteLocation(id);
      if (success) {
        setLocations((prev) => prev.filter((l) => l.id !== id));
      }
      return success ?? false;
    } catch (e) {
      loggers.location.error('[useSavedLocations] Failed to delete location', { error: e });
      return false;
    }
  }, []);

  const setDefaultLocation = useCallback(async (id: string) => {
    try {
      if (!globalThis.api) {
        loggers.api.error('[useSavedLocations] API not available');
        return false;
      }
      const success = await globalThis.api.setDefaultLocation(id);
      if (success) {
        setLocations((prev) => prev.map((l) => ({ ...l, isDefault: l.id === id })));
      }
      return success ?? false;
    } catch (e) {
      loggers.location.error('[useSavedLocations] Failed to set default location', { error: e });
      return false;
    }
  }, []);

  const clearDefaultLocation = useCallback(async (id: string) => {
    try {
      if (!globalThis.api) {
        loggers.api.error('[useSavedLocations] API not available');
        return false;
      }
      const success = await globalThis.api.clearDefaultLocation(id);
      if (success) {
        setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, isDefault: false } : l)));
      }
      return success ?? false;
    } catch (e) {
      loggers.location.error('[useSavedLocations] Failed to clear default location', { error: e });
      return false;
    }
  }, []);

  const updateLocation = useCallback(
    async (id: string, updates: Partial<Omit<SavedLocation, 'id'>>) => {
      try {
        if (!globalThis.api) {
          loggers.api.error('[useSavedLocations] API not available');
          return false;
        }
        const success = await globalThis.api.updateLocation(id, updates);
        if (success) {
          setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
        }
        return success ?? false;
      } catch (e) {
        loggers.location.error('[useSavedLocations] Failed to update location', { error: e });
        return false;
      }
    },
    [],
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
    reloadLocations: loadLocations,
  };
}
