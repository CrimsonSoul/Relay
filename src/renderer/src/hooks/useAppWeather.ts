import { useState, useEffect, useRef, useCallback } from 'react';
import { WeatherAlert } from "@shared/ipc";

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

export function useAppWeather(deviceLocation: any, showToast: (msg: string, type: 'success' | 'error' | 'info') => void) {
  const [weatherLocation, setWeatherLocation] = useState<Location | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [weatherAlerts, setWeatherAlerts] = useState<WeatherAlert[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const lastAlertIdsRef = useRef<Set<string>>(new Set());

  // Restore Weather Location or Sync from Device
  useEffect(() => {
    // 1. Try saved manual location
    const saved = localStorage.getItem("weather_location");
    if (saved) {
      try {
        setWeatherLocation(JSON.parse(saved));
        return;
      } catch {
        // Invalid JSON in localStorage - ignore and use fallback
      }
    }

    // 2. Fallback to Device Location if loaded
    if (!deviceLocation.loading && deviceLocation.lat && deviceLocation.lon) {
      console.log('[useAppWeather] Initializing weather location from device:', deviceLocation);
      setWeatherLocation({
        latitude: deviceLocation.lat,
        longitude: deviceLocation.lon,
        name: deviceLocation.city ? `${deviceLocation.city}, ${deviceLocation.region}` : 'Current Location'
      });
    }
  }, [deviceLocation.loading, deviceLocation.lat, deviceLocation.lon]);

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
      } catch (err) {
        console.error("Weather fetch failed", err);
      } finally {
        if (!silent) setWeatherLoading(false);
      }
    },
    [showToast]
  );

  // Weather Polling (Every 2 mins)
  useEffect(() => {
    if (!weatherLocation) return;

    fetchWeather(
      weatherLocation.latitude,
      weatherLocation.longitude,
      !!weatherData
    );

    const interval = setInterval(() => {
      fetchWeather(weatherLocation.latitude, weatherLocation.longitude, true);
    }, 2 * 60 * 1000);

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
