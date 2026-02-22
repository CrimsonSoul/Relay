import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DailyForecast } from '../DailyForecast';
import type { WeatherData } from '../types';

// Mock Tooltip to avoid portal/getBoundingClientRect issues in jsdom
vi.mock('../../../components/Tooltip', () => ({
  Tooltip: ({ children, content }: { children: React.ReactElement; content: string }) =>
    React.createElement('div', { 'data-testid': 'tooltip', 'data-content': content }, children),
}));

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
    time: [],
    temperature_2m: [],
    weathercode: [],
    precipitation_probability: [],
  },
  daily: {
    time: ['2026-02-22', '2026-02-23', '2026-02-24'],
    weathercode: [0, 2, 61],
    temperature_2m_max: [75, 70, 65],
    temperature_2m_min: [55, 50, 45],
    wind_speed_10m_max: [5, 12, 7],
    precipitation_probability_max: [0, 20, 60],
  },
  ...overrides,
});

describe('DailyForecast', () => {
  it('renders null when weather is null', () => {
    const { container } = render(<DailyForecast weather={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders 16-Day Forecast heading', () => {
    render(<DailyForecast weather={makeWeather()} />);
    expect(screen.getByText('16-Day Forecast')).toBeInTheDocument();
  });

  it('renders all daily forecast items', () => {
    render(<DailyForecast weather={makeWeather()} />);
    const items = screen.getAllByText(/°/);
    // Each item has a high and low temp, so 2 per day × 3 days = 6
    expect(items.length).toBeGreaterThanOrEqual(6);
  });

  it('labels the first day as Today when it matches today', () => {
    const now = new Date();
    const todayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const weather = makeWeather({
      daily: {
        time: [todayKey, '2026-02-23', '2026-02-24'],
        weathercode: [0, 2, 61],
        temperature_2m_max: [75, 70, 65],
        temperature_2m_min: [55, 50, 45],
        wind_speed_10m_max: [5, 12, 7],
        precipitation_probability_max: [0, 20, 60],
      },
    });
    render(<DailyForecast weather={weather} />);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('shows weekday labels for non-today dates', () => {
    // 2026-02-23 is a Monday
    const weather = makeWeather({
      daily: {
        time: ['2026-02-23', '2026-02-24', '2026-02-25'],
        weathercode: [0, 2, 61],
        temperature_2m_max: [75, 70, 65],
        temperature_2m_min: [55, 50, 45],
        wind_speed_10m_max: [5, 12, 7],
        precipitation_probability_max: [0, 20, 60],
      },
    });
    render(<DailyForecast weather={weather} />);
    // Mon Feb 23 2026 is a Monday
    expect(screen.getByText('Mon')).toBeInTheDocument();
  });

  it('shows wind badge when wind speed > 8', () => {
    render(<DailyForecast weather={makeWeather()} />);
    // Day 1 has wind_speed_10m_max = 12 > 8, so wind badge should appear
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('does not show wind badge when wind speed <= 8', () => {
    const weather = makeWeather({
      daily: {
        time: ['2026-02-22'],
        weathercode: [0],
        temperature_2m_max: [75],
        temperature_2m_min: [55],
        wind_speed_10m_max: [3], // low wind
        precipitation_probability_max: [0],
      },
    });
    render(<DailyForecast weather={weather} />);
    // Wind badge should not render since wind <= 8
    expect(screen.queryByText('3')).toBeNull();
  });

  it('shows precipitation percentage when > 0', () => {
    render(<DailyForecast weather={makeWeather()} />);
    // Day index 2 has 60% precip probability
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('does not show precip badge when probability is 0', () => {
    const weather = makeWeather({
      daily: {
        time: ['2026-02-22'],
        weathercode: [0],
        temperature_2m_max: [75],
        temperature_2m_min: [55],
        wind_speed_10m_max: [3],
        precipitation_probability_max: [0],
      },
    });
    const { container } = render(<DailyForecast weather={weather} />);
    const precipBadges = container.querySelectorAll('.daily-forecast-precip-badge');
    expect(precipBadges.length).toBe(0);
  });

  it('renders temperature max and min values', () => {
    render(<DailyForecast weather={makeWeather()} />);
    // First day: max=75, min=55
    expect(screen.getByText('75°')).toBeInTheDocument();
    expect(screen.getByText('55°')).toBeInTheDocument();
  });

  it('rounds temperatures', () => {
    const weather = makeWeather({
      daily: {
        time: ['2026-02-22'],
        weathercode: [0],
        temperature_2m_max: [74.6],
        temperature_2m_min: [54.4],
        wind_speed_10m_max: [0],
        precipitation_probability_max: [0],
      },
    });
    render(<DailyForecast weather={weather} />);
    expect(screen.getByText('75°')).toBeInTheDocument();
    expect(screen.getByText('54°')).toBeInTheDocument();
  });

  it('handles empty daily arrays gracefully', () => {
    const weather = makeWeather({
      daily: {
        time: [],
        weathercode: [],
        temperature_2m_max: [],
        temperature_2m_min: [],
        wind_speed_10m_max: [],
        precipitation_probability_max: [],
      },
    });
    render(<DailyForecast weather={weather} />);
    expect(screen.getByText('16-Day Forecast')).toBeInTheDocument();
  });
});
