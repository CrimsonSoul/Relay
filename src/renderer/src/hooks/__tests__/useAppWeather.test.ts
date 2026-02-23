import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppWeather } from '../useAppWeather';
import type { WeatherAlert, WeatherData } from '@shared/ipc';

const { secureStorageMock, resetStorage } = vi.hoisted(() => {
  const store = new Map<string, unknown>();

  return {
    resetStorage: () => store.clear(),
    secureStorageMock: {
      getItemSync: vi.fn((key: string) => store.get(key)),
      setItemSync: vi.fn((key: string, value: unknown) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
    },
  };
});

vi.mock('../../utils/secureStorage', () => ({
  secureStorage: secureStorageMock,
}));

vi.mock('../../utils/logger', () => ({
  loggers: {
    weather: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  },
}));

describe('useAppWeather', () => {
  const showToast = vi.fn();

  const mockApi = {
    getWeather: vi.fn(),
    getWeatherAlerts: vi.fn(),
  };

  const deviceLocation = {
    lat: null,
    lon: null,
    city: null,
    region: null,
    country: null,
    timezone: null,
    loading: true,
    error: null,
    source: null,
    refresh: vi.fn(async () => {}),
  };

  const weatherData: WeatherData = {
    timezone: 'America/Chicago',
    utc_offset_seconds: -21600,
    current_weather: {
      temperature: 75,
      windspeed: 12,
      winddirection: 180,
      weathercode: 1,
      time: '2026-02-22T15:00',
    },
    hourly: {
      time: ['2026-02-22T15:00'],
      temperature_2m: [75],
      weathercode: [1],
      precipitation_probability: [10],
    },
    daily: {
      time: ['2026-02-22'],
      weathercode: [1],
      temperature_2m_max: [80],
      temperature_2m_min: [60],
      wind_speed_10m_max: [18],
      precipitation_probability_max: [20],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetStorage();
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;
  });

  it('restores cached location, weather, and alerts from storage', async () => {
    mockApi.getWeather.mockResolvedValue(weatherData);
    const alerts: WeatherAlert[] = [
      {
        id: 'a1',
        event: 'Flood Warning',
        headline: 'Flood Warning',
        severity: 'Severe',
        urgency: 'Immediate',
        certainty: 'Likely',
        effective: '',
        expires: '',
        senderName: '',
        areaDesc: '',
        description: '',
      },
    ];
    mockApi.getWeatherAlerts.mockResolvedValue(alerts);

    secureStorageMock.setItemSync('weather_location', {
      latitude: 30,
      longitude: -97,
      name: 'Austin, TX',
    });
    secureStorageMock.setItemSync('cached_weather_data', {
      version: 2,
      fetchedAt: Date.now(),
      data: weatherData,
    });
    secureStorageMock.setItemSync('cached_weather_alerts', alerts);

    const { result } = renderHook(() => useAppWeather(deviceLocation, showToast));

    await waitFor(() => {
      expect(result.current.weatherLocation?.name).toBe('Austin, TX');
      expect(result.current.weatherData?.timezone).toBe('America/Chicago');
      expect(result.current.weatherAlerts).toHaveLength(1);
    });
  });

  it('hydrates location from device location when no saved location exists', async () => {
    const { result } = renderHook(() =>
      useAppWeather(
        {
          ...deviceLocation,
          loading: false,
          lat: 40.7,
          lon: -74,
          city: 'New York',
          region: 'NY',
        },
        showToast,
      ),
    );

    await waitFor(() => {
      expect(result.current.weatherLocation).toEqual({
        latitude: 40.7,
        longitude: -74,
        name: 'New York, NY',
      });
    });
  });

  it('fetches weather, stores cache, and emits a toast for new severe alerts', async () => {
    mockApi.getWeather.mockResolvedValue(weatherData);
    mockApi.getWeatherAlerts.mockResolvedValue([
      {
        id: 'w1',
        event: 'Tornado Warning',
        headline: 'Tornado Warning',
        severity: 'Extreme',
        urgency: 'Immediate',
        certainty: 'Observed',
        effective: '',
        expires: '',
        senderName: '',
        areaDesc: '',
        description: '',
      },
    ] satisfies WeatherAlert[]);

    const { result } = renderHook(() => useAppWeather(deviceLocation, showToast));

    await act(async () => {
      await result.current.fetchWeather(35.2, -80.8, false);
    });

    expect(result.current.weatherData?.timezone).toBe('America/Chicago');
    expect(result.current.weatherAlerts).toHaveLength(1);
    expect(showToast).toHaveBeenCalledWith('Weather Alert: Tornado Warning', 'error');
    expect(secureStorageMock.setItemSync).toHaveBeenCalledWith(
      'cached_weather_alerts',
      expect.any(Array),
    );
  });

  it('handles missing API without throwing', async () => {
    const { result } = renderHook(() => useAppWeather(deviceLocation, showToast));
    (globalThis as Window & { api?: typeof mockApi }).api = undefined;

    await act(async () => {
      await result.current.fetchWeather(1, 2, false);
    });

    expect(result.current.weatherLoading).toBe(false);
    expect(result.current.weatherData).toBeNull();
  });
});
