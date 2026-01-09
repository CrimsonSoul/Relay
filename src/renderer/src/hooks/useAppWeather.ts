import { useState, useEffect, useRef, useCallback } from 'react';
import { WeatherAlert } from "@shared/ipc";
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
export function useAppWeather(deviceLocation: any, showToast: (msg: string, type: 'success' | 'error' | 'info') => void) {
  const [weatherLocation, setWeatherLocation] = useState<Location | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [weatherAlerts, setWeatherAlerts] = useState<WeatherAlert[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const lastAlertIdsRef = useRef<Set<string>>(new Set());

  // Restore Weather Location and Cached Data (Stale-while-revalidate)
  useEffect(() => {
    // 1. Restore Location
    const savedLocation = secureStorage.getItemSync<Location>("weather_location");
    if (savedLocation) {
      setWeatherLocation(savedLocation);
    } else if (!deviceLocation.loading && deviceLocation.lat && deviceLocation.lon) {
      // Fallback to Device Location
      setWeatherLocation({
        latitude: deviceLocation.lat,
        longitude: deviceLocation.lon,
        name: deviceLocation.city ? `${deviceLocation.city}, ${deviceLocation.region}` : 'Current Location'
      });
    }

    // 2. Restore Cached Data (Stale-while-revalidate)
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
          window.api.getWeather(lat, lon),
          window.api.getWeatherAlerts(lat, lon).catch(() => []),
        ]);

        setWeatherData(wData);
        setWeatherAlerts(aData);

        // Cache for SWR
        secureStorage.setItem(WEATHER_CACHE_KEY, wData);
        secureStorage.setItem(WEATHER_ALERTS_CACHE_KEY, aData);

        // Handle Realtime Alerts
        if (aData.length > 0) {
          const newAlerts = aData.filter(
            (a: any) => !lastAlertIdsRef.current.has(a.id)
          );
          if (newAlerts.length > 0) {
            const severe =
              newAlerts.find(
                (a: any) => a.severity === "Extreme" || a.severity === "Severe"
              ) || newAlerts[0];
            showToast(`Weather Alert: ${severe.event}`, "error");

            newAlerts.forEach((a: any) => lastAlertIdsRef.current.add(a.id));
          }
        }
      } catch (err: any) {
        loggers.weather.error("Weather fetch failed", {
          error: err.message,
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
      secureStorage.setItem("weather_location", weatherLocation);
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

