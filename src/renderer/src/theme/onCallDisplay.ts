const LEGACY_DISPLAY_SIZE_STORAGE_KEY = 'relay-oncall-display-size';
export const ON_CALL_FONT_SCALE_STORAGE_KEY = 'relay-oncall-font-scale';
export const ON_CALL_FONT_SCALE_MIN = 85;
export const ON_CALL_FONT_SCALE_MAX = 150;
export const ON_CALL_FONT_SCALE_STEP = 5;
export const DEFAULT_ON_CALL_FONT_SCALE = 100;

const LEGACY_DISPLAY_SIZE_SCALE = {
  compact: 90,
  standard: 100,
  wall: 125,
} as const;

type LegacyDisplaySize = keyof typeof LEGACY_DISPLAY_SIZE_SCALE;

const isLegacyDisplaySize = (value: unknown): value is LegacyDisplaySize =>
  typeof value === 'string' && value in LEGACY_DISPLAY_SIZE_SCALE;

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

export function getStoredOnCallFontScale(): number {
  try {
    const storedScale = localStorage.getItem(ON_CALL_FONT_SCALE_STORAGE_KEY);
    if (storedScale !== null) {
      return clampOnCallFontScale(storedScale);
    }

    const legacySize = localStorage.getItem(LEGACY_DISPLAY_SIZE_STORAGE_KEY);
    if (isLegacyDisplaySize(legacySize)) {
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
