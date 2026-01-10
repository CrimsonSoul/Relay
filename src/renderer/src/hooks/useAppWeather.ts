import { useState, useEffect, useRef, useCallback } from 'react';
import { WeatherAlert } from "../../../shared/ipc";
import { LocationState } from '../contexts/LocationContext';
import { secureStorage } from '../utils/secureStorage';
import { loggers, ErrorCategory } from '../utils/logger';

const WEATHER_POLLING_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const WEATHER_CACHE_KEY = 'cached_weather_data';
const WEATHER_ALERTS_CACHE_KEY = 'cached_weather_alerts';

interface WeatherData {
  current_weather: {
    temperature: number;
    windspeed: number;
    winddirection: number;
    weathercode: number;
    time: string;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    weathercode: number[];
    precipitation_probability: number[];
  };
  daily: {
    time: string[];
    weathercode: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    wind_speed_10m_max: number[];
    precipitation_probability_max: number[];
  };
}

interface Location {
  latitude: number;
  longitude: number;
  name?: string;
}

/**
 * Hook to manage weather data fetching, polling, and persistence.
 * Implements a stale-while-revalidate pattern for immediate UI feedback.
 * 
 * @param deviceLocation - Current GPS coordinates from device context
 * @param showToast - Notification callback for weather alerts
 */
export function useAppWeather(deviceLocation: LocationState, showToast: (msg: string, type: 'success' | 'error' | 'info') => void) {
  const [weatherLocation, setWeatherLocation] = useState<Location | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [weatherAlerts, setWeatherAlerts] = useState<WeatherAlert[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const lastAlertIdsRef = useRef<Set<string>>(new Set());

  // Restore Weather Location and Cached Data (Stale-while-revalidate)
  useEffect(() => {
    // 1. Restore Location from standard secure storage
    const savedLocation = secureStorage.getItemSync<unknown>("weather_location");
    if (savedLocation && typeof savedLocation === 'object' && savedLocation !== null) {
      // Defensively handle both 'latitude' (new) and 'lat' (legacy) keys
      const loc = savedLocation as Record<string, unknown>;
      const sanitized: Location = {
        latitude: Number(loc.latitude ?? loc.lat),
        longitude: Number(loc.longitude ?? loc.lon),
        name: (typeof loc.name === 'string' ? loc.name : undefined) || 'Saved Location'
      };
      if (!isNaN(sanitized.latitude) && !isNaN(sanitized.longitude)) {
        setWeatherLocation(sanitized);
      }
    } else if (!deviceLocation.loading && deviceLocation.lat !== null && deviceLocation.lon !== null) {
      // Fallback to Device Location from global context
      setWeatherLocation({
        latitude: Number(deviceLocation.lat),
        longitude: Number(deviceLocation.lon),
        name: deviceLocation.city ? `${deviceLocation.city}, ${deviceLocation.region}` : 'Current Location'
      });
    }

    // 2. Restore cached weather data and alerts for SWR
    const cachedWeather = secureStorage.getItemSync<WeatherData>(WEATHER_CACHE_KEY);
    const cachedAlerts = secureStorage.getItemSync<WeatherAlert[]>(WEATHER_ALERTS_CACHE_KEY);

    if (cachedWeather) setWeatherData(cachedWeather);
    if (cachedAlerts) {
      setWeatherAlerts(cachedAlerts);
      cachedAlerts.forEach(a => lastAlertIdsRef.current.add(a.id));
    }
  }, [deviceLocation.loading, deviceLocation.lat, deviceLocation.lon]);

  /**
   * Fetches weather and alerts from API.
   * 
   * @param lat - Latitude
   * @param lon - Longitude
   * @param silent - If true, doesn't trigger loading state (background refresh)
   */
  const fetchWeather = useCallback(
    async (lat: number, lon: number, silent = false) => {
      if (!silent) setWeatherLoading(true);
      try {
        const [wData, aData] = await Promise.all([
          globalThis.window.api!.getWeather(lat, lon),
          globalThis.window.api!.getWeatherAlerts(lat, lon).catch(() => []),
        ]);

        setWeatherData(wData);
        setWeatherAlerts(aData);

        // Cache for SWR
        secureStorage.setItemSync(WEATHER_CACHE_KEY, wData);
        secureStorage.setItemSync(WEATHER_ALERTS_CACHE_KEY, aData);

        // Handle Realtime Alerts
        if (aData.length > 0) {
          const newAlerts = aData.filter(
            (a: WeatherAlert) => !lastAlertIdsRef.current.has(a.id)
          );
          if (newAlerts.length > 0) {
            const severe =
              newAlerts.find(
                (a: WeatherAlert) => a.severity === "Extreme" || a.severity === "Severe"
              ) || newAlerts[0];
            showToast(`Weather Alert: ${severe.event}`, "error");

            newAlerts.forEach((a: WeatherAlert) => lastAlertIdsRef.current.add(a.id));
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        loggers.weather.error("Weather fetch failed", {
          error: message,
          category: ErrorCategory.NETWORK,
          location: { lat, lon }
        });
      } finally {
        if (!silent) setWeatherLoading(false);
      }
    },
    [showToast]
  );

  // Persistence of weather location
  useEffect(() => {
    if (weatherLocation) {
      secureStorage.setItemSync("weather_location", weatherLocation);
    }
  }, [weatherLocation]);

  // Weather Polling
  useEffect(() => {
    if (!weatherLocation) return;

    // Immediate fetch if we don't have fresh data
    fetchWeather(
      weatherLocation.latitude,
      weatherLocation.longitude,
      !!weatherData
    );

    const interval = setInterval(() => {
      fetchWeather(weatherLocation.latitude, weatherLocation.longitude, true);
    }, WEATHER_POLLING_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [weatherLocation, fetchWeather, !!weatherData]);

  return {
    weatherLocation,
    setWeatherLocation,
    weatherData,
    weatherAlerts,
    weatherLoading,
    fetchWeather
  };
}
