export type AccentId = 'red' | 'orange' | 'blue' | 'green' | 'pink' | 'purple';

export interface AccentScheme {
  id: AccentId;
  label: string;
  /** Base accent color — used for picker swatches. */
  swatch: string;
}

export const ACCENT_STORAGE_KEY = 'relay-accent';
export const DEFAULT_ACCENT: AccentId = 'red';

export const ACCENT_SCHEMES: AccentScheme[] = [
  { id: 'red', label: 'Signal Red', swatch: '#e63946' },
  { id: 'orange', label: 'Orange', swatch: '#f97316' },
  { id: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { id: 'green', label: 'Green', swatch: '#22c55e' },
  { id: 'pink', label: 'Pink', swatch: '#ec4899' },
  { id: 'purple', label: 'Purple', swatch: '#a855f7' },
];

const isAccentId = (value: unknown): value is AccentId =>
  ACCENT_SCHEMES.some((s) => s.id === value);

export function getStoredAccent(): AccentId {
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
    return isAccentId(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

function apply(id: AccentId): void {
  document.documentElement.setAttribute('data-accent', id);
}

/** Set, persist, and apply an accent scheme. */
export function setAccent(id: AccentId): void {
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, id);
  } catch {
    // Persistence is best-effort; still apply for this window.
  }
  apply(id);
}

/**
 * Apply the stored scheme and follow changes made in other windows
 * (the kiosk pop-out shares localStorage with the main window).
 */
let initialized = false;

export function initAccent(): void {
  apply(getStoredAccent());
  if (initialized) return;
  initialized = true;
  window.addEventListener('storage', (e) => {
    if (e.key === ACCENT_STORAGE_KEY) {
      apply(isAccentId(e.newValue) ? e.newValue : DEFAULT_ACCENT);
    }
  });
}
