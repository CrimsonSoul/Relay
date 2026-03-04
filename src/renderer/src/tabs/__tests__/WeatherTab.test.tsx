import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WeatherTab } from '../WeatherTab';

const mockUseWeatherLocation = vi.fn();
const mockUseSavedLocations = vi.fn();

vi.mock('../../hooks/useWeatherLocation', () => ({
  useWeatherLocation: (...args: unknown[]) => mockUseWeatherLocation(...args),
}));

vi.mock('../../hooks/useSavedLocations', () => ({
  useSavedLocations: () => mockUseSavedLocations(),
}));

vi.mock('../../components/TabFallback', () => ({
  TabFallback: () => <div>tab-fallback</div>,
}));

vi.mock('../../components/ConfirmModal', () => ({
  ConfirmModal: () => null,
}));

vi.mock('../weather', () => ({
  WeatherAlertCard: () => null,
  HourlyForecast: () => null,
  DailyForecast: () => null,
  RadarPanel: () => null,
  SaveLocationModal: () => null,
  RenameLocationModal: () => null,
  WeatherHeader: ({
    handleSelectSavedLocation,
    savedLocations,
  }: {
    handleSelectSavedLocation: (saved: {
      id: string;
      name: string;
      lat: number;
      lon: number;
      isDefault: boolean;
    }) => Promise<void>;
    savedLocations: Array<{
      id: string;
      name: string;
      lat: number;
      lon: number;
      isDefault: boolean;
    }>;
  }) => (
    <button
      type="button"
      onClick={async () => {
        await handleSelectSavedLocation(savedLocations[0]);
      }}
    >
      Select Saved
    </button>
  ),
}));

describe('WeatherTab', () => {
  const mockApi = {
    searchLocation: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;

    mockUseWeatherLocation.mockReturnValue({
      manualInput: '',
      setManualInput: vi.fn(),
      error: null,
      permissionDenied: false,
      handleAutoLocate: vi.fn(async () => {}),
      handleManualSearch: vi.fn(async () => {}),
    });

    mockUseSavedLocations.mockReturnValue({
      locations: [{ id: 'loc-1', name: 'Austin, TX', lat: 30, lon: -97, isDefault: false }],
      saveLocation: vi.fn(async () => {}),
      deleteLocation: vi.fn(async () => {}),
      setDefaultLocation: vi.fn(async () => {}),
      clearDefaultLocation: vi.fn(async () => {}),
      updateLocation: vi.fn(async () => {}),
    });
  });

  it('selecting a saved location updates location without triggering extra manual refresh', async () => {
    mockApi.searchLocation.mockResolvedValue({
      results: [{ name: 'Austin', admin1: 'TX', country_code: 'US' }],
    });

    const onLocationChange = vi.fn();
    const onManualRefresh = vi.fn();

    render(
      <WeatherTab
        weather={null}
        alerts={[]}
        location={{ latitude: 35, longitude: -80, name: 'Current' }}
        loading={false}
        onLocationChange={onLocationChange}
        onManualRefresh={onManualRefresh}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select Saved' }));

    await waitFor(() => {
      expect(onLocationChange).toHaveBeenCalledWith({
        name: 'Austin, TX US',
        latitude: 30,
        longitude: -97,
      });
    });
    expect(onManualRefresh).not.toHaveBeenCalled();
  });
});
