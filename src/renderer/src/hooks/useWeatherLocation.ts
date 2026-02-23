/* eslint-disable sonarjs/no-nested-functions */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Location } from '../tabs/weather/types';
import { getErrorMessage } from '@shared/types';
import { useMounted } from './useMounted';
import { loggers } from '../utils/logger';

export function useWeatherLocation(
  location: Location | null,
  loading: boolean,
  onLocationChange: (loc: Location) => void,
  onManualRefresh: (lat: number, lon: number) => void,
) {
  const mounted = useMounted();
  const [manualInput, setManualInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const autoLocateAttemptedRef = useRef(false);

  const reverseGeocode = useCallback(async (lat: number, lon: number): Promise<string> => {
    try {
      if (!globalThis.api) return 'Current Location';
      const data = await globalThis.api.searchLocation(`${lat},${lon}`);
      if (data.results?.[0]) {
        const { name, admin1, country_code } = data.results[0];
        return `${name}, ${admin1 || ''} ${country_code}`.trim();
      }
    } catch {
      /* Geocoding failure - return fallback */
    }
    return 'Current Location';
  }, []);

  const handleAutoLocate = useCallback(async () => {
    if (mounted.current) {
      setError(null);
      setPermissionDenied(false);
    }

    let foundAny = false;

    // 1. Try IP Location (Fast/Reliable)
    const tryIp = async (): Promise<boolean> => {
      try {
        const data = await globalThis.api?.getIpLocation();
        if (data?.lat && data?.lon && !foundAny) {
          const lat = Number(Number(data.lat).toFixed(4));
          const lon = Number(Number(data.lon).toFixed(4));
          const name = data.city
            ? `${data.city}, ${data.region || ''} ${data.country}`.trim()
            : 'Current Location';
          const newLoc: Location = { latitude: lat, longitude: lon, name };
          if (mounted.current) {
            onLocationChange(newLoc);
            onManualRefresh(lat, lon);
          }
          foundAny = true;
          return true;
        }
      } catch (err) {
        loggers.weather.warn('[Weather] IP location failed', { error: err });
      }
      return false;
    };

    // 2. Try GPS (Accurate)
    const tryGps = (): Promise<boolean> =>
      new Promise((resolve) => {
        if (!('geolocation' in navigator)) {
          resolve(false);
          return;
        }

        // eslint-disable-next-line sonarjs/no-intrusive-permissions
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            const lat = Number(latitude.toFixed(4));
            const lon = Number(longitude.toFixed(4));

            try {
              const name = await reverseGeocode(lat, lon);
              const newLoc: Location = { latitude: lat, longitude: lon, name };
              if (mounted.current) {
                onLocationChange(newLoc);
                onManualRefresh(lat, lon);
              }
              foundAny = true;
              resolve(true);
              // eslint-disable-next-line sonarjs/no-ignored-exceptions
            } catch (_error) {
              /* ignore */
            }
          },
          (err) => {
            loggers.weather.warn('[Weather] GPS location failed', { error: err.message });
            if (err.code === 1 && mounted.current) setPermissionDenied(true);
            resolve(false);
          },
          { timeout: 5000, maximumAge: 300000, enableHighAccuracy: false },
        );
      });

    // Run both in parallel. GPS will refine IP if it succeeds later.
    const [ipSuccess, gpsSuccess] = await Promise.all([tryIp(), tryGps()]);

    if (!ipSuccess && !gpsSuccess && !foundAny && mounted.current) {
      setError('Could not detect location automatically. Please search for your city manually.');
    }
  }, [onLocationChange, onManualRefresh, reverseGeocode, mounted]);

  useEffect(() => {
    if (!location && !loading && !autoLocateAttemptedRef.current) {
      autoLocateAttemptedRef.current = true;
      handleAutoLocate().catch((error_) => {
        loggers.weather.error('[Weather] Auto-locate failed unexpectedly', { error: error_ });
      });
    }
  }, [location, loading, handleAutoLocate]);

  const handleManualSearch = async () => {
    if (!manualInput.trim()) return;
    if (mounted.current) setError(null);
    if (!globalThis.api) {
      if (mounted.current) setError('API not available');
      return;
    }
    try {
      const data = await globalThis.api.searchLocation(manualInput);
      if (data.results?.[0]) {
        const { lat, lon, name, admin1, country_code } = data.results[0];
        const label = `${name}, ${admin1 || ''} ${country_code}`.trim();
        const newLoc: Location = {
          latitude: Number(lat.toFixed(4)),
          longitude: Number(lon.toFixed(4)),
          name: label,
        };
        if (mounted.current) {
          onLocationChange(newLoc);
          onManualRefresh(newLoc.latitude, newLoc.longitude);
          setManualInput('');
        }
      } else if (mounted.current) {
        setError('Location not found. Try a different search term.');
      }
    } catch (err: unknown) {
      if (mounted.current) {
        setError(getErrorMessage(err) || 'Search failed');
      }
    }
  };

  return {
    manualInput,
    setManualInput,
    error,
    permissionDenied,
    handleAutoLocate,
    handleManualSearch,
  };
}
