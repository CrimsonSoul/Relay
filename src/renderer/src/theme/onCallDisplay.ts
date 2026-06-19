export const ON_CALL_DISPLAY_STORAGE_KEY = 'relay-oncall-display-size';
export const ON_CALL_FONT_SCALE_STORAGE_KEY = 'relay-oncall-font-scale';
export const ON_CALL_FONT_SCALE_MIN = 85;
export const ON_CALL_FONT_SCALE_MAX = 150;
export const ON_CALL_FONT_SCALE_STEP = 5;
export const DEFAULT_ON_CALL_FONT_SCALE = 100;

export const ON_CALL_DISPLAY_SIZES = [
  { id: 'compact', label: 'Compact' },
  { id: 'standard', label: 'Standard' },
  { id: 'wall', label: 'Wall' },
] as const;

export type OnCallDisplaySize = (typeof ON_CALL_DISPLAY_SIZES)[number]['id'];

export const DEFAULT_ON_CALL_DISPLAY_SIZE: OnCallDisplaySize = 'standard';

const isOnCallDisplaySize = (value: unknown): value is OnCallDisplaySize =>
  ON_CALL_DISPLAY_SIZES.some((option) => option.id === value);

const LEGACY_DISPLAY_SIZE_SCALE: Record<OnCallDisplaySize, number> = {
  compact: 90,
  standard: 100,
  wall: 125,
};

export function clampOnCallFontScale(value: unknown): number {
  let numericValue = Number.NaN;
  if (typeof value === 'number') {
    numericValue = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    numericValue = Number(value);
  }

  if (!Number.isFinite(numericValue)) return DEFAULT_ON_CALL_FONT_SCALE;

  const rounded = Math.round(numericValue / ON_CALL_FONT_SCALE_STEP) * ON_CALL_FONT_SCALE_STEP;
  return Math.min(ON_CALL_FONT_SCALE_MAX, Math.max(ON_CALL_FONT_SCALE_MIN, rounded));
}

export function getOnCallFontScaleFromStorageValue(value: unknown): number {
  return clampOnCallFontScale(value);
}

export function getStoredOnCallFontScale(): number {
  try {
    const storedScale = localStorage.getItem(ON_CALL_FONT_SCALE_STORAGE_KEY);
    if (storedScale !== null) {
      return getOnCallFontScaleFromStorageValue(storedScale);
    }

    const legacySize = localStorage.getItem(ON_CALL_DISPLAY_STORAGE_KEY);
    if (isOnCallDisplaySize(legacySize)) {
      return LEGACY_DISPLAY_SIZE_SCALE[legacySize];
    }

    return DEFAULT_ON_CALL_FONT_SCALE;
  } catch {
    return DEFAULT_ON_CALL_FONT_SCALE;
  }
}

export function setOnCallFontScale(scale: number): void {
  try {
    localStorage.setItem(ON_CALL_FONT_SCALE_STORAGE_KEY, String(clampOnCallFontScale(scale)));
  } catch {
    // Persistence is best-effort; the active window still updates its state.
  }
}

export function getOnCallBoardColumnMinWidth(scale: number): number {
  return Math.round(320 * Math.max(1, clampOnCallFontScale(scale) / 100));
}

export function getStoredOnCallDisplaySize(): OnCallDisplaySize {
  try {
    const stored = localStorage.getItem(ON_CALL_DISPLAY_STORAGE_KEY);
    return isOnCallDisplaySize(stored) ? stored : DEFAULT_ON_CALL_DISPLAY_SIZE;
  } catch {
    return DEFAULT_ON_CALL_DISPLAY_SIZE;
  }
}

export function setOnCallDisplaySize(size: OnCallDisplaySize): void {
  try {
    localStorage.setItem(ON_CALL_DISPLAY_STORAGE_KEY, size);
  } catch {
    // Persistence is best-effort; the active window still updates its state.
  }
}

export function getOnCallDisplaySizeFromStorageValue(value: unknown): OnCallDisplaySize {
  return isOnCallDisplaySize(value) ? value : DEFAULT_ON_CALL_DISPLAY_SIZE;
}
