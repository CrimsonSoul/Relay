import { describe, it, expect } from 'vitest';
import { isValidCoordinate } from './validation';

describe('isValidCoordinate', () => {
  it('accepts valid coordinates', () => {
    expect(isValidCoordinate(40.7128, -74.006)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
  });

  it('accepts string numbers', () => {
    expect(isValidCoordinate('40.7128', '-74.006')).toBe(true);
  });

  it('rejects out-of-range latitude', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(-91, 0)).toBe(false);
  });

  it('rejects out-of-range longitude', () => {
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(0, -181)).toBe(false);
  });

  it('rejects NaN values', () => {
    expect(isValidCoordinate(NaN, 0)).toBe(false);
    expect(isValidCoordinate(0, NaN)).toBe(false);
    expect(isValidCoordinate('abc', '0')).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(isValidCoordinate(null, 0)).toBe(false);
    expect(isValidCoordinate(0, undefined)).toBe(false);
  });
});
