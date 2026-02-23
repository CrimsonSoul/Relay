import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WeatherHeader } from '../WeatherHeader';
import type { SavedLocation } from '@shared/ipc';
import type { Location, WeatherData } from '../types';

// Mock child components
vi.mock('../../../components/CollapsibleHeader', () => ({
  CollapsibleHeader: ({
    title,
    subtitle,
    children,
  }: {
    title: string;
    subtitle?: string;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'collapsible-header' },
      React.createElement('h1', { 'data-testid': 'header-title' }, title),
      subtitle && React.createElement('div', { 'data-testid': 'header-subtitle' }, subtitle),
      children,
    ),
}));

vi.mock('../../../components/TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
    title: btnTitle,
    variant,
    icon,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    'aria-label'?: string;
    title?: string;
    variant?: string;
    icon?: React.ReactNode;
  }) =>
    React.createElement(
      'button',
      {
        onClick,
        disabled,
        'aria-label': ariaLabel || btnTitle,
        'data-variant': variant,
        'data-testid': ariaLabel || btnTitle,
      },
      icon,
      children,
    ),
}));

const makeSavedLocation = (overrides: Partial<SavedLocation> = {}): SavedLocation => ({
  id: 'saved-1',
  name: 'Headquarters',
  lat: 35.4676,
  lon: -97.5164,
  isDefault: false,
  ...overrides,
});

const makeLocation = (): Location => ({
  latitude: 35.4676,
  longitude: -97.5164,
  name: 'Oklahoma City',
});

const makeWeather = (): WeatherData => ({
  utc_offset_seconds: 0,
  current_weather: {
    temperature: 72,
    windspeed: 5,
    winddirection: 180,
    weathercode: 0,
    time: '2026-02-22T12:00',
  },
  hourly: { time: [], temperature_2m: [], weathercode: [], precipitation_probability: [] },
  daily: {
    time: [],
    weathercode: [],
    temperature_2m_max: [],
    temperature_2m_min: [],
    wind_speed_10m_max: [],
    precipitation_probability_max: [],
  },
});

const defaultProps = {
  location: makeLocation(),
  activeSavedLocation: null,
  weather: null,
  isSearching: false,
  loc: {
    manualInput: '',
    setManualInput: vi.fn(),
    error: null,
  },
  handleManualSearch: vi.fn(),
  handleAutoLocate: vi.fn(),
  showLocationMenu: false,
  setShowLocationMenu: vi.fn(),
  locationMenuRef: { current: null } as React.RefObject<HTMLDivElement>,
  savedLocations: [],
  setSaveModalOpen: vi.fn(),
  handleSelectSavedLocation: vi.fn(),
  handleOpenRename: vi.fn(),
  setLocationToDelete: vi.fn(),
  clearDefaultLocation: vi.fn(),
  setDefaultLocation: vi.fn(),
};

describe('WeatherHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with default title Weather when no location or saved location', () => {
    render(<WeatherHeader {...defaultProps} location={null} />);
    expect(screen.getByTestId('header-title')).toHaveTextContent('Weather');
  });

  it('renders location name as title when location is set', () => {
    render(<WeatherHeader {...defaultProps} />);
    expect(screen.getByTestId('header-title')).toHaveTextContent('Oklahoma City');
  });

  it('renders saved location name as title when activeSavedLocation is set', () => {
    render(
      <WeatherHeader {...defaultProps} activeSavedLocation={makeSavedLocation({ name: 'HQ' })} />,
    );
    expect(screen.getByTestId('header-title')).toHaveTextContent('HQ');
  });

  it('renders weather subtitle when weather data is available', () => {
    render(<WeatherHeader {...defaultProps} weather={makeWeather()} />);
    const subtitle = screen.getByTestId('header-subtitle');
    expect(subtitle).toBeInTheDocument();
    expect(subtitle.textContent).toContain('72°F');
  });

  it('does not render subtitle when weather is null', () => {
    render(<WeatherHeader {...defaultProps} weather={null} />);
    expect(screen.queryByTestId('header-subtitle')).toBeNull();
  });

  it('renders search button', () => {
    render(<WeatherHeader {...defaultProps} />);
    expect(screen.getByTestId('Search city')).toBeInTheDocument();
  });

  it('shows search popover when search button is clicked', () => {
    render(<WeatherHeader {...defaultProps} />);
    fireEvent.click(screen.getByTestId('Search city'));
    expect(screen.getByPlaceholderText('Search city...')).toBeInTheDocument();
  });

  it('hides search popover on second click', () => {
    render(<WeatherHeader {...defaultProps} />);
    fireEvent.click(screen.getByTestId('Search city'));
    fireEvent.click(screen.getByTestId('Search city'));
    expect(screen.queryByPlaceholderText('Search city...')).toBeNull();
  });

  it('calls setManualInput when typing in search input', () => {
    const setManualInput = vi.fn();
    render(
      <WeatherHeader {...defaultProps} loc={{ manualInput: '', setManualInput, error: null }} />,
    );
    fireEvent.click(screen.getByTestId('Search city'));
    const input = screen.getByPlaceholderText('Search city...');
    fireEvent.change(input, { target: { value: 'Dallas' } });
    expect(setManualInput).toHaveBeenCalledWith('Dallas');
  });

  it('calls handleManualSearch on Enter key when input is non-empty', () => {
    const handleManualSearch = vi.fn();
    render(
      <WeatherHeader
        {...defaultProps}
        loc={{ manualInput: 'Dallas', setManualInput: vi.fn(), error: null }}
        handleManualSearch={handleManualSearch}
      />,
    );
    fireEvent.click(screen.getByTestId('Search city'));
    const input = screen.getByPlaceholderText('Search city...');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handleManualSearch).toHaveBeenCalled();
  });

  it('does not call handleManualSearch on Enter key when input is empty', () => {
    const handleManualSearch = vi.fn();
    render(
      <WeatherHeader
        {...defaultProps}
        loc={{ manualInput: '', setManualInput: vi.fn(), error: null }}
        handleManualSearch={handleManualSearch}
      />,
    );
    fireEvent.click(screen.getByTestId('Search city'));
    const input = screen.getByPlaceholderText('Search city...');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handleManualSearch).not.toHaveBeenCalled();
  });

  it('closes search popover on Escape key', () => {
    render(<WeatherHeader {...defaultProps} />);
    fireEvent.click(screen.getByTestId('Search city'));
    expect(screen.getByPlaceholderText('Search city...')).toBeInTheDocument();
    const input = screen.getByPlaceholderText('Search city...');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Search city...')).toBeNull();
  });

  it('shows error badge when loc.error is set', () => {
    render(
      <WeatherHeader
        {...defaultProps}
        loc={{ manualInput: '', setManualInput: vi.fn(), error: 'Location not found' }}
      />,
    );
    fireEvent.click(screen.getByTestId('Search city'));
    expect(screen.getByText('Location not found')).toBeInTheDocument();
  });

  it('shows Searching... placeholder when isSearching', () => {
    render(<WeatherHeader {...defaultProps} isSearching={true} />);
    // When isSearching, the search button is disabled — cannot open the popover
    const searchBtn = screen.getByTestId('Search city');
    expect(searchBtn).toBeDisabled();
  });

  it('renders auto-locate button', () => {
    render(<WeatherHeader {...defaultProps} />);
    expect(screen.getByTestId('Detect current location')).toBeInTheDocument();
  });

  it('calls handleAutoLocate when auto-locate button is clicked', () => {
    const handleAutoLocate = vi.fn();
    render(<WeatherHeader {...defaultProps} handleAutoLocate={handleAutoLocate} />);
    fireEvent.click(screen.getByTestId('Detect current location'));
    expect(handleAutoLocate).toHaveBeenCalledTimes(1);
  });

  it('renders saved locations button', () => {
    render(<WeatherHeader {...defaultProps} />);
    expect(screen.getByTestId('Toggle saved locations menu')).toBeInTheDocument();
  });

  it('calls setShowLocationMenu when location menu button is clicked', () => {
    const setShowLocationMenu = vi.fn();
    render(<WeatherHeader {...defaultProps} setShowLocationMenu={setShowLocationMenu} />);
    fireEvent.click(screen.getByTestId('Toggle saved locations menu'));
    expect(setShowLocationMenu).toHaveBeenCalledWith(true);
  });

  it('shows location menu when showLocationMenu is true', () => {
    render(<WeatherHeader {...defaultProps} showLocationMenu={true} />);
    expect(screen.getByText('No saved locations yet')).toBeInTheDocument();
  });

  it('shows save location button in menu when location is set', () => {
    render(<WeatherHeader {...defaultProps} showLocationMenu={true} />);
    expect(screen.getByText(/Save "Oklahoma City"/)).toBeInTheDocument();
  });

  it('calls setSaveModalOpen when save location button is clicked', () => {
    const setSaveModalOpen = vi.fn();
    const setShowLocationMenu = vi.fn();
    render(
      <WeatherHeader
        {...defaultProps}
        showLocationMenu={true}
        setSaveModalOpen={setSaveModalOpen}
        setShowLocationMenu={setShowLocationMenu}
      />,
    );
    fireEvent.click(screen.getByText(/Save "Oklahoma City"/));
    expect(setSaveModalOpen).toHaveBeenCalledWith(true);
    expect(setShowLocationMenu).toHaveBeenCalledWith(false);
  });

  it('renders saved locations list when saved locations exist', () => {
    render(
      <WeatherHeader
        {...defaultProps}
        showLocationMenu={true}
        savedLocations={[makeSavedLocation({ name: 'Office' })]}
      />,
    );
    expect(screen.getByText('Office')).toBeInTheDocument();
  });

  it('calls handleSelectSavedLocation when a saved location item is clicked', () => {
    const handleSelectSavedLocation = vi.fn();
    const saved = makeSavedLocation({ name: 'Office' });
    render(
      <WeatherHeader
        {...defaultProps}
        showLocationMenu={true}
        savedLocations={[saved]}
        handleSelectSavedLocation={handleSelectSavedLocation}
      />,
    );
    fireEvent.click(screen.getByLabelText('Load Office'));
    expect(handleSelectSavedLocation).toHaveBeenCalledWith(saved);
  });

  it('shows DEFAULT badge for default saved location', () => {
    render(
      <WeatherHeader
        {...defaultProps}
        showLocationMenu={true}
        savedLocations={[makeSavedLocation({ isDefault: true, name: 'Home' })]}
      />,
    );
    expect(screen.getByText('DEFAULT')).toBeInTheDocument();
  });

  it('calls handleOpenRename when rename button is clicked', () => {
    const handleOpenRename = vi.fn();
    const saved = makeSavedLocation({ name: 'Office' });
    render(
      <WeatherHeader
        {...defaultProps}
        showLocationMenu={true}
        savedLocations={[saved]}
        handleOpenRename={handleOpenRename}
      />,
    );
    fireEvent.click(screen.getByLabelText('Rename Office'));
    expect(handleOpenRename).toHaveBeenCalledWith(saved);
  });

  it('calls clearDefaultLocation when clear default button is clicked', () => {
    const clearDefaultLocation = vi.fn();
    const saved = makeSavedLocation({ name: 'Home', isDefault: true });
    render(
      <WeatherHeader
        {...defaultProps}
        showLocationMenu={true}
        savedLocations={[saved]}
        clearDefaultLocation={clearDefaultLocation}
      />,
    );
    fireEvent.click(screen.getByLabelText('Remove Home as default'));
    expect(clearDefaultLocation).toHaveBeenCalledWith('saved-1');
  });

  it('calls setDefaultLocation when set default button is clicked', () => {
    const setDefaultLocation = vi.fn();
    const saved = makeSavedLocation({ name: 'Office', isDefault: false });
    render(
      <WeatherHeader
        {...defaultProps}
        showLocationMenu={true}
        savedLocations={[saved]}
        setDefaultLocation={setDefaultLocation}
      />,
    );
    fireEvent.click(screen.getByLabelText('Set Office as default'));
    expect(setDefaultLocation).toHaveBeenCalledWith('saved-1');
  });

  it('calls setLocationToDelete and closes menu when delete button clicked', () => {
    const setLocationToDelete = vi.fn();
    const setShowLocationMenu = vi.fn();
    const saved = makeSavedLocation({ name: 'Office' });
    render(
      <WeatherHeader
        {...defaultProps}
        showLocationMenu={true}
        savedLocations={[saved]}
        setLocationToDelete={setLocationToDelete}
        setShowLocationMenu={setShowLocationMenu}
      />,
    );
    fireEvent.click(screen.getByLabelText('Delete Office'));
    expect(setLocationToDelete).toHaveBeenCalledWith(saved);
    expect(setShowLocationMenu).toHaveBeenCalledWith(false);
  });

  it('closes search popover on outside click', () => {
    render(<WeatherHeader {...defaultProps} />);
    fireEvent.click(screen.getByTestId('Search city'));
    expect(screen.getByPlaceholderText('Search city...')).toBeInTheDocument();
    // Simulate click outside
    fireEvent.mouseDown(document.body);
    expect(screen.queryByPlaceholderText('Search city...')).toBeNull();
  });
});
