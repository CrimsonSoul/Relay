import React, { createContext, useContext, useEffect, useState, useMemo, ReactNode, useCallback } from 'react';
import { loggers } from '../utils/logger';

export interface LocationState {
  lat: number | null;
  lon: number | null;
  city: string | null;
  region: string | null;
  country: string | null;
  timezone: string | null;
  loading: boolean;
  error: string | null;
  source: 'gps' | 'ip' | null;
  refresh: () => Promise<void>;
}

const LocationContext = createContext<LocationState | undefined>(undefined);

export function LocationProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<Omit<LocationState, 'refresh'>>({
    lat: null,
    lon: null,
    city: null,
    region: null,
    country: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, // Default to system
    loading: true,
    error: null,
    source: null
  });

  const fetchLocation = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    // Helper to handle IP location
    const tryIpLocation = async () => {
      loggers.location.info('Fetching IP-based location...');
      try {
        const data = await globalThis.window.api?.getIpLocation();
        
        if (data?.lat && data?.lon) {
          loggers.location.info('IP location found', { city: data.city, source: 'ip' });
          setState(prev => ({
            ...prev,
            lat: prev.lat ?? Number(data.lat),
            lon: prev.lon ?? Number(data.lon),
            city: data.city,
            region: data.region,
            country: data.country,
            timezone: data.timezone || prev.timezone,
            loading: false,
            error: null,
            source: prev.source ?? 'ip'
          }));
          return true;
        }
      } catch (err: unknown) {
        loggers.location.warn('IP location failed', { error: err });
      }
      return false;
    };

    // Helper to handle GPS
    const tryGpsLocation = () => new Promise<boolean>((resolve) => {
      loggers.location.info('Fetching GPS location...');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(4));
          const lon = Number(pos.coords.longitude.toFixed(4));
          loggers.location.info('GPS location found', { lat, lon });
          
          setState(prev => ({
            ...prev,
            lat,
            lon,
            loading: false,
            source: 'gps'
          }));
          resolve(true);
        },
        (err) => {
          loggers.location.warn('GPS location failed or denied', { code: err.code, message: err.message });
          resolve(false);
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 10 * 60 * 1000 }
      );
    });

    // Strategy: 
    // 1. Start IP location immediately (fast, provides city metadata)
    // 2. Start GPS in parallel (accurate coordinates, but slow/unreliable on Windows)
    // 3. Fallback to error if both fail
    
    const [ipSuccess] = await Promise.all([
      tryIpLocation(),
      tryGpsLocation()
    ]);

    if (!ipSuccess) {
      // If IP failed, check if GPS also failed (loading would still be true if both failed or were denied)
      setState(prev => {
        if (prev.lat !== null) return { ...prev, loading: false }; 
        return { 
          ...prev, 
          loading: false, 
          error: 'Unable to determine location. Please search for your city manually.' 
        };
      });
    }
  }, []);

  useEffect(() => {
    void fetchLocation();
  }, [fetchLocation]);

  const value = useMemo(() => ({ ...state, refresh: fetchLocation }), [state, fetchLocation]);

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return context;
}
