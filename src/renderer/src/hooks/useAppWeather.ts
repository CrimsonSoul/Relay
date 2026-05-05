import { useState, useEffect, useRef, useCallback } from 'react';
import { WeatherAlert, WeatherData } from '@shared/ipc';
import type { Location } from '../tabs/weather/types';
import { getErrorMessage } from '@shared/types';
import { LocationState } from '../contexts/LocationContext';
import { secureStorage } from '../utils/secureStorage';
import { loggers } from '../utils/logger';
import { ErrorCategory } from '@shared/logging';
import { useMounted } from './useMounted';
import { usePolling } from './usePolling';

const WEATHER_POLLING_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const WEATHER_CACHE_KEY = 'cached_weather_data';
const WEATHER_ALERTS_CACHE_KEY = 'cached_weather_alerts';
const WEATHER_CACHE_VERSION = 2;
const WEATHER_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

type WeatherCache = {
  version: number;
  fetchedAt: number;
  data: WeatherData;
};

const isWeatherDataUsable = (data: unknown): data is WeatherData => {
  if (!data || typeof data !== 'object') return false;
  const weather = data as Partial<WeatherData>;
  const current = weather.current_weather;
  const hourly = weather.hourly;
  const daily = weather.daily;

  return (
    typeof current?.temperature === 'number' &&
    typeof current?.weathercode === 'number' &&
    typeof current?.time === 'string' &&
    Array.isArray(hourly?.time) &&
    hourly.time.length > 0 &&
    Array.isArray(hourly.temperature_2m) &&
    Array.isArray(hourly.weathercode) &&
    Array.isArray(hourly.precipitation_probability) &&
    Array.isArray(daily?.time) &&
    daily.time.length > 0 &&
    Array.isArray(daily.weathercode) &&
    Array.isArray(daily.temperature_2m_max) &&
    Array.isArray(daily.temperature_2m_min) &&
    Array.isArray(daily.wind_speed_10m_max) &&
    Array.isArray(daily.precipitation_probability_max)
  );
};

const loadCachedWeather = (): WeatherData | null => {
  const cached = secureStorage.getItemSync<unknown>(WEATHER_CACHE_KEY);
  if (!cached || typeof cached !== 'object') return null;

  if ('version' in cached && 'fetchedAt' in cached && 'data' in cached) {
    const cache = cached as WeatherCache;
    if (cache.version !== WEATHER_CACHE_VERSION) return null;
    if (Date.now() - cache.fetchedAt > WEATHER_CACHE_TTL_MS) return null;
    return isWeatherDataUsable(cache.data) ? cache.data : null;
  }

  return null;
};

const getPayloadKeys = (payload: unknown): string[] => {
  return payload && typeof payload === 'object'
    ? Object.keys(payload as Record<string, unknown>)
    : [];
};

const normalizeWeatherPayload = (payload: unknown): WeatherData | null => {
  if (isWeatherDataUsable(payload)) return payload;
  if (payload) {
    loggers.weather.warn('Ignoring unusable weather payload', {
      keys: getPayloadKeys(payload),
    });
  }
  return null;
};

const persistWeatherCache = (weather: WeatherData | null): void => {
  if (!weather) {
    secureStorage.removeItem(WEATHER_CACHE_KEY);
    return;
  }

  secureStorage.setItemSync(WEATHER_CACHE_KEY, {
    version: WEATHER_CACHE_VERSION,
    fetchedAt: Date.now(),
    data: weather,
  } satisfies WeatherCache);
};

/**
 * Hook to manage weather data fetching, polling, and persistence.
 * Implements a stale-while-revalidate pattern for immediate UI feedback.
 *
 * @param deviceLocation - Current GPS coordinates from device context
 * @param showToast - Notification callback for weather alerts
 */
export function useAppWeather(
  deviceLocation: LocationState,
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void,
) {
  const mounted = useMounted();
  const [weatherLocation, setWeatherLocation] = useState<Location | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const weatherDataRef = useRef<WeatherData | null>(null);
  useEffect(() => {
    weatherDataRef.current = weatherData;
  }, [weatherData]);
  const [weatherAlerts, setWeatherAlerts] = useState<WeatherAlert[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const lastAlertIdsRef = useRef<Set<string>>(new Set());
  const missingApiLoggedRef = useRef(false);

  // Restore Weather Location and Cached Data (Stale-while-revalidate)
  useEffect(() => {
    // 1. Restore Location from standard secure storage
    const savedLocation = secureStorage.getItemSync<unknown>('weather_location');
    if (savedLocation && typeof savedLocation === 'object') {
      // Defensively handle both 'latitude' (new) and 'lat' (legacy) keys
      const loc = savedLocation as Record<string, unknown>;
      const sanitized: Location = {
        latitude: Number(loc.latitude),
        longitude: Number(loc.longitude),
        name: (typeof loc.name === 'string' ? loc.name : undefined) || 'Saved Location',
      };
      if (
        !Number.isNaN(sanitized.latitude) &&
        !Number.isNaN(sanitized.longitude) &&
        mounted.current
      ) {
        setWeatherLocation(sanitized);
      }
    }

    // 2. Restore cached weather data and alerts for SWR
    const cachedWeather = loadCachedWeather();
    const cachedAlerts = secureStorage.getItemSync<WeatherAlert[]>(WEATHER_ALERTS_CACHE_KEY);

    if (!cachedWeather) {
      secureStorage.removeItem(WEATHER_CACHE_KEY);
    }

    if (mounted.current) {
      if (cachedWeather) setWeatherData(cachedWeather);
      if (cachedAlerts) {
        setWeatherAlerts(cachedAlerts);
        cachedAlerts.forEach((a) => {
          lastAlertIdsRef.current.add(a.id);
        });
      }
    }
  }, [mounted]); // Only run once on mount

  // Update from device location only if we don't have a location set yet
  useEffect(() => {
    if (
      !weatherLocation &&
      !deviceLocation.loading &&
      deviceLocation.lat !== null &&
      deviceLocation.lon !== null
    ) {
      if (mounted.current) {
        setWeatherLocation({
          latitude: Number(deviceLocation.lat),
          longitude: Number(deviceLocation.lon),
          name: deviceLocation.city
            ? `${deviceLocation.city}, ${deviceLocation.region}`
            : 'Current Location',
        });
      }
    }
  }, [
    deviceLocation.loading,
    deviceLocation.lat,
    deviceLocation.lon,
    deviceLocation.city,
    deviceLocation.region,
    weatherLocation,
    mounted,
  ]);

  /**
   * Fetches weather and alerts from API.
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param silent - If true, doesn't trigger loading state (background refresh)
   */
  const processAlerts = useCallback(
    (aData: WeatherAlert[]) => {
      const newAlerts = aData.filter((a) => !lastAlertIdsRef.current.has(a.id));
      if (newAlerts.length > 0) {
        const severe =
          newAlerts.find((a) => a.severity === 'Extreme' || a.severity === 'Severe') ??
          newAlerts[0];
        if (severe?.event) showToast(`Weather Alert: ${severe.event}`, 'error');
        for (const a of newAlerts) lastAlertIdsRef.current.add(a.id);
      }
      // Prune IDs no longer active
      const currentIds = new Set(aData.map((a) => a.id));
      for (const id of lastAlertIdsRef.current) {
        if (!currentIds.has(id)) lastAlertIdsRef.current.delete(id);
      }
    },
    [showToast],
  );

  const fetchWeather = useCallback(
    async (lat: number, lon: number, silent = false) => {
      if (!silent && mounted.current) setWeatherLoading(true);
      try {
        const api = globalThis.api;
        if (!api) {
          if (!missingApiLoggedRef.current) {
            loggers.weather.info('Weather polling disabled: API bridge not available');
            missingApiLoggedRef.current = true;
          }
          return;
        }
        const [wData, aData] = await Promise.all([
          api.getWeather(lat, lon),
          api.getWeatherAlerts(lat, lon).catch(() => []),
        ]);

        if (!mounted.current) return;

        const usableWeather = normalizeWeatherPayload(wData);

        setWeatherData(usableWeather);
        setWeatherAlerts(aData);

        persistWeatherCache(usableWeather);
        secureStorage.setItemSync(WEATHER_ALERTS_CACHE_KEY, aData);

        if (aData.length > 0) processAlerts(aData);
      } catch (err: unknown) {
        loggers.weather.error('Weather fetch failed', {
          error: getErrorMessage(err),
          category: ErrorCategory.NETWORK,
          location: { lat, lon },
        });
      } finally {
        if (!silent && mounted.current) setWeatherLoading(false);
      }
    },
    [mounted, processAlerts],
  );

  // Persistence of weather location
  useEffect(() => {
    if (weatherLocation) {
      secureStorage.setItemSync('weather_location', weatherLocation);
    }
  }, [weatherLocation]);

  // Fetch on location change
  const lastFetchedLocationRef = useRef<string>('');

  useEffect(() => {
    if (!weatherLocation) return;

    const locKey = `${weatherLocation.latitude},${weatherLocation.longitude}`;
    if (lastFetchedLocationRef.current === locKey) return;

    if (mounted.current) {
      setWeatherData(null);
      setWeatherAlerts([]);
    }
    fetchWeather(
      weatherLocation.latitude,
      weatherLocation.longitude,
      false, // Not silent for new location
    ).catch((error_) => {
      loggers.weather.error('[Weather] Failed to fetch weather for new location', {
        error: error_,
      });
    });
    lastFetchedLocationRef.current = locKey;
  }, [weatherLocation, fetchWeather, mounted]);

  // Background polling
  usePolling(() => {
    if (!weatherLocation) return;
    fetchWeather(weatherLocation.latitude, weatherLocation.longitude, true).catch((error_) => {
      loggers.weather.error('[Weather] Background polling failed', { error: error_ });
    });
  }, WEATHER_POLLING_INTERVAL_MS);

  return {
    weatherLocation,
    setWeatherLocation,
    weatherData,
    weatherAlerts,
    weatherLoading,
    fetchWeather,
  };
}
