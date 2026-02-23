import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocationProvider, useLocation } from '../LocationContext';

// Mock the logger so we don't need IPC
vi.mock('../../utils/logger', () => ({
  loggers: {
    location: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(LocationProvider, null, children);

describe('LocationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when useLocation is used outside provider', () => {
    // Suppress React error boundary noise
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useLocation())).toThrow(
      'useLocation must be used within a LocationProvider',
    );
    consoleError.mockRestore();
  });

  it('starts with loading=true and null coordinates', async () => {
    const mockGetPosition = vi.fn((_success, error) => {
      error({ code: 1, message: 'denied' });
    });
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition: mockGetPosition },
    });

    const mockApi = { getIpLocation: vi.fn().mockResolvedValue(null) };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi;

    const { result } = renderHook(() => useLocation(), { wrapper });
    expect(result.current.loading).toBe(true);
    expect(result.current.lat).toBeNull();
    expect(result.current.lon).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('sets error state when both IP and GPS fail', async () => {
    const mockGetPosition = vi.fn((_success, error) => {
      error({ code: 1, message: 'denied' });
    });
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: mockGetPosition },
    });

    const mockApi = { getIpLocation: vi.fn().mockResolvedValue(null) };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi;

    const { result } = renderHook(() => useLocation(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.lat).toBeNull();
  });

  it('sets location from IP when GPS fails', async () => {
    const mockGetPosition = vi.fn((_success, error) => {
      error({ code: 1, message: 'denied' });
    });
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: mockGetPosition },
    });

    const mockApi = {
      getIpLocation: vi.fn().mockResolvedValue({
        lat: '37.7749',
        lon: '-122.4194',
        city: 'San Francisco',
        region: 'CA',
        country: 'US',
        timezone: 'America/Los_Angeles',
      }),
    };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi;

    const { result } = renderHook(() => useLocation(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.city).toBe('San Francisco');
    expect(result.current.source).toBe('ip');
    expect(result.current.error).toBeNull();
  });

  it('sets GPS location when GPS succeeds', async () => {
    const mockGetPosition = vi.fn((success) => {
      success({
        coords: { latitude: 40.7128, longitude: -74.006 },
      });
    });
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: mockGetPosition },
    });

    const mockApi = { getIpLocation: vi.fn().mockResolvedValue(null) };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi;

    const { result } = renderHook(() => useLocation(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lat).toBeCloseTo(40.7128, 2);
    expect(result.current.source).toBe('gps');
  });

  it('defaults timezone to system timezone on init', () => {
    const mockGetPosition = vi.fn((_success, error) => {
      error({ code: 1, message: 'denied' });
    });
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: mockGetPosition },
    });
    const mockApi = { getIpLocation: vi.fn().mockResolvedValue(null) };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi;

    const { result } = renderHook(() => useLocation(), { wrapper });
    expect(result.current.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('exposes a refresh function that re-fetches location', async () => {
    const mockGetPosition = vi.fn((_success, error) => {
      error({ code: 1, message: 'denied' });
    });
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: mockGetPosition },
    });

    const getIpLocation = vi.fn().mockResolvedValue(null);
    const mockApi = { getIpLocation };
    (globalThis as Window & { api: typeof mockApi }).api = mockApi;

    const { result } = renderHook(() => useLocation(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const callCount = getIpLocation.mock.calls.length;

    await act(async () => {
      await result.current.refresh();
    });

    expect(getIpLocation.mock.calls.length).toBeGreaterThan(callCount);
  });
});
