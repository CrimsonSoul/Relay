/**
 * Utilities for persisting and loading column configuration from localStorage
 * with validation to handle schema changes gracefully.
 */

export type ColumnWidths = Record<string, number>;
export type ColumnOrder<T extends string = string> = T[];

interface LoadColumnWidthsOptions<T extends ColumnWidths> {
  storageKey: string;
  defaults: T;
}

interface LoadColumnOrderOptions<T extends string> {
  storageKey: string;
  defaults: T[];
}

/**
 * Loads column widths from localStorage with validation.
 *
 * Filters out any keys that don't exist in the current schema (defaults),
 * preventing issues when column identifiers are renamed or removed.
 *
 * @param options - Storage key and default widths configuration
 * @returns Validated column widths, falling back to defaults if invalid
 *
 * @example
 * const widths = loadColumnWidths({
 *   storageKey: 'relay-servers-columns',
 *   defaults: DEFAULT_WIDTHS
 * });
 */
export function loadColumnWidths<T extends ColumnWidths>(
  options: LoadColumnWidthsOptions<T>
): T {
  const { storageKey, defaults } = options;

  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return defaults;

    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') return defaults;

    // Filter to only include keys that exist in current schema
    const validKeys = Object.keys(defaults);
    const filtered: Partial<T> = {};

    for (const key of validKeys) {
      if (key in parsed && typeof parsed[key] === 'number') {
        (filtered as any)[key] = parsed[key];
      }
    }

    // Merge with defaults to ensure all required keys are present
    return { ...defaults, ...filtered };
  } catch (e) {
    console.warn(`Failed to load column widths from ${storageKey}:`, e);
    return defaults;
  }
}

/**
 * Saves column widths to localStorage.
 *
 * @param storageKey - The localStorage key to use
 * @param widths - The column widths to save
 */
export function saveColumnWidths(
  storageKey: string,
  widths: ColumnWidths
): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(widths));
  } catch (e) {
    console.warn(`Failed to save column widths to ${storageKey}:`, e);
  }
}

/**
 * Loads column order from localStorage with validation.
 *
 * Validates that:
 * - The saved value is an array
 * - It has the same length as defaults
 * - All keys exist in the current schema
 *
 * Falls back to defaults if validation fails.
 *
 * @param options - Storage key and default column order
 * @returns Validated column order, falling back to defaults if invalid
 *
 * @example
 * const order = loadColumnOrder({
 *   storageKey: 'relay-servers-order',
 *   defaults: DEFAULT_ORDER
 * });
 */
export function loadColumnOrder<T extends string>(
  options: LoadColumnOrderOptions<T>
): T[] {
  const { storageKey, defaults } = options;

  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return defaults;

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return defaults;

    // Validate length matches
    if (parsed.length !== defaults.length) return defaults;

    // Validate all keys exist in current schema
    const validKeys = new Set(defaults);
    const isValid = parsed.every(key => validKeys.has(key));

    if (!isValid) return defaults;

    return parsed as T[];
  } catch (e) {
    console.warn(`Failed to load column order from ${storageKey}:`, e);
    return defaults;
  }
}

/**
 * Saves column order to localStorage.
 *
 * @param storageKey - The localStorage key to use
 * @param order - The column order to save
 */
export function saveColumnOrder<T extends string>(
  storageKey: string,
  order: T[]
): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(order));
  } catch (e) {
    console.warn(`Failed to save column order to ${storageKey}:`, e);
  }
}

/**
 * Clears column configuration from localStorage.
 * Useful for migrations or resetting to defaults.
 *
 * @param storageKeys - One or more localStorage keys to clear
 */
export function clearColumnStorage(...storageKeys: string[]): void {
  try {
    storageKeys.forEach(key => localStorage.removeItem(key));
  } catch (e) {
    console.warn('Failed to clear column storage:', e);
  }
}
