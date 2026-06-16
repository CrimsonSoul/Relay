export const ON_CALL_DISPLAY_STORAGE_KEY = 'relay-oncall-display-size';

export const ON_CALL_DISPLAY_SIZES = [
  { id: 'compact', label: 'Compact' },
  { id: 'standard', label: 'Standard' },
  { id: 'wall', label: 'Wall' },
] as const;

export type OnCallDisplaySize = (typeof ON_CALL_DISPLAY_SIZES)[number]['id'];

export const DEFAULT_ON_CALL_DISPLAY_SIZE: OnCallDisplaySize = 'standard';

const isOnCallDisplaySize = (value: unknown): value is OnCallDisplaySize =>
  ON_CALL_DISPLAY_SIZES.some((option) => option.id === value);

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
