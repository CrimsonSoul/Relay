/**
 * Utility functions for column sizing and scaling
 */

export type ColumnWidths = Record<string, number>;

export interface ScaleColumnsOptions {
  baseWidths: ColumnWidths;
  availableWidth: number;
  minColumnWidth?: number;
  reservedSpace?: number;
}

/**
 * Scales column widths proportionally to fit available space while respecting minimum widths.
 *
 * @param options - Scaling configuration
 * @returns Scaled column widths that fit exactly in available space
 */
export function scaleColumns(options: ScaleColumnsOptions): ColumnWidths {
  const {
    baseWidths,
    availableWidth,
    minColumnWidth = 50,
    reservedSpace = 0
  } = options;

  const keys = Object.keys(baseWidths);

  // No space available - return minimum widths
  if (availableWidth <= reservedSpace) {
    const minWidths: ColumnWidths = {};
    keys.forEach(key => {
      minWidths[key] = minColumnWidth;
    });
    return minWidths;
  }

  const totalBaseWidth = Object.values(baseWidths).reduce((sum, width) => sum + width, 0);
  const effectiveSpace = availableWidth - reservedSpace;

  // Not enough space even for minimums
  const minTotalWidth = keys.length * minColumnWidth;
  if (effectiveSpace < minTotalWidth) {
    const minWidths: ColumnWidths = {};
    keys.forEach(key => {
      minWidths[key] = minColumnWidth;
    });
    return minWidths;
  }

  // Calculate initial scale
  const scale = effectiveSpace / totalBaseWidth;

  // Scale all columns
  const scaledWidths: ColumnWidths = {};
  let belowMinCount = 0;
  let belowMinTotal = 0;

  // First pass: scale and identify columns below minimum
  keys.forEach(key => {
    const scaled = baseWidths[key] * scale;
    if (scaled < minColumnWidth) {
      scaledWidths[key] = minColumnWidth;
      belowMinCount++;
      belowMinTotal += minColumnWidth;
    } else {
      scaledWidths[key] = scaled;
    }
  });

  // If some columns hit minimum, redistribute remaining space to other columns
  if (belowMinCount > 0 && belowMinCount < keys.length) {
    const remainingSpace = effectiveSpace - belowMinTotal;
    const remainingKeys = keys.filter(key => scaledWidths[key] > minColumnWidth);
    const remainingBaseTotal = remainingKeys.reduce((sum, key) => sum + baseWidths[key], 0);

    if (remainingBaseTotal > 0) {
      const adjustedScale = remainingSpace / remainingBaseTotal;

      remainingKeys.forEach(key => {
        scaledWidths[key] = Math.max(minColumnWidth, baseWidths[key] * adjustedScale);
      });
    }
  }

  // Final pass: floor all values and distribute rounding error
  let flooredTotal = 0;
  const floored: ColumnWidths = {};
  const fractionalParts: { key: string; fraction: number }[] = [];

  keys.forEach(key => {
    const floorValue = Math.floor(scaledWidths[key]);
    floored[key] = floorValue;
    flooredTotal += floorValue;
    fractionalParts.push({
      key,
      fraction: scaledWidths[key] - floorValue
    });
  });

  // Distribute remaining pixels to columns with largest fractional parts
  const pixelsToDistribute = effectiveSpace - flooredTotal;
  if (pixelsToDistribute > 0) {
    fractionalParts
      .sort((a, b) => b.fraction - a.fraction)
      .slice(0, Math.floor(pixelsToDistribute))
      .forEach(({ key }) => {
        floored[key] += 1;
      });
  }

  return floored;
}

/**
 * Reverses scaling to get the base width from a scaled width.
 * Used when user manually resizes a column.
 */
export function reverseScale(
  scaledWidth: number,
  availableWidth: number,
  totalBaseWidth: number,
  reservedSpace: number = 0
): number {
  const effectiveSpace = availableWidth - reservedSpace;
  if (effectiveSpace <= 0 || totalBaseWidth <= 0) {
    return scaledWidth;
  }

  const scale = effectiveSpace / totalBaseWidth;
  if (scale <= 0) {
    return scaledWidth;
  }

  return scaledWidth / scale;
}

/**
 * Validates column widths configuration
 */
export function validateColumnWidths(
  widths: ColumnWidths,
  expectedKeys: string[]
): ColumnWidths | null {
  if (!widths || typeof widths !== 'object') return null;

  const keys = Object.keys(widths);
  if (keys.length !== expectedKeys.length) return null;

  // Check all expected keys are present
  for (const key of expectedKeys) {
    if (!(key in widths)) return null;
    if (typeof widths[key] !== 'number' || widths[key] < 0) return null;
  }

  return widths;
}
