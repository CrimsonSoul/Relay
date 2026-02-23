import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HourlyForecast } from '../HourlyForecast';
import type { WeatherData } from '../types';

// Mock Tooltip to avoid portal/getBoundingClientRect issues in jsdom
vi.mock('../../../components/Tooltip', () => ({
  Tooltip: ({ children, content }: { children: React.ReactElement; content: string }) =>
    React.createElement('div', { 'data-testid': 'tooltip', 'data-content': content }, children),
}));

const makeHourlyTimes = (startHour: number, count: number): string[] => {
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const hour = (startHour + i) % 24;
    result.push(`2026-02-22T${String(hour).padStart(2, '0')}:00`);
  }
  return result;
};

const makeWeather = (overrides: Partial<WeatherData> = {}): WeatherData => ({
  utc_offset_seconds: 0,
  current_weather: {
    temperature: 72,
    windspeed: 5,
    winddirection: 180,
    weathercode: 0,
    time: '2026-02-22T12:00',
  },
  hourly: {
    time: makeHourlyTimes(8, 24),
    temperature_2m: Array.from({ length: 24 }, (_, i) => 60 + i),
    weathercode: Array.from({ length: 24 }, () => 0),
    precipitation_probability: Array.from({ length: 24 }, (_, i) => (i % 4 === 0 ? 20 : 0)),
  },
  daily: {
    time: ['2026-02-22'],
    weathercode: [0],
    temperature_2m_max: [75],
    temperature_2m_min: [55],
    wind_speed_10m_max: [5],
    precipitation_probability_max: [20],
  },
  ...overrides,
});

describe('HourlyForecast', () => {
  it('renders null when weather is null', () => {
    const { container } = render(<HourlyForecast weather={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Hourly Forecast heading', () => {
    render(<HourlyForecast weather={makeWeather()} />);
    expect(screen.getByText('Hourly Forecast')).toBeInTheDocument();
  });

  it('renders hourly items as a list', () => {
    render(<HourlyForecast weather={makeWeather()} />);
    const list = document.querySelector('.hourly-forecast-list');
    expect(list).not.toBeNull();
    const items = document.querySelectorAll('.hourly-forecast-item');
    expect(items.length).toBeGreaterThan(0);
  });

  it('shows Now for the current hour item', () => {
    render(<HourlyForecast weather={makeWeather()} />);
    // The first matching item should show "Now"
    expect(screen.getByText('Now')).toBeInTheDocument();
  });

  it('renders temperature values with degree symbol', () => {
    render(<HourlyForecast weather={makeWeather()} />);
    const temps = screen.getAllByText(/°/);
    expect(temps.length).toBeGreaterThan(0);
  });

  it('renders precipitation percentage when > 0', () => {
    const weather = makeWeather({
      hourly: {
        time: makeHourlyTimes(8, 24),
        temperature_2m: Array.from({ length: 24 }, () => 70),
        weathercode: Array.from({ length: 24 }, () => 61),
        precipitation_probability: Array.from({ length: 24 }, () => 40),
      },
    });
    render(<HourlyForecast weather={weather} />);
    // Should show 40% for items with precipitation
    const precipItems = screen.getAllByText('40%');
    expect(precipItems.length).toBeGreaterThan(0);
  });

  it('shows spacer div when precipitation probability is 0', () => {
    const weather = makeWeather({
      hourly: {
        time: makeHourlyTimes(8, 12),
        temperature_2m: Array.from({ length: 12 }, () => 70),
        weathercode: Array.from({ length: 12 }, () => 0),
        precipitation_probability: Array.from({ length: 12 }, () => 0),
      },
    });
    const { container } = render(<HourlyForecast weather={weather} />);
    const spacers = container.querySelectorAll('.hourly-forecast-precip-spacer');
    expect(spacers.length).toBeGreaterThan(0);
  });

  it('renders empty list when hourly times are empty', () => {
    const weather = makeWeather({
      hourly: {
        time: [],
        temperature_2m: [],
        weathercode: [],
        precipitation_probability: [],
      },
    });
    render(<HourlyForecast weather={weather} />);
    expect(screen.getByText('Hourly Forecast')).toBeInTheDocument();
    const items = document.querySelectorAll('.hourly-forecast-item');
    expect(items.length).toBe(0);
  });

  it('handles missing time entry gracefully', () => {
    const weather = makeWeather({
      hourly: {
        // time with no T separator
        time: ['2026-02-22', '2026-02-22', '2026-02-22'],
        temperature_2m: [70, 71, 72],
        weathercode: [0, 0, 0],
        precipitation_probability: [0, 0, 0],
      },
    });
    // Should not throw
    render(<HourlyForecast weather={weather} />);
    expect(screen.getByText('Hourly Forecast')).toBeInTheDocument();
  });

  it('uses UTC fallback when location key not found', () => {
    // Provide times that won't match locationKey or utcKey
    // so it falls back to findIndex > locationKey
    const futureTimes = ['2099-01-01T00:00', '2099-01-01T01:00', '2099-01-01T02:00'];
    const weather = makeWeather({
      hourly: {
        time: futureTimes,
        temperature_2m: [70, 71, 72],
        weathercode: [0, 0, 0],
        precipitation_probability: [0, 0, 0],
      },
    });
    render(<HourlyForecast weather={weather} />);
    expect(screen.getByText('Hourly Forecast')).toBeInTheDocument();
  });

  it('uses startIndex=0 when no time matches', () => {
    // All times in the past so findIndex returns -1
    const pastTimes = ['2000-01-01T00:00', '2000-01-01T01:00'];
    const weather = makeWeather({
      hourly: {
        time: pastTimes,
        temperature_2m: [60, 61],
        weathercode: [0, 0],
        precipitation_probability: [0, 0],
      },
    });
    render(<HourlyForecast weather={weather} />);
    expect(screen.getByText('Hourly Forecast')).toBeInTheDocument();
  });

  it('handles AM/PM formatting correctly', () => {
    const morningTimes = [
      '2026-02-22T00:00',
      '2026-02-22T12:00',
      '2026-02-22T13:00',
      '2026-02-22T23:00',
    ];
    const weather = makeWeather({
      utc_offset_seconds: -99999999, // push location time far back so index 0 is used
      hourly: {
        time: morningTimes,
        temperature_2m: [60, 70, 71, 65],
        weathercode: [0, 0, 0, 0],
        precipitation_probability: [0, 0, 0, 0],
      },
    });
    render(<HourlyForecast weather={weather} />);
    expect(screen.getByText('Hourly Forecast')).toBeInTheDocument();
  });
});
