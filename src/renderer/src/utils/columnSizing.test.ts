import { describe, it, expect } from 'vitest';
import { scaleColumns, reverseScale, validateColumnWidths } from './columnSizing';

describe('scaleColumns', () => {
  const baseWidths = {
    name: 200,
    email: 150,
    phone: 100
  };

  it('scales columns proportionally when space is available', () => {
    const result = scaleColumns({
      baseWidths,
      availableWidth: 900, // 2x the base total of 450
      reservedSpace: 0
    });

    expect(result.name).toBe(400);
    expect(result.email).toBe(300);
    expect(result.phone).toBe(200);
  });

  it('scales columns down when space is limited', () => {
    const result = scaleColumns({
      baseWidths,
      availableWidth: 225, // 0.5x the base total of 450
      reservedSpace: 0
    });

    expect(result.name).toBe(100);
    expect(result.email).toBe(75);
    expect(result.phone).toBe(50);
  });

  it('respects minimum column width', () => {
    const result = scaleColumns({
      baseWidths,
      availableWidth: 120, // Very narrow
      minColumnWidth: 50,
      reservedSpace: 0
    });

    // All columns should be at least 50px
    expect(result.name).toBeGreaterThanOrEqual(50);
    expect(result.email).toBeGreaterThanOrEqual(50);
    expect(result.phone).toBeGreaterThanOrEqual(50);
  });

  it('handles zero available width gracefully', () => {
    const result = scaleColumns({
      baseWidths,
      availableWidth: 0,
      minColumnWidth: 50,
      reservedSpace: 0
    });

    // Should return minimum widths
    expect(result.name).toBe(50);
    expect(result.email).toBe(50);
    expect(result.phone).toBe(50);
  });

  it('handles negative available width gracefully', () => {
    const result = scaleColumns({
      baseWidths,
      availableWidth: -100,
      minColumnWidth: 50,
      reservedSpace: 0
    });

    // Should return minimum widths
    expect(result.name).toBe(50);
    expect(result.email).toBe(50);
    expect(result.phone).toBe(50);
  });

  it('accounts for reserved space correctly', () => {
    const result = scaleColumns({
      baseWidths,
      availableWidth: 900,
      reservedSpace: 450, // Half the space is reserved
      minColumnWidth: 50
    });

    // Effective space is 450, same as base total, so scale should be 1:1
    const total = result.name + result.email + result.phone;
    expect(total).toBeLessThanOrEqual(450);
    expect(total).toBeGreaterThan(440); // Allow for rounding
  });

  it('distributes rounding errors evenly', () => {
    const result = scaleColumns({
      baseWidths: { a: 100, b: 100, c: 100 },
      availableWidth: 302, // Not evenly divisible
      reservedSpace: 0
    });

    const total = result.a + result.b + result.c;
    // Total should equal available width exactly
    expect(total).toBe(302);
  });

  it('handles single column', () => {
    const result = scaleColumns({
      baseWidths: { name: 200 },
      availableWidth: 500,
      reservedSpace: 0
    });

    expect(result.name).toBe(500);
  });

  it('redistributes space when some columns hit minimum', () => {
    const result = scaleColumns({
      baseWidths: { tiny: 10, large: 400 },
      availableWidth: 300,
      minColumnWidth: 50,
      reservedSpace: 0
    });

    // tiny column should be at minimum
    expect(result.tiny).toBe(50);
    // large column should get most of the remaining space
    expect(result.large).toBeGreaterThan(200);
    expect(result.tiny + result.large).toBe(300);
  });

  it('handles very narrow windows', () => {
    const result = scaleColumns({
      baseWidths,
      availableWidth: 100,
      minColumnWidth: 30,
      reservedSpace: 0
    });

    // Each column should be at least minColumnWidth
    expect(result.name).toBeGreaterThanOrEqual(30);
    expect(result.email).toBeGreaterThanOrEqual(30);
    expect(result.phone).toBeGreaterThanOrEqual(30);
  });
});

describe('reverseScale', () => {
  it('correctly reverses scaling', () => {
    const totalBaseWidth = 450;
    const availableWidth = 900;
    const scaledWidth = 400; // 2x scale

    const baseWidth = reverseScale(scaledWidth, availableWidth, totalBaseWidth);

    expect(baseWidth).toBe(200);
  });

  it('handles zero available width', () => {
    const result = reverseScale(100, 0, 450);

    // Should return original scaled width
    expect(result).toBe(100);
  });

  it('handles zero total base width', () => {
    const result = reverseScale(100, 900, 0);

    expect(result).toBe(100);
  });

  it('accounts for reserved space', () => {
    const totalBaseWidth = 450;
    const availableWidth = 900;
    const reservedSpace = 450;
    const scaledWidth = 200; // Should reverse to original

    const baseWidth = reverseScale(scaledWidth, availableWidth, totalBaseWidth, reservedSpace);

    expect(baseWidth).toBe(200);
  });
});

describe('validateColumnWidths', () => {
  it('validates correct column widths', () => {
    const widths = { name: 200, email: 150, phone: 100 };
    const keys = ['name', 'email', 'phone'];

    const result = validateColumnWidths(widths, keys);

    expect(result).toEqual(widths);
  });

  it('rejects widths with missing keys', () => {
    const widths = { name: 200, email: 150 };
    const keys = ['name', 'email', 'phone'];

    const result = validateColumnWidths(widths, keys);

    expect(result).toBeNull();
  });

  it('rejects widths with extra keys', () => {
    const widths = { name: 200, email: 150, phone: 100, extra: 50 };
    const keys = ['name', 'email', 'phone'];

    const result = validateColumnWidths(widths, keys);

    expect(result).toBeNull();
  });

  it('rejects widths with negative values', () => {
    const widths = { name: 200, email: -150, phone: 100 };
    const keys = ['name', 'email', 'phone'];

    const result = validateColumnWidths(widths, keys);

    expect(result).toBeNull();
  });

  it('rejects widths with non-number values', () => {
    const widths = { name: 200, email: '150', phone: 100 } as unknown as Record<string, number>;
    const keys = ['name', 'email', 'phone'];

    const result = validateColumnWidths(widths, keys);

    expect(result).toBeNull();
  });

  it('rejects null widths', () => {
    const result = validateColumnWidths(null as unknown as Record<string, number>, ['name']);

    expect(result).toBeNull();
  });

  it('rejects undefined widths', () => {
    const result = validateColumnWidths(undefined as unknown as Record<string, number>, ['name']);

    expect(result).toBeNull();
  });
});
