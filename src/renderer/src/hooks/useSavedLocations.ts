import { useState, useEffect, useCallback } from "react";
import type { SavedLocation } from "@shared/ipc";

export function useSavedLocations() {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLocations = useCallback(async () => {
    try {
      const data = await window.api?.getSavedLocations();
      setLocations(data || []);
    } catch (e) {
      console.error("Failed to load saved locations:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  const saveLocation = useCallback(
    async (location: Omit<SavedLocation, "id">) => {
      try {
        if (!window.api) {
          console.error("[useSavedLocations] API not available");
          return null;
        }
        const result = await window.api.saveLocation(location);
        if (result) {
          // If new location is default, update existing
          if (result.isDefault) {
            setLocations((prev) =>
              [...prev.map((l) => ({ ...l, isDefault: false })), result]
            );
          } else {
            setLocations((prev) => [...prev, result]);
          }
        }
        return result;
      } catch (e) {
        console.error("[useSavedLocations] Failed to save location:", e);
        return null;
      }
    },
    []
  );

  const deleteLocation = useCallback(async (id: string) => {
    try {
      if (!window.api) {
        console.error("[useSavedLocations] API not available");
        return false;
      }
      const success = await window.api.deleteLocation(id);
      if (success) {
        setLocations((prev) => prev.filter((l) => l.id !== id));
      }
      return success ?? false;
    } catch (e) {
      console.error("[useSavedLocations] Failed to delete location:", e);
      return false;
    }
  }, []);

  const setDefaultLocation = useCallback(async (id: string) => {
    try {
      if (!window.api) {
        console.error("[useSavedLocations] API not available");
        return false;
      }
      const success = await window.api.setDefaultLocation(id);
      if (success) {
        setLocations((prev) =>
          prev.map((l) => ({ ...l, isDefault: l.id === id }))
        );
      }
      return success ?? false;
    } catch (e) {
      console.error("[useSavedLocations] Failed to set default location:", e);
      return false;
    }
  }, []);

  const clearDefaultLocation = useCallback(async (id: string) => {
    try {
      if (!window.api) {
        console.error("[useSavedLocations] API not available");
        return false;
      }
      const success = await window.api.clearDefaultLocation(id);
      if (success) {
        setLocations((prev) =>
          prev.map((l) => l.id === id ? { ...l, isDefault: false } : l)
        );
      }
      return success ?? false;
    } catch (e) {
      console.error("[useSavedLocations] Failed to clear default location:", e);
      return false;
    }
  }, []);

  const updateLocation = useCallback(async (id: string, updates: Partial<Omit<SavedLocation, "id">>) => {
    try {
      if (!window.api) {
        console.error("[useSavedLocations] API not available");
        return false;
      }
      const success = await window.api.updateLocation(id, updates);
      if (success) {
        setLocations((prev) =>
          prev.map((l) => l.id === id ? { ...l, ...updates } : l)
        );
      }
      return success ?? false;
    } catch (e) {
      console.error("[useSavedLocations] Failed to update location:", e);
      return false;
    }
  }, []);

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
