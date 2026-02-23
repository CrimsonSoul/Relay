import { describe, it, expect } from 'vitest';
import {
  getRadarUrl,
  getWeatherDescription,
  getWeatherOffsetMs,
  RADAR_INJECT_CSS,
  RADAR_INJECT_JS,
  SEVERITY_COLORS,
} from '../utils';

describe('weather/utils', () => {
  describe('getRadarUrl', () => {
    it('returns a URL with lat/lon formatted to 4 decimal places', () => {
      const url = getRadarUrl(37.7749, -122.4194);
      expect(url).toContain('37.7749');
      expect(url).toContain('-122.4194');
    });

    it('returns empty string for NaN lat', () => {
      expect(getRadarUrl(Number.NaN, -122)).toBe('');
    });

    it('returns empty string for NaN lon', () => {
      expect(getRadarUrl(37.77, Number.NaN)).toBe('');
    });

    it('returns empty string when both are NaN', () => {
      expect(getRadarUrl(Number.NaN, Number.NaN)).toBe('');
    });

    it('includes rainviewer domain', () => {
      const url = getRadarUrl(0, 0);
      expect(url).toContain('rainviewer.com');
    });

    it('truncates long decimals to 4 places', () => {
      const url = getRadarUrl(37.123456789, -122.987654321);
      expect(url).toContain('37.1235');
      expect(url).toContain('-122.9877');
    });
  });

  describe('getWeatherDescription', () => {
    it('returns "Clear Sky" for code 0', () => {
      expect(getWeatherDescription(0)).toBe('Clear Sky');
    });

    it('returns "Mainly Clear" for code 1', () => {
      expect(getWeatherDescription(1)).toBe('Mainly Clear');
    });

    it('returns "Partly Cloudy" for code 2', () => {
      expect(getWeatherDescription(2)).toBe('Partly Cloudy');
    });

    it('returns "Overcast" for code 3', () => {
      expect(getWeatherDescription(3)).toBe('Overcast');
    });

    it('returns "Foggy" for codes 45 and 48', () => {
      expect(getWeatherDescription(45)).toBe('Foggy');
      expect(getWeatherDescription(48)).toBe('Foggy');
    });

    it('returns "Drizzle" for codes 51, 53, 55', () => {
      expect(getWeatherDescription(51)).toBe('Drizzle');
      expect(getWeatherDescription(53)).toBe('Drizzle');
      expect(getWeatherDescription(55)).toBe('Drizzle');
    });

    it('returns "Rainy" for codes 61, 63, 65', () => {
      expect(getWeatherDescription(61)).toBe('Rainy');
      expect(getWeatherDescription(63)).toBe('Rainy');
      expect(getWeatherDescription(65)).toBe('Rainy');
    });

    it('returns "Freezing Rain" for codes 66, 67', () => {
      expect(getWeatherDescription(66)).toBe('Freezing Rain');
      expect(getWeatherDescription(67)).toBe('Freezing Rain');
    });

    it('returns "Snowy" for codes 71, 73, 75', () => {
      expect(getWeatherDescription(71)).toBe('Snowy');
      expect(getWeatherDescription(73)).toBe('Snowy');
      expect(getWeatherDescription(75)).toBe('Snowy');
    });

    it('returns "Snow Grains" for code 77', () => {
      expect(getWeatherDescription(77)).toBe('Snow Grains');
    });

    it('returns "Rain Showers" for codes 80, 81, 82', () => {
      expect(getWeatherDescription(80)).toBe('Rain Showers');
      expect(getWeatherDescription(81)).toBe('Rain Showers');
      expect(getWeatherDescription(82)).toBe('Rain Showers');
    });

    it('returns "Snow Showers" for codes 85, 86', () => {
      expect(getWeatherDescription(85)).toBe('Snow Showers');
      expect(getWeatherDescription(86)).toBe('Snow Showers');
    });

    it('returns "Thunderstorm" for code 95', () => {
      expect(getWeatherDescription(95)).toBe('Thunderstorm');
    });

    it('returns "Cloudy" for unknown codes', () => {
      expect(getWeatherDescription(999)).toBe('Cloudy');
      expect(getWeatherDescription(-1)).toBe('Cloudy');
    });
  });

  describe('getWeatherOffsetMs', () => {
    it('returns 0 when no weather provided', () => {
      expect(getWeatherOffsetMs()).toBe(0);
    });

    it('returns utc_offset_seconds * 1000 when provided', () => {
      expect(getWeatherOffsetMs({ utc_offset_seconds: 3600 })).toBe(3_600_000);
      expect(getWeatherOffsetMs({ utc_offset_seconds: -18000 })).toBe(-18_000_000);
    });

    it('returns 0 for utc_offset_seconds of 0', () => {
      expect(getWeatherOffsetMs({ utc_offset_seconds: 0 })).toBe(0);
    });

    it('returns a numeric offset for a valid timezone string', () => {
      const result = getWeatherOffsetMs({ timezone: 'America/New_York' });
      expect(typeof result).toBe('number');
      // Could be any number (negative or positive), but should be finite
      expect(Number.isFinite(result)).toBe(true);
    });

    it('returns 0 for an invalid timezone string', () => {
      expect(getWeatherOffsetMs({ timezone: 'Invalid/Zone' })).toBe(0);
    });

    it('returns 0 when neither utc_offset_seconds nor timezone is present', () => {
      expect(getWeatherOffsetMs({})).toBe(0);
    });

    it('prefers utc_offset_seconds over timezone', () => {
      const result = getWeatherOffsetMs({
        utc_offset_seconds: 7200,
        timezone: 'America/New_York',
      });
      expect(result).toBe(7_200_000);
    });
  });

  describe('constants', () => {
    it('RADAR_INJECT_CSS is a non-empty string', () => {
      expect(typeof RADAR_INJECT_CSS).toBe('string');
      expect(RADAR_INJECT_CSS.length).toBeGreaterThan(0);
    });

    it('RADAR_INJECT_JS is a non-empty string', () => {
      expect(typeof RADAR_INJECT_JS).toBe('string');
      expect(RADAR_INJECT_JS.length).toBeGreaterThan(0);
    });

    it('SEVERITY_COLORS has all expected severity levels', () => {
      expect(SEVERITY_COLORS).toHaveProperty('Extreme');
      expect(SEVERITY_COLORS).toHaveProperty('Severe');
      expect(SEVERITY_COLORS).toHaveProperty('Moderate');
      expect(SEVERITY_COLORS).toHaveProperty('Minor');
      expect(SEVERITY_COLORS).toHaveProperty('Unknown');
    });

    it('each severity level has bg, border, text, icon properties', () => {
      for (const key of Object.keys(SEVERITY_COLORS)) {
        expect(SEVERITY_COLORS[key]).toHaveProperty('bg');
        expect(SEVERITY_COLORS[key]).toHaveProperty('border');
        expect(SEVERITY_COLORS[key]).toHaveProperty('text');
        expect(SEVERITY_COLORS[key]).toHaveProperty('icon');
      }
    });
  });
});
