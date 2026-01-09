import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { loggers, ErrorCategory } from '../utils/logger';

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

export function LocationProvider({ children }: { children: ReactNode }) {
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

  const fetchLocation = async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    // Helper to normalize GeolocationPosition
    const handleGpsSuccess = (pos: GeolocationPosition) => {
      setState({
        lat: Number(pos.coords.latitude.toFixed(4)),
        lon: Number(pos.coords.longitude.toFixed(4)),
        city: null, 
        region: null,
        country: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, // GPS uses system time
        loading: false,
        error: null,
        source: 'gps'
      });
    };

    // Helper to handle IP location fallback
    const tryIpFallback = async () => {
      try {
        const data = await window.api.getIpLocation();
        
        if (data) {
          setState({
            lat: Number(data.lat),
            lon: Number(data.lon),
            city: data.city,
            region: data.region,
            country: data.country,
            timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
            loading: false,
            error: null,
            source: 'ip'
          });
        } else {
          throw new Error('IP location service returned null');
        }
      } catch (err: any) {
        loggers.location.error('IP location fallback failed', { 
          error: err.message, 
          category: ErrorCategory.NETWORK 
        });
        setState(prev => ({ 
          ...prev, 
          loading: false, 
          error: 'Unable to determine location via GPS or IP.' 
        }));
      }
    };

    // 1. Try HTML5 Geolocation with tight timeout
    // We use a Promise wrapper to handle the timeout cleanly
    const getGpsPosition = () => new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false, // Fast/Low power
        timeout: 4000,
        maximumAge: 10 * 60 * 1000 // Accept 10 minute old cached position
      });
    });

    try {
      const pos = await getGpsPosition();
      handleGpsSuccess(pos);
    } catch (err: any) {
      if (err.code === err.PERMISSION_DENIED) {
        loggers.location.warn('GPS Permission denied');
      } else if (err.code === err.TIMEOUT) {
        loggers.location.warn('GPS Timeout');
      } else {
        loggers.location.warn('GPS Error', { error: err.message });
      }
      // If GPS fails for any reason, try IP fallback
      await tryIpFallback();
    }
  };

  useEffect(() => {
    fetchLocation();
  }, []);

  return (
    <LocationContext.Provider value={{ ...state, refresh: fetchLocation }}>
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
