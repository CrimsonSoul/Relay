import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWeatherLocation } from '../useWeatherLocation';
import type { Location } from '../../tabs/weather/types';

vi.mock('../../utils/logger', () => ({
  loggers: {
    weather: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  },
}));

describe('useWeatherLocation', () => {
  const onLocationChange = vi.fn();
  const onManualRefresh = vi.fn();

  const mockApi = {
    searchLocation: vi.fn(),
    getIpLocation: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;
  });

  it('handles manual search success and clears input', async () => {
    const existing: Location = { latitude: 1, longitude: 2, name: 'Existing' };
    mockApi.searchLocation.mockResolvedValue({
      results: [
        { lat: 30.123456, lon: -97.987654, name: 'Austin', admin1: 'TX', country_code: 'US' },
      ],
    });

    const { result } = renderHook(() =>
      useWeatherLocation(existing, false, onLocationChange, onManualRefresh),
    );

    act(() => {
      result.current.setManualInput('austin');
    });

    await act(async () => {
      await result.current.handleManualSearch();
    });

    expect(onLocationChange).toHaveBeenCalledWith({
      latitude: 30.1235,
      longitude: -97.9877,
      name: 'Austin, TX US',
    });
    expect(onManualRefresh).toHaveBeenCalledWith(30.1235, -97.9877);
    expect(result.current.manualInput).toBe('');
  });

  it('sets helpful manual-search errors', async () => {
    const existing: Location = { latitude: 1, longitude: 2, name: 'Existing' };
    mockApi.searchLocation.mockResolvedValue({ results: [] });

    const { result } = renderHook(() =>
      useWeatherLocation(existing, false, onLocationChange, onManualRefresh),
    );

    act(() => {
      result.current.setManualInput('missing-city');
    });

    await act(async () => {
      await result.current.handleManualSearch();
    });
    expect(result.current.error).toBe('Location not found. Try a different search term.');

    (globalThis as Window & { api?: typeof mockApi }).api = undefined;
    act(() => {
      result.current.setManualInput('x');
    });
    await act(async () => {
      await result.current.handleManualSearch();
    });
    expect(result.current.error).toBe('API not available');
  });

  it('auto-locates using IP and triggers callbacks', async () => {
    mockApi.getIpLocation.mockResolvedValue({
      lat: 35.2,
      lon: -80.8,
      city: 'Charlotte',
      region: 'NC',
      country: 'US',
    });

    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: undefined,
      configurable: true,
    });

    renderHook(() => useWeatherLocation(null, false, onLocationChange, onManualRefresh));

    await waitFor(() => {
      expect(onLocationChange).toHaveBeenCalledWith({
        latitude: 35.2,
        longitude: -80.8,
        name: 'Charlotte, NC US',
      });
    });
    expect(onManualRefresh).toHaveBeenCalledWith(35.2, -80.8);
  });

  it('marks permission denied when gps fails and no location is found', async () => {
    mockApi.getIpLocation.mockResolvedValue(null);

    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: {
        getCurrentPosition: (
          _success: (position: GeolocationPosition) => void,
          error: (positionError: GeolocationPositionError) => void,
        ) => {
          error({ code: 1, message: 'denied' } as GeolocationPositionError);
        },
      },
      configurable: true,
    });

    const { result } = renderHook(() =>
      useWeatherLocation(null, false, onLocationChange, onManualRefresh),
    );

    await waitFor(() => {
      expect(result.current.permissionDenied).toBe(true);
      expect(result.current.error).toBe(
        'Could not detect location automatically. Please search for your city manually.',
      );
    });
  });

  it('uses GPS success path and calls reverseGeocode', async () => {
    mockApi.getIpLocation.mockResolvedValue(null);
    mockApi.searchLocation.mockResolvedValue({
      results: [{ name: 'Portland', admin1: 'OR', country_code: 'US' }],
    });

    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: {
        getCurrentPosition: (
          success: (position: GeolocationPosition) => void,
          _error: (positionError: GeolocationPositionError) => void,
        ) => {
          success({
            coords: { latitude: 45.5051, longitude: -122.675 },
          } as GeolocationPosition);
        },
      },
      configurable: true,
    });

    renderHook(() => useWeatherLocation(null, false, onLocationChange, onManualRefresh));

    await waitFor(() => {
      expect(onLocationChange).toHaveBeenCalledWith(
        expect.objectContaining({
          latitude: 45.5051,
          longitude: -122.675,
          name: 'Portland, OR US',
        }),
      );
    });
    expect(onManualRefresh).toHaveBeenCalledWith(45.5051, -122.675);
  });

  it('reverseGeocode falls back to "Current Location" when no results returned', async () => {
    mockApi.getIpLocation.mockResolvedValue(null);
    // searchLocation returns empty results — reverseGeocode returns fallback
    mockApi.searchLocation.mockResolvedValue({ results: [] });

    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: {
        getCurrentPosition: (
          success: (position: GeolocationPosition) => void,
          _error: (positionError: GeolocationPositionError) => void,
        ) => {
          success({
            coords: { latitude: 51.505, longitude: -0.09 },
          } as GeolocationPosition);
        },
      },
      configurable: true,
    });

    renderHook(() => useWeatherLocation(null, false, onLocationChange, onManualRefresh));

    await waitFor(() => {
      expect(onLocationChange).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Current Location' }),
      );
    });
  });

  it('reverseGeocode falls back when api not available', async () => {
    (globalThis as Window & { api?: typeof mockApi }).api = undefined;
    mockApi.getIpLocation.mockResolvedValue(null);

    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: {
        getCurrentPosition: (
          success: (position: GeolocationPosition) => void,
          _error: (positionError: GeolocationPositionError) => void,
        ) => {
          success({
            coords: { latitude: 48.8566, longitude: 2.3522 },
          } as GeolocationPosition);
        },
      },
      configurable: true,
    });

    renderHook(() => useWeatherLocation(null, false, onLocationChange, onManualRefresh));

    await waitFor(() => {
      expect(onLocationChange).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Current Location' }),
      );
    });
  });

  it('handleManualSearch sets error when API throws', async () => {
    const existing: Location = { latitude: 1, longitude: 2, name: 'Existing' };
    mockApi.searchLocation.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() =>
      useWeatherLocation(existing, false, onLocationChange, onManualRefresh),
    );

    act(() => {
      result.current.setManualInput('broken-city');
    });

    await act(async () => {
      await result.current.handleManualSearch();
    });

    expect(result.current.error).toBe('network error');
  });

  it('IP location catch path logs warning when getIpLocation throws', async () => {
    const { loggers } = await import('../../utils/logger');
    mockApi.getIpLocation.mockRejectedValue(new Error('ip-fail'));

    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: undefined,
      configurable: true,
    });

    renderHook(() => useWeatherLocation(null, false, onLocationChange, onManualRefresh));

    await waitFor(() => {
      expect(loggers.weather.warn).toHaveBeenCalledWith(
        '[Weather] IP location failed',
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });
});
