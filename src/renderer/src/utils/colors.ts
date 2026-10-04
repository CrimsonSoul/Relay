import { getAccentHue, getActiveAccentColor } from '../theme/accent';

type ColorScheme = {
  bg: string;
  border: string;
  text: string;
  fill: string;
};

const makeColorScheme = (rgb: string, text: string, fill: string): ColorScheme => ({
  bg: `rgba(${rgb}, 0.2)`,
  border: `rgba(${rgb}, 0.4)`,
  text,
  fill,
});

const DEFAULT_SCHEME = makeColorScheme('99, 102, 241', '#A5B4FC', '#6366F1');

/**
 * Hash-assigned identity colours (team cards, group pills, avatars). Identity must never read as
 * state, so every hue sits more than 30° from alarm, warning and ok (enforced by
 * utils/__tests__/colors.test.ts) — no red, rose, pink, orange, amber, yellow, lime or
 * green — and blue/sky are left out so identity is not mistaken for `--info`. Hues: teal 173°,
 * cyan 189°, indigo 239°, violet 258°, purple 271°, fuchsia 292°.
 */
export const IDENTITY_PALETTE: readonly ColorScheme[] = [
  DEFAULT_SCHEME,
  makeColorScheme('20, 184, 166', '#5EEAD4', '#14B8A6'),
  makeColorScheme('6, 182, 212', '#67E8F9', '#06B6D4'),
  makeColorScheme('139, 92, 246', '#C4B5FD', '#8B5CF6'),
  makeColorScheme('168, 85, 247', '#D8B4FE', '#A855F7'),
  makeColorScheme('217, 70, 239', '#F0ABFC', '#D946EF'),
];

/** Identity hues closer than this to the active accent read as accent chrome, so they are skipped. */
const ACCENT_HUE_TOLERANCE_DEGREES = 20;

const isNearAccent = (fill: string, accentHue: number | null): boolean => {
  const hue = getAccentHue(fill);
  if (accentHue === null || hue === null) return false;
  const gap = Math.abs(hue - accentHue);
  return Math.min(gap, 360 - gap) <= ACCENT_HUE_TOLERANCE_DEGREES;
};

/**
 * Hash-picked identity colour for a name. An entry within ~20° of the active accent (Cyan, Purple,
 * Violet or a custom colour) is skipped for the next non-conflicting entry, so a team name never
 * matches the active nav or primary fills. Deterministic per name and accent; `accent` defaults to
 * the document's current `--accent`.
 */
export const getColorForString = (
  str: string,
  accent: string = getActiveAccentColor(),
): ColorScheme => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (str.codePointAt(i) ?? 0) + ((hash << 5) - hash);
  }
  const start = Math.abs(hash) % IDENTITY_PALETTE.length;
  const accentHue = getAccentHue(accent);
  for (let step = 0; step < IDENTITY_PALETTE.length; step++) {
    const scheme = IDENTITY_PALETTE[(start + step) % IDENTITY_PALETTE.length];
    if (scheme && !isNearAccent(scheme.fill, accentHue)) return scheme;
  }
  // Unreachable with the shipped palette (one accent can sit near at most three of six hues).
  return IDENTITY_PALETTE[start] ?? DEFAULT_SCHEME;
};
