import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { getWeatherIcon } from '../WeatherIcons';

describe('getWeatherIcon', () => {
  it('returns a React element for all inputs', () => {
    const icon = getWeatherIcon(0);
    expect(icon).not.toBeNull();
  });

  it('renders clear sky for code 0', () => {
    const { container } = render(<>{getWeatherIcon(0)}</>);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('stroke')).toBe('#FDB813');
  });

  it('renders clear sky for code 1', () => {
    const { container } = render(<>{getWeatherIcon(1)}</>);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('stroke')).toBe('#FDB813');
  });

  it('renders partly cloudy for code 2', () => {
    const { container } = render(<>{getWeatherIcon(2)}</>);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // The outer SVG for partly cloudy uses currentColor stroke
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
  });

  it('renders overcast for code 3', () => {
    const { container } = render(<>{getWeatherIcon(3)}</>);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('stroke')).toBe('#A1A1AA');
    // No fog lines for code 3
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(0);
  });

  it('renders fog for code 45 with fog lines', () => {
    const { container } = render(<>{getWeatherIcon(45)}</>);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('renders fog for code 48 with fog lines', () => {
    const { container } = render(<>{getWeatherIcon(48)}</>);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('renders drizzle/rain for code 51', () => {
    const { container } = render(<>{getWeatherIcon(51)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('#67E8F9');
  });

  it('renders drizzle/rain for code 61', () => {
    const { container } = render(<>{getWeatherIcon(61)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('#67E8F9');
  });

  it('renders drizzle/rain for code 67', () => {
    const { container } = render(<>{getWeatherIcon(67)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('#67E8F9');
  });

  it('renders rain showers for code 80', () => {
    const { container } = render(<>{getWeatherIcon(80)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('#67E8F9');
  });

  it('renders rain showers for code 82', () => {
    const { container } = render(<>{getWeatherIcon(82)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('#67E8F9');
  });

  it('renders snow for code 71', () => {
    const { container } = render(<>{getWeatherIcon(71)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('#E5E7EB');
  });

  it('renders snow for code 77', () => {
    const { container } = render(<>{getWeatherIcon(77)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('#E5E7EB');
  });

  it('renders thunderstorm for code 95', () => {
    const { container } = render(<>{getWeatherIcon(95)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    // Thunderstorm has a lightning bolt path
    const paths = container.querySelectorAll('path');
    const hasLightning = Array.from(paths).some((p) => p.getAttribute('stroke') === '#FDE047');
    expect(hasLightning).toBe(true);
  });

  it('renders thunderstorm for code 99', () => {
    const { container } = render(<>{getWeatherIcon(99)}</>);
    const paths = container.querySelectorAll('path');
    const hasLightning = Array.from(paths).some((p) => p.getAttribute('stroke') === '#FDE047');
    expect(hasLightning).toBe(true);
  });

  it('renders default cloudy icon for unknown code', () => {
    // Use code 85 — above rain (82) and below thunderstorm (95), not in snow (71-77) range
    const { container } = render(<>{getWeatherIcon(85)}</>);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('stroke')).toBe('#A1A1AA');
  });

  it('renders default icon for code 4 (not handled explicitly)', () => {
    const { container } = render(<>{getWeatherIcon(4)}</>);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('respects custom size parameter', () => {
    const { container } = render(<>{getWeatherIcon(0, 32)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('height')).toBe('32');
  });

  it('uses default size of 24', () => {
    const { container } = render(<>{getWeatherIcon(3)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('renders snow for code 73', () => {
    const { container } = render(<>{getWeatherIcon(73)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('#E5E7EB');
  });

  it('renders snow for code 75', () => {
    const { container } = render(<>{getWeatherIcon(75)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('#E5E7EB');
  });

  it('renders rain for code 55', () => {
    const { container } = render(<>{getWeatherIcon(55)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('#67E8F9');
  });

  it('renders rain for code 63', () => {
    const { container } = render(<>{getWeatherIcon(63)}</>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('stroke')).toBe('#67E8F9');
  });
});
