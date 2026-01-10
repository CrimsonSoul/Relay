import { secureStorage } from './secureStorage';
import { loggers, ErrorCategory } from './logger';

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
 * Loads column widths from secure storage with validation.
 */
export function loadColumnWidths<T extends ColumnWidths>(
  options: LoadColumnWidthsOptions<T>
): T {
  const { storageKey, defaults } = options;

  try {
    const parsed = secureStorage.getItemSync<unknown>(storageKey);
    if (!parsed || typeof parsed !== 'object') return defaults;

    // Filter to only include keys that exist in current schema
    const validKeys = Object.keys(defaults);
    const filtered: Partial<T> = {};

    for (const key of validKeys) {
      if (key in parsed && typeof parsed[key] === 'number') {
        (filtered as Record<string, number>)[key] = parsed[key];
      }
    }

    // Merge with defaults to ensure all required keys are present
    return { ...defaults, ...filtered };
  } catch (e: unknown) {
    loggers.storage.error(`Failed to load column widths from ${storageKey}`, {
      error: e.message,
      category: ErrorCategory.RENDERER
    });
    return defaults;
  }
}

/**
 * Saves column widths to secure storage.
 */
export function saveColumnWidths(
  storageKey: string,
  widths: ColumnWidths
): void {
  try {
    secureStorage.setItemSync(storageKey, widths);
  } catch (e: unknown) {
    loggers.storage.error(`Failed to save column widths to ${storageKey}`, {
      error: e.message,
      category: ErrorCategory.RENDERER
    });
  }
}

/**
 * Loads column order from secure storage with validation.
 */
export function loadColumnOrder<T extends string>(
  options: LoadColumnOrderOptions<T>
): T[] {
  const { storageKey, defaults } = options;

  try {
    const parsed = secureStorage.getItemSync<unknown>(storageKey);
    if (!Array.isArray(parsed)) return defaults;

    // Validate length matches
    if (parsed.length !== defaults.length) return defaults;

    // Validate all keys exist in current schema
    const validKeys = new Set(defaults);
    const isValid = parsed.every(key => validKeys.has(key));

    if (!isValid) return defaults;

    return parsed as T[];
  } catch (e: unknown) {
    loggers.storage.error(`Failed to load column order from ${storageKey}`, {
      error: e.message,
      category: ErrorCategory.RENDERER
    });
    return defaults;
  }
}

/**
 * Saves column order to secure storage.
 */
export function saveColumnOrder<T extends string>(
  storageKey: string,
  order: T[]
): void {
  try {
    secureStorage.setItemSync(storageKey, order);
  } catch (e: unknown) {
    loggers.storage.error(`Failed to save column order to ${storageKey}`, {
      error: e.message,
      category: ErrorCategory.RENDERER
    });
  }
}

/**
 * Clears column configuration from secure storage.
 */
export function clearColumnStorage(...storageKeys: string[]): void {
  try {
    storageKeys.forEach(key => secureStorage.removeItem(key));
  } catch (e: unknown) {
    loggers.storage.error('Failed to clear column storage', {
      error: e.message,
      category: ErrorCategory.RENDERER
    });
  }
}

