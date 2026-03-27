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
  TabFallback: () => <div data-testid="tab-fallback">tab-fallback</div>,
}));

vi.mock('../../components/ConfirmModal', () => ({
  ConfirmModal: ({
    isOpen,
    onConfirm,
    onClose,
    message,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onClose: () => void;
    message: string;
  }) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <span>{message}</span>
        <button onClick={onConfirm}>Confirm Delete</button>
        <button onClick={onClose}>Cancel Delete</button>
      </div>
    ) : null,
}));

vi.mock('../weather', () => ({
  WeatherAlertCard: ({
    alert,
    isExpanded,
    onToggle,
  }: {
    alert: { id: string; event: string };
    isExpanded: boolean;
    onToggle: () => void;
  }) => (
    <div data-testid={`alert-${alert.id}`}>
      <span>{alert.event}</span>
      <span>{isExpanded ? 'expanded' : 'collapsed'}</span>
      <button onClick={onToggle}>Toggle Alert</button>
    </div>
  ),
  HourlyForecast: ({ weather }: { weather: unknown }) => (
    <div data-testid="hourly-forecast">{weather ? 'has-weather' : 'no-weather'}</div>
  ),
  DailyForecast: ({ weather }: { weather: unknown }) => (
    <div data-testid="daily-forecast">{weather ? 'has-weather' : 'no-weather'}</div>
  ),
  RadarPanel: ({ location }: { location: unknown }) => (
    <div data-testid="radar-panel">{location ? 'has-location' : 'no-location'}</div>
  ),
  SaveLocationModal: ({
    onClose,
    onSave,
  }: {
    onClose: () => void;
    onSave: (name: string, isDefault: boolean) => void;
  }) => (
    <div data-testid="save-location-modal">
      <button onClick={() => onSave('Test Location', false)}>Save Location</button>
      <button onClick={onClose}>Close Save Modal</button>
    </div>
  ),
  RenameLocationModal: ({
    onClose,
    onRename,
    location,
  }: {
    onClose: () => void;
    onRename: (name: string) => void;
    location: { name: string };
  }) => (
    <div data-testid="rename-location-modal">
      <span>Rename: {location.name}</span>
      <button onClick={() => onRename('New Name')}>Rename</button>
      <button onClick={onClose}>Close Rename Modal</button>
    </div>
  ),
  WeatherHeader: ({
    handleSelectSavedLocation,
    handleManualSearch,
    handleAutoLocate,
    savedLocations,
    setSaveModalOpen,
    handleOpenRename,
    setLocationToDelete,
    isSearching,
    location,
  }: {
    handleSelectSavedLocation: (saved: {
      id: string;
      name: string;
      lat: number;
      lon: number;
      isDefault: boolean;
    }) => Promise<void>;
    handleManualSearch: () => Promise<void>;
    handleAutoLocate: () => Promise<void>;
    savedLocations: Array<{
      id: string;
      name: string;
      lat: number;
      lon: number;
      isDefault: boolean;
    }>;
    setSaveModalOpen: (open: boolean) => void;
    handleOpenRename: (saved: {
      id: string;
      name: string;
      lat: number;
      lon: number;
      isDefault: boolean;
    }) => void;
    setLocationToDelete: (
      saved: {
        id: string;
        name: string;
        lat: number;
        lon: number;
        isDefault: boolean;
      } | null,
    ) => void;
    isSearching: boolean;
    location: { latitude: number; longitude: number; name?: string } | null;
  }) => (
    <div data-testid="weather-header">
      {isSearching && <span data-testid="searching">Searching...</span>}
      {location && <span data-testid="location-name">{location.name}</span>}
      {savedLocations.length > 0 && (
        <button
          onClick={async () => {
            await handleSelectSavedLocation(savedLocations[0]);
          }}
        >
          Select Saved
        </button>
      )}
      <button onClick={() => handleManualSearch()}>Manual Search</button>
      <button onClick={() => handleAutoLocate()}>Auto Locate</button>
      <button onClick={() => setSaveModalOpen(true)}>Open Save Modal</button>
      {savedLocations.length > 0 && (
        <>
          <button onClick={() => handleOpenRename(savedLocations[0])}>Rename Location</button>
          <button onClick={() => setLocationToDelete(savedLocations[0])}>Delete Location</button>
        </>
      )}
    </div>
  ),
}));

describe('WeatherTab', () => {
  const mockApi = {
    searchLocation: vi.fn(),
  };

  const defaultProps = {
    weather: null,
    alerts: [] as Array<{
      id: string;
      event: string;
      severity: string;
      description: string;
      start: number;
      end: number;
    }>,
    location: { latitude: 35, longitude: -80, name: 'Current' },
    loading: false,
    onLocationChange: vi.fn(),
    onManualRefresh: vi.fn(),
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

  // ── Loading / Fallback States ──

  it('renders TabFallback when location is null and loading is true', () => {
    render(<WeatherTab {...defaultProps} location={null} loading={true} />);
    expect(screen.getByTestId('tab-fallback')).toBeInTheDocument();
  });

  it('does not render TabFallback when location is null but loading is false', () => {
    render(<WeatherTab {...defaultProps} location={null} loading={false} />);
    expect(screen.queryByTestId('tab-fallback')).not.toBeInTheDocument();
  });

  it('does not render TabFallback when location exists and loading is true', () => {
    render(<WeatherTab {...defaultProps} loading={true} />);
    expect(screen.queryByTestId('tab-fallback')).not.toBeInTheDocument();
  });

  // ── Layout Classes (hasForecastContent branches) ──

  it('uses radar-only class when weather is null and alerts are empty', () => {
    const { container } = render(<WeatherTab {...defaultProps} weather={null} alerts={[]} />);
    const tabBody = container.querySelector('.weather-tab-body');
    expect(tabBody?.classList.contains('weather-tab-body--radar-only')).toBe(true);
  });

  it('does not use radar-only class when weather data is present', () => {
    const weatherData = {
      current: {
        temperature: 72,
        humidity: 50,
        windSpeed: 10,
        windDirection: 180,
        weatherCode: 0,
        time: '',
      },
      hourly: [],
      daily: [],
    };
    const { container } = render(<WeatherTab {...defaultProps} weather={weatherData as never} />);
    const tabBody = container.querySelector('.weather-tab-body');
    expect(tabBody?.classList.contains('weather-tab-body--radar-only')).toBe(false);
  });

  it('does not use radar-only class when alerts are present', () => {
    const alerts = [
      {
        id: 'alert-1',
        event: 'Severe Storm',
        severity: 'warning',
        description: 'Bad weather',
        start: 1000,
        end: 2000,
      },
    ];
    const { container } = render(<WeatherTab {...defaultProps} alerts={alerts as never[]} />);
    const tabBody = container.querySelector('.weather-tab-body');
    expect(tabBody?.classList.contains('weather-tab-body--radar-only')).toBe(false);
  });

  it('uses hidden class for forecast column when no forecast content', () => {
    const { container } = render(<WeatherTab {...defaultProps} weather={null} alerts={[]} />);
    const forecastCol = container.querySelector('.weather-forecast-column');
    expect(forecastCol?.classList.contains('weather-forecast-column--hidden')).toBe(true);
  });

  // ── Alerts ──

  it('renders alert cards when alerts are provided', () => {
    const alerts = [
      {
        id: 'alert-1',
        event: 'Tornado Warning',
        severity: 'extreme',
        description: 'Take cover',
        start: 1000,
        end: 2000,
      },
      {
        id: 'alert-2',
        event: 'Flash Flood Watch',
        severity: 'moderate',
        description: 'Possible flooding',
        start: 1000,
        end: 2000,
      },
    ];
    render(<WeatherTab {...defaultProps} alerts={alerts as never[]} />);
    expect(screen.getByText('Tornado Warning')).toBeInTheDocument();
    expect(screen.getByText('Flash Flood Watch')).toBeInTheDocument();
  });

  it('toggles alert expansion', () => {
    const alerts = [
      {
        id: 'alert-1',
        event: 'Tornado Warning',
        severity: 'extreme',
        description: 'Take cover',
        start: 1000,
        end: 2000,
      },
    ];
    render(<WeatherTab {...defaultProps} alerts={alerts as never[]} />);
    expect(screen.getByText('collapsed')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Toggle Alert'));
    expect(screen.getByText('expanded')).toBeInTheDocument();

    // Toggle again to collapse
    fireEvent.click(screen.getByText('Toggle Alert'));
    expect(screen.getByText('collapsed')).toBeInTheDocument();
  });

  // ── Saved Location Selection ──

  it('selecting a saved location updates location without triggering extra manual refresh', async () => {
    mockApi.searchLocation.mockResolvedValue({
      results: [{ name: 'Austin', admin1: 'TX', country_code: 'US' }],
    });

    const onLocationChange = vi.fn();
    const onManualRefresh = vi.fn();

    render(
      <WeatherTab
        {...defaultProps}
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

  it('falls back to saved location name when reverse geocode fails', async () => {
    mockApi.searchLocation.mockRejectedValue(new Error('Network error'));

    const onLocationChange = vi.fn();
    render(<WeatherTab {...defaultProps} onLocationChange={onLocationChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Saved' }));

    await waitFor(() => {
      expect(onLocationChange).toHaveBeenCalledWith({
        name: 'Austin, TX',
        latitude: 30,
        longitude: -97,
      });
    });
  });

  it('falls back to saved name when API is not available', async () => {
    (globalThis as Record<string, unknown>).api = undefined;

    const onLocationChange = vi.fn();
    render(<WeatherTab {...defaultProps} onLocationChange={onLocationChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Saved' }));

    await waitFor(() => {
      expect(onLocationChange).toHaveBeenCalledWith({
        name: 'Austin, TX',
        latitude: 30,
        longitude: -97,
      });
    });
  });

  it('shows searching indicator while selecting saved location', async () => {
    let resolveSearch!: (value: unknown) => void;
    mockApi.searchLocation.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    render(<WeatherTab {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Saved' }));

    // While awaiting, isSearching should be true
    await waitFor(() => {
      expect(screen.getByTestId('searching')).toBeInTheDocument();
    });

    // Resolve the search
    resolveSearch({ results: [{ name: 'Austin', admin1: 'TX', country_code: 'US' }] });

    await waitFor(() => {
      expect(screen.queryByTestId('searching')).not.toBeInTheDocument();
    });
  });

  // ── Manual Search and Auto Locate ──

  it('calls manual search handler and sets searching state', async () => {
    const mockHandleManualSearch = vi.fn(async () => {});
    mockUseWeatherLocation.mockReturnValue({
      manualInput: '',
      setManualInput: vi.fn(),
      error: null,
      permissionDenied: false,
      handleAutoLocate: vi.fn(async () => {}),
      handleManualSearch: mockHandleManualSearch,
    });

    render(<WeatherTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Manual Search'));

    await waitFor(() => {
      expect(mockHandleManualSearch).toHaveBeenCalled();
    });
  });

  it('calls auto locate handler and sets searching state', async () => {
    const mockHandleAutoLocate = vi.fn(async () => {});
    mockUseWeatherLocation.mockReturnValue({
      manualInput: '',
      setManualInput: vi.fn(),
      error: null,
      permissionDenied: false,
      handleAutoLocate: mockHandleAutoLocate,
      handleManualSearch: vi.fn(async () => {}),
    });

    render(<WeatherTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Auto Locate'));

    await waitFor(() => {
      expect(mockHandleAutoLocate).toHaveBeenCalled();
    });
  });

  // ── Save Location Modal ──

  it('opens save location modal', () => {
    render(<WeatherTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Open Save Modal'));
    expect(screen.getByTestId('save-location-modal')).toBeInTheDocument();
  });

  it('closes save location modal', () => {
    render(<WeatherTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Open Save Modal'));
    fireEvent.click(screen.getByText('Close Save Modal'));
    expect(screen.queryByTestId('save-location-modal')).not.toBeInTheDocument();
  });

  it('calls saveLocation when saving from modal', async () => {
    const mockSaveLocation = vi.fn(async () => {});
    mockUseSavedLocations.mockReturnValue({
      locations: [{ id: 'loc-1', name: 'Austin, TX', lat: 30, lon: -97, isDefault: false }],
      saveLocation: mockSaveLocation,
      deleteLocation: vi.fn(async () => {}),
      setDefaultLocation: vi.fn(async () => {}),
      clearDefaultLocation: vi.fn(async () => {}),
      updateLocation: vi.fn(async () => {}),
    });

    render(<WeatherTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Open Save Modal'));
    fireEvent.click(screen.getByText('Save Location'));

    await waitFor(() => {
      expect(mockSaveLocation).toHaveBeenCalledWith({
        name: 'Test Location',
        lat: 35,
        lon: -80,
        isDefault: false,
      });
    });
  });

  // ── Rename Location Modal ──

  it('opens rename location modal', () => {
    render(<WeatherTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Rename Location'));
    expect(screen.getByTestId('rename-location-modal')).toBeInTheDocument();
    expect(screen.getByText('Rename: Austin, TX')).toBeInTheDocument();
  });

  it('calls updateLocation when renaming', async () => {
    const mockUpdateLocation = vi.fn(async () => {});
    mockUseSavedLocations.mockReturnValue({
      locations: [{ id: 'loc-1', name: 'Austin, TX', lat: 30, lon: -97, isDefault: false }],
      saveLocation: vi.fn(async () => {}),
      deleteLocation: vi.fn(async () => {}),
      setDefaultLocation: vi.fn(async () => {}),
      clearDefaultLocation: vi.fn(async () => {}),
      updateLocation: mockUpdateLocation,
    });

    render(<WeatherTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Rename Location'));
    fireEvent.click(screen.getByText('Rename'));

    await waitFor(() => {
      expect(mockUpdateLocation).toHaveBeenCalledWith('loc-1', { name: 'New Name' });
    });
  });

  // ── Delete Location ──

  it('opens confirm modal when delete location is triggered', () => {
    render(<WeatherTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Delete Location'));
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
    expect(screen.getByText(/Austin, TX/)).toBeInTheDocument();
  });

  it('calls deleteLocation when confirmed', async () => {
    const mockDeleteLocation = vi.fn(async () => {});
    mockUseSavedLocations.mockReturnValue({
      locations: [{ id: 'loc-1', name: 'Austin, TX', lat: 30, lon: -97, isDefault: false }],
      saveLocation: vi.fn(async () => {}),
      deleteLocation: mockDeleteLocation,
      setDefaultLocation: vi.fn(async () => {}),
      clearDefaultLocation: vi.fn(async () => {}),
      updateLocation: vi.fn(async () => {}),
    });

    render(<WeatherTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Delete Location'));
    fireEvent.click(screen.getByText('Confirm Delete'));

    await waitFor(() => {
      expect(mockDeleteLocation).toHaveBeenCalledWith('loc-1');
    });
  });

  it('closes confirm modal when cancelled', () => {
    render(<WeatherTab {...defaultProps} />);
    fireEvent.click(screen.getByText('Delete Location'));
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel Delete'));
    expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument();
  });

  // ── Sub-components rendered ──

  it('renders radar panel, hourly and daily forecasts', () => {
    render(<WeatherTab {...defaultProps} />);
    expect(screen.getByTestId('radar-panel')).toBeInTheDocument();
    expect(screen.getByTestId('hourly-forecast')).toBeInTheDocument();
    expect(screen.getByTestId('daily-forecast')).toBeInTheDocument();
  });

  it('passes weather data to forecast components', () => {
    const weatherData = {
      current: {
        temperature: 72,
        humidity: 50,
        windSpeed: 10,
        windDirection: 180,
        weatherCode: 0,
        time: '',
      },
      hourly: [],
      daily: [],
    };
    render(<WeatherTab {...defaultProps} weather={weatherData as never} />);
    expect(screen.getByTestId('hourly-forecast')).toHaveTextContent('has-weather');
    expect(screen.getByTestId('daily-forecast')).toHaveTextContent('has-weather');
  });

  it('passes null weather to forecast components when no weather data', () => {
    render(<WeatherTab {...defaultProps} weather={null} />);
    expect(screen.getByTestId('hourly-forecast')).toHaveTextContent('no-weather');
    expect(screen.getByTestId('daily-forecast')).toHaveTextContent('no-weather');
  });
});
