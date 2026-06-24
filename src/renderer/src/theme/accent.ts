export type PresetAccentId =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'blue'
  | 'cyan'
  | 'green'
  | 'lime'
  | 'pink'
  | 'purple'
  | 'violet';

export type AccentId = PresetAccentId | 'custom';
export type AccentScheduleSlotId = 'day' | 'swing' | 'night';
export type AccentScheduleChoice = PresetAccentId | `custom:${string}`;

export type AccentSchedule = {
  enabled: boolean;
  slots: Record<AccentScheduleSlotId, AccentScheduleChoice>;
};

export interface AccentScheduleSlot {
  id: AccentScheduleSlotId;
  label: string;
  rangeLabel: string;
  startMinutes: number;
  endMinutes: number;
}

export interface AccentScheme {
  id: PresetAccentId;
  label: string;
  /** Base accent color — used for picker swatches. */
  swatch: string;
}

export const ACCENT_STORAGE_KEY = 'relay-accent';
export const CUSTOM_ACCENT_STORAGE_KEY = 'relay-custom-accent';
export const CUSTOM_ACCENTS_STORAGE_KEY = 'relay-custom-accents';
export const ACCENT_SCHEDULE_STORAGE_KEY = 'relay-accent-schedule';
export const DEFAULT_ACCENT: PresetAccentId = 'red';
export const MAX_CUSTOM_ACCENTS = 4;

export const ACCENT_SCHEMES: AccentScheme[] = [
  { id: 'red', label: 'Signal Red', swatch: '#e63946' },
  { id: 'orange', label: 'Orange', swatch: '#f97316' },
  { id: 'yellow', label: 'Yellow', swatch: '#facc15' },
  { id: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { id: 'cyan', label: 'Cyan', swatch: '#06b6d4' },
  { id: 'green', label: 'Green', swatch: '#22c55e' },
  { id: 'lime', label: 'Lime', swatch: '#84cc16' },
  { id: 'pink', label: 'Pink', swatch: '#fc8da9' },
  { id: 'purple', label: 'Purple', swatch: '#a855f7' },
  { id: 'violet', label: 'Violet', swatch: '#8b5cf6' },
];

export const ACCENT_SCHEDULE_SLOTS: AccentScheduleSlot[] = [
  {
    id: 'day',
    label: 'Day',
    rangeLabel: '6 AM-2 PM CT',
    startMinutes: 6 * 60,
    endMinutes: 14 * 60,
  },
  {
    id: 'swing',
    label: 'Swing',
    rangeLabel: '2 PM-10 PM CT',
    startMinutes: 14 * 60,
    endMinutes: 22 * 60,
  },
  {
    id: 'night',
    label: 'Night',
    rangeLabel: '10 PM-6 AM CT',
    startMinutes: 22 * 60,
    endMinutes: 6 * 60,
  },
];

export const DEFAULT_ACCENT_SCHEDULE: AccentSchedule = {
  enabled: false,
  slots: {
    day: 'red',
    swing: 'yellow',
    night: 'blue',
  },
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const CUSTOM_ACCENT_PROPERTIES = ['--accent', '--accent-hover', '--accent-bright', '--on-accent'];
const CENTRAL_TIME_ZONE = 'America/Chicago';
const CUSTOM_CHOICE_PREFIX = 'custom:';
const SCHEDULE_BOUNDARY_MINUTES = [6 * 60, 14 * 60, 22 * 60];

const isPresetAccentId = (value: unknown): value is PresetAccentId =>
  ACCENT_SCHEMES.some((s) => s.id === value);

function accentFromStoredValue(value: unknown): AccentId {
  if (value === 'custom' && getStoredCustomAccent()) return 'custom';
  return isPresetAccentId(value) ? value : DEFAULT_ACCENT;
}

export function normalizeHexAccent(value: string): string | null {
  const normalized = value.trim().replace(/^#/, '').toLowerCase();
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/.test(normalized)) return null;
  if (normalized.length === 3) {
    const [r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return `#${normalized}`;
}

function defaultAccentSchedule(): AccentSchedule {
  return {
    enabled: DEFAULT_ACCENT_SCHEDULE.enabled,
    slots: { ...DEFAULT_ACCENT_SCHEDULE.slots },
  };
}

function normalizeAccentScheduleChoice(value: unknown): AccentScheduleChoice | null {
  if (isPresetAccentId(value)) return value;
  if (typeof value !== 'string' || !value.startsWith(CUSTOM_CHOICE_PREFIX)) return null;
  const normalized = normalizeHexAccent(value.slice(CUSTOM_CHOICE_PREFIX.length));
  return normalized ? `custom:${normalized}` : null;
}

function centralTimeMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function isMinuteInScheduleSlot(minutes: number, slot: AccentScheduleSlot): boolean {
  if (slot.startMinutes < slot.endMinutes) {
    return minutes >= slot.startMinutes && minutes < slot.endMinutes;
  }
  return minutes >= slot.startMinutes || minutes < slot.endMinutes;
}

export function getCurrentAccentScheduleSlot(date = new Date()): AccentScheduleSlot {
  const minutes = centralTimeMinutes(date);
  return (
    ACCENT_SCHEDULE_SLOTS.find((slot) => isMinuteInScheduleSlot(minutes, slot)) ??
    ACCENT_SCHEDULE_SLOTS[0]
  );
}

function minutesUntilNextScheduleBoundary(date = new Date()): number {
  const minutes = centralTimeMinutes(date);
  const next = SCHEDULE_BOUNDARY_MINUTES.find((boundary) => boundary > minutes);
  return (next ?? SCHEDULE_BOUNDARY_MINUTES[0] + 24 * 60) - minutes;
}

function hexToRgb(hex: string): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const channelToHex = (channel: number) => Math.round(channel).toString(16).padStart(2, '0');
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const toLinear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(first: Rgb, second: Rgb): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function readableOnAccent(hex: string): '#000000' | '#ffffff' {
  const accent = hexToRgb(hex);
  const black = hexToRgb('#000000');
  const white = hexToRgb('#ffffff');
  return contrastRatio(accent, black) >= contrastRatio(accent, white) ? '#000000' : '#ffffff';
}

function liftForDarkSurface(hex: string): string {
  const surface = hexToRgb('#09090b');
  const white = hexToRgb('#ffffff');
  const accent = hexToRgb(hex);
  if (contrastRatio(accent, surface) >= 4.5) return hex;

  for (let amount = 0.1; amount <= 1; amount += 0.05) {
    const lifted = mixRgb(accent, white, amount);
    if (contrastRatio(lifted, surface) >= 4.5) return rgbToHex(lifted);
  }
  return '#ffffff';
}

function createCustomAccentTokens(hex: string) {
  const accent = hexToRgb(hex);
  const white = hexToRgb('#ffffff');
  return {
    accent: hex,
    hover: rgbToHex(mixRgb(accent, white, 0.16)),
    bright: liftForDarkSurface(rgbToHex(mixRgb(accent, white, 0.32))),
    onAccent: readableOnAccent(hex),
  };
}

function clearCustomAccentProperties(): void {
  CUSTOM_ACCENT_PROPERTIES.forEach((property) => {
    document.documentElement.style.removeProperty(property);
  });
}

function applyCustomAccent(hex: string): void {
  const tokens = createCustomAccentTokens(hex);
  document.documentElement.style.setProperty('--accent', tokens.accent);
  document.documentElement.style.setProperty('--accent-hover', tokens.hover);
  document.documentElement.style.setProperty('--accent-bright', tokens.bright);
  document.documentElement.style.setProperty('--on-accent', tokens.onAccent);
  document.documentElement.setAttribute('data-accent', 'custom');
}

function applyAccentScheduleChoice(choice: AccentScheduleChoice): void {
  if (choice.startsWith(CUSTOM_CHOICE_PREFIX)) {
    setCustomAccent(choice.slice(CUSTOM_CHOICE_PREFIX.length));
    return;
  }
  setAccent(choice);
}

export function getStoredCustomAccent(): string | null {
  try {
    const stored = localStorage.getItem(CUSTOM_ACCENT_STORAGE_KEY);
    return stored ? normalizeHexAccent(stored) : null;
  } catch {
    return null;
  }
}

function uniqueNormalizedCustomAccents(values: unknown[]): string[] {
  const normalized: string[] = [];
  values.forEach((value) => {
    if (typeof value !== 'string') return;
    const hex = normalizeHexAccent(value);
    if (hex && !normalized.includes(hex)) normalized.push(hex);
  });
  return normalized.slice(-MAX_CUSTOM_ACCENTS);
}

export function getStoredCustomAccents(): string[] {
  try {
    const stored = localStorage.getItem(CUSTOM_ACCENTS_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const normalized = uniqueNormalizedCustomAccents(parsed);
        if (normalized.length > 0) return normalized;
      }
    }
  } catch {
    // Invalid saved palette falls through to legacy migration.
  }

  const legacyCustomAccent = getStoredCustomAccent();
  return legacyCustomAccent ? [legacyCustomAccent] : [];
}

function saveCustomAccents(values: string[]): void {
  if (values.length === 0) {
    localStorage.removeItem(CUSTOM_ACCENTS_STORAGE_KEY);
    return;
  }
  localStorage.setItem(CUSTOM_ACCENTS_STORAGE_KEY, JSON.stringify(values));
}

function selectCustomAccent(hex: string): void {
  localStorage.setItem(CUSTOM_ACCENT_STORAGE_KEY, hex);
  localStorage.setItem(ACCENT_STORAGE_KEY, 'custom');
  applyCustomAccent(hex);
}

export function getStoredAccent(): AccentId {
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
    return accentFromStoredValue(stored);
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function getStoredAccentSchedule(): AccentSchedule {
  try {
    const stored = localStorage.getItem(ACCENT_SCHEDULE_STORAGE_KEY);
    if (!stored) return defaultAccentSchedule();

    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return defaultAccentSchedule();
    const maybeSchedule = parsed as Partial<AccentSchedule>;
    const day = normalizeAccentScheduleChoice(maybeSchedule.slots?.day);
    const swing = normalizeAccentScheduleChoice(maybeSchedule.slots?.swing);
    const night = normalizeAccentScheduleChoice(maybeSchedule.slots?.night);
    if (!day || !swing || !night) return defaultAccentSchedule();

    return {
      enabled: maybeSchedule.enabled === true,
      slots: { day, swing, night },
    };
  } catch {
    return defaultAccentSchedule();
  }
}

function saveAccentSchedule(schedule: AccentSchedule): void {
  localStorage.setItem(ACCENT_SCHEDULE_STORAGE_KEY, JSON.stringify(schedule));
}

export function applyScheduledAccent(date = new Date()): boolean {
  const schedule = getStoredAccentSchedule();
  if (!schedule.enabled) return false;
  const slot = getCurrentAccentScheduleSlot(date);
  applyAccentScheduleChoice(schedule.slots[slot.id]);
  return true;
}

export function setAccentScheduleEnabled(enabled: boolean, date = new Date()): AccentSchedule {
  const schedule = { ...getStoredAccentSchedule(), enabled };
  saveAccentSchedule(schedule);
  if (enabled) {
    applyScheduledAccent(date);
  } else {
    apply(getStoredAccent());
  }
  scheduleNextAccentCheck(date);
  return schedule;
}

export function setAccentScheduleSlot(
  slotId: AccentScheduleSlotId,
  choice: AccentScheduleChoice,
  date = new Date(),
): AccentSchedule {
  const normalized = normalizeAccentScheduleChoice(choice);
  const schedule = getStoredAccentSchedule();
  const nextSchedule = normalized
    ? {
        ...schedule,
        slots: {
          ...schedule.slots,
          [slotId]: normalized,
        },
      }
    : schedule;
  saveAccentSchedule(nextSchedule);
  if (nextSchedule.enabled) applyScheduledAccent(date);
  scheduleNextAccentCheck(date);
  return nextSchedule;
}

function apply(id: AccentId): void {
  if (id === 'custom') {
    const customAccent = getStoredCustomAccent();
    if (customAccent) {
      applyCustomAccent(customAccent);
      return;
    }
  }
  clearCustomAccentProperties();
  document.documentElement.setAttribute('data-accent', id);
}

let scheduleTimer: ReturnType<typeof window.setTimeout> | null = null;

function clearAccentScheduleTimer(): void {
  if (!scheduleTimer) return;
  window.clearTimeout(scheduleTimer);
  scheduleTimer = null;
}

function scheduleNextAccentCheck(date = new Date()): void {
  clearAccentScheduleTimer();
  if (!getStoredAccentSchedule().enabled) return;

  const now = date;
  const delayMs = Math.max(
    1000,
    minutesUntilNextScheduleBoundary(now) * 60_000 -
      now.getSeconds() * 1000 -
      now.getMilliseconds(),
  );
  scheduleTimer = window.setTimeout(() => {
    applyScheduledAccent();
    scheduleNextAccentCheck();
  }, delayMs);
}

/** Set, persist, and apply an accent scheme. */
export function setAccent(id: AccentId): void {
  const safeId = id === 'custom' && !getStoredCustomAccent() ? DEFAULT_ACCENT : id;
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, safeId);
  } catch {
    // Persistence is best-effort; still apply for this window.
  }
  apply(safeId);
}

export function setCustomAccent(value: string): string | null {
  const normalized = normalizeHexAccent(value);
  if (!normalized) return null;

  const savedCustomAccents = getStoredCustomAccents().filter((hex) => hex !== normalized);
  const nextCustomAccents = [...savedCustomAccents, normalized].slice(-MAX_CUSTOM_ACCENTS);

  try {
    saveCustomAccents(nextCustomAccents);
    selectCustomAccent(normalized);
  } catch {
    // Persistence is best-effort; still apply for this window.
    applyCustomAccent(normalized);
  }
  return normalized;
}

export function setSavedCustomAccent(value: string): string | null {
  const normalized = normalizeHexAccent(value);
  if (!normalized || !getStoredCustomAccents().includes(normalized)) return null;

  try {
    selectCustomAccent(normalized);
  } catch {
    applyCustomAccent(normalized);
  }
  return normalized;
}

export function removeCustomAccent(value: string): string[] {
  const normalized = normalizeHexAccent(value);
  if (!normalized) return getStoredCustomAccents();

  const nextCustomAccents = getStoredCustomAccents().filter((hex) => hex !== normalized);
  const activeCustomAccent = getStoredCustomAccent();

  try {
    saveCustomAccents(nextCustomAccents);
    if (activeCustomAccent === normalized) {
      const nextActiveCustomAccent = nextCustomAccents.at(-1);
      if (nextActiveCustomAccent) {
        selectCustomAccent(nextActiveCustomAccent);
      } else {
        localStorage.removeItem(CUSTOM_ACCENT_STORAGE_KEY);
        localStorage.setItem(ACCENT_STORAGE_KEY, DEFAULT_ACCENT);
        apply(DEFAULT_ACCENT);
      }
    }
  } catch {
    if (activeCustomAccent === normalized) {
      const nextActiveCustomAccent = nextCustomAccents.at(-1);
      if (nextActiveCustomAccent) {
        applyCustomAccent(nextActiveCustomAccent);
      } else {
        apply(DEFAULT_ACCENT);
      }
    }
  }
  return nextCustomAccents;
}

/**
 * Apply the stored scheme and follow changes made in other windows
 * (the kiosk pop-out shares localStorage with the main window).
 */
let initialized = false;

export function initAccent(): void {
  if (!applyScheduledAccent()) apply(getStoredAccent());
  scheduleNextAccentCheck();
  if (initialized) return;
  initialized = true;
  window.addEventListener('storage', (e) => {
    if (e.key === ACCENT_STORAGE_KEY) {
      if (!applyScheduledAccent()) apply(accentFromStoredValue(e.newValue));
    }
    if (e.key === CUSTOM_ACCENT_STORAGE_KEY && getStoredAccent() === 'custom') {
      if (!applyScheduledAccent()) apply(getStoredAccent());
    }
    if (e.key === CUSTOM_ACCENTS_STORAGE_KEY && getStoredAccent() === 'custom') {
      if (!applyScheduledAccent()) apply(getStoredAccent());
    }
    if (e.key === ACCENT_SCHEDULE_STORAGE_KEY) {
      if (!applyScheduledAccent()) apply(getStoredAccent());
      scheduleNextAccentCheck();
    }
  });
}
