# Light Mode Theme — Design Spec

## Overview

Add a light mode theme to Relay that preserves the existing design language (Signal Red accent, Instrument Sans typography, layout and spacing) while inverting backgrounds and text for light environments. Users can choose System (follows OS), Light, or Dark.

## Architecture

### Theme Switching Mechanism

- `data-theme` attribute on `<html>`: `"light"`, `"dark"`, or absent (defaults to dark)
- Preference stored via `secureStorage` with key `theme-preference`
- Values: `"system"` (default), `"light"`, `"dark"`
- On launch: read stored preference → if "system", use `matchMedia('(prefers-color-scheme: dark)')` → set `data-theme` → listen for OS changes
- New `useTheme()` hook manages state, persistence, and attribute toggling

### CSS Structure

- `:root` retains all current dark theme variables (unchanged, remains the default)
- New `[data-theme="light"]` block overrides `--color-*` variables with light palette
- `color-scheme` property flips from `dark` to `light` (affects scrollbars, form controls)
- Hardcoded `rgba()` values across CSS files get converted to semantic variables so they flip correctly

## Light Mode Color Palette

### Backgrounds

| Token | Dark | Light |
|---|---|---|
| `--color-bg-app` | `#070810` | `#f8f9fb` |
| `--color-bg-surface` | `#0c0e15` | `#ffffff` |
| `--color-bg-surface-2` | `#10131b` | `#f0f1f5` |
| `--color-bg-surface-3` | `#151821` | `#e8eaef` |
| `--color-bg-surface-opaque` | `#0c0e15` | `#ffffff` |
| `--color-bg-surface-elevated` | `#151821` | `#ffffff` |
| `--color-bg-card` | `#0c0e15` | `#ffffff` |
| `--color-bg-card-hover` | `#10131b` | `#f5f6f8` |
| `--color-bg-sidebar` | `#0c0e15` | `#ffffff` |
| `--color-bg-chrome` | `#0c0e15` | `#ffffff` |

### Text

| Token | Dark | Light |
|---|---|---|
| `--color-text-primary` | `#eef0f6` | `#1a1d27` |
| `--color-text-secondary` | `#8892a6` | `#5c6578` |
| `--color-text-tertiary` | `#546178` | `#8892a6` |
| `--color-text-quaternary` | `#8892a6` | `#8892a6` |

### Accent (Signal Red — unchanged)

| Token | Dark | Light |
|---|---|---|
| `--color-accent` | `#e11d48` | `#e11d48` |
| `--color-accent-hover` | `#be123c` | `#be123c` |
| `--color-accent-text` | `#fb7185` | `#e11d48` |
| `--color-accent-dim` | `rgba(225,29,72,0.1)` | `rgba(225,29,72,0.08)` |
| `--color-accent-subtle` | `rgba(225,29,72,0.05)` | `rgba(225,29,72,0.04)` |

### Borders

| Token | Dark | Light |
|---|---|---|
| `--color-border` | `rgba(255,255,255,0.055)` | `rgba(0,0,0,0.08)` |
| `--color-border-subtle` | `rgba(255,255,255,0.03)` | `rgba(0,0,0,0.04)` |
| `--color-border-medium` | `rgba(255,255,255,0.055)` | `rgba(0,0,0,0.08)` |
| `--color-border-strong` | `rgba(255,255,255,0.16)` | `rgba(0,0,0,0.12)` |
| `--color-border-accent` | `rgba(225,29,72,0.3)` | `rgba(225,29,72,0.25)` |

### Semantic Colors

| Token | Dark | Light |
|---|---|---|
| `--color-danger` | `#ef4444` | `#dc2626` |
| `--color-danger-hover` | `#f87171` | `#ef4444` |
| `--color-danger-subtle` | `rgba(239,68,68,0.12)` | `rgba(220,38,38,0.08)` |
| `--color-warning` | `#e11d48` | `#e11d48` |
| `--color-warning-subtle` | `rgba(225,29,72,0.15)` | `rgba(225,29,72,0.1)` |
| `--color-accent-green` | `#22c55e` | `#16a34a` |
| `--color-accent-green-subtle` | `rgba(34,197,94,0.12)` | `rgba(22,163,74,0.08)` |
| `--color-accent-secondary` | `#06b6d4` | `#0891b2` |
| `--color-accent-secondary-subtle` | `rgba(6,182,212,0.1)` | `rgba(8,145,178,0.08)` |

### Shadows

| Token | Dark | Light |
|---|---|---|
| `--shadow-xs` | `0 2px 4px rgba(0,0,0,0.2)` | `0 1px 2px rgba(0,0,0,0.04)` |
| `--shadow-sm` | `0 4px 8px rgba(0,0,0,0.25), ...` | `0 1px 3px rgba(0,0,0,0.06)` |
| `--shadow-md` | `0 8px 24px rgba(0,0,0,0.35), ...` | `0 4px 12px rgba(0,0,0,0.08)` |
| `--shadow-lg` | `0 16px 48px rgba(0,0,0,0.45), ...` | `0 8px 24px rgba(0,0,0,0.1)` |
| `--shadow-xl` | `0 24px 64px rgba(0,0,0,0.55), ...` | `0 12px 32px rgba(0,0,0,0.12)` |
| `--shadow-modal` | `0 24px 80px rgba(0,0,0,0.5)` | `0 16px 48px rgba(0,0,0,0.12)` |

### App-Specific Tokens

| Token | Dark | Light |
|---|---|---|
| `--app-bg` | `#070810` | `#f8f9fb` |
| `--app-surface` | `#0c0e15` | `#ffffff` |
| `--app-surface-2` | `#10131b` | `#f0f1f5` |
| `--app-surface-3` | `#151821` | `#e8eaef` |
| `--app-border` | `rgba(255,255,255,0.055)` | `rgba(0,0,0,0.08)` |
| `--app-text` | `#eef0f6` | `#1a1d27` |
| `--app-muted` | `#8892a6` | `#5c6578` |
| `--app-accent` | `#e11d48` | `#e11d48` |
| `--app-accent-strong` | `#fb7185` | `#e11d48` |
| `--app-accent-soft` | `rgba(225,29,72,0.1)` | `rgba(225,29,72,0.08)` |

## Hardcoded Color Cleanup

New semantic variables to replace recurring hardcoded `rgba()` patterns:

| New Variable | Dark Value | Light Value | Replaces |
|---|---|---|---|
| `--color-hover-overlay` | `rgba(255,255,255,0.02)` | `rgba(0,0,0,0.02)` | Row/card hover backgrounds |
| `--color-hover-overlay-strong` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.03)` | Stronger hover states |
| `--color-active-overlay` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.04)` | Active/pressed states |
| `--color-backdrop` | `rgba(0,0,0,0.42)` | `rgba(0,0,0,0.3)` | Modal backdrops |
| `--color-divider` | `rgba(255,255,255,0.025)` | `rgba(0,0,0,0.04)` | Row dividers |

These variables are defined in `:root` with dark values and overridden in `[data-theme="light"]`.

## Components

### useTheme Hook

```typescript
type ThemePreference = 'system' | 'light' | 'dark';

interface UseThemeReturn {
  preference: ThemePreference;       // stored preference
  resolved: 'light' | 'dark';       // actual applied theme
  setPreference: (p: ThemePreference) => void;
}
```

- Reads/writes `secureStorage` key `theme-preference`
- Sets `document.documentElement.dataset.theme` to resolved value
- Listens for `matchMedia` changes when preference is `"system"`
- Cleans up listener on unmount or preference change

### Settings Modal Addition

New "Appearance" section at the top of SettingsModal with three radio-style buttons:

- **System** — follows OS preference (default)
- **Light** — always light
- **Dark** — always dark

Uses the same `TactileButton` pattern as existing settings controls.

### Favicon

The web favicon (`src/renderer/public/favicon.svg`) stays as-is (dark background). It works in both browser tab contexts. Desktop icons (.icns, .ico) are unchanged — they're the app's brand mark.

## Files Modified

1. `src/renderer/src/styles/theme.css` — Light variable overrides, new semantic variables
2. `src/renderer/src/styles/components.css` — Replace hardcoded rgba with variables
3. `src/renderer/src/styles/modals.css` — Replace hardcoded rgba with variables
4. `src/renderer/src/styles/setup.css` — Replace hardcoded rgba with variables
5. `src/renderer/src/components/oncall/oncall.css` — Replace hardcoded rgba with variables
6. `src/renderer/src/tabs/weather/weather.css` — Replace hardcoded rgba with variables
7. `src/renderer/src/tabs/alerts.css` — Replace hardcoded rgba with variables
8. `src/renderer/src/components/sidebar/sidebar.css` — Replace hardcoded rgba with variables
9. Other CSS files with hardcoded colors (~5 more)
10. `src/renderer/src/hooks/useTheme.ts` — New hook
11. `src/renderer/src/components/SettingsModal.tsx` — Appearance section
12. `src/renderer/src/App.tsx` — Initialize useTheme

## Testing

- Toggle all three modes and verify every tab renders correctly
- Verify OS preference detection (change macOS Appearance, confirm app follows)
- Check modals, tooltips, dropdowns, context menus, command palette
- Verify popout on-call board inherits theme
- Run existing test suite — no regressions
