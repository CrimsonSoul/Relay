# Relay Design Guide

Current visual and interaction conventions for the Relay renderer.

## Overview

Relay uses the **Accent Ink** design language: a pure-black canvas, typography-first
hierarchy through Outfit weight contrast, and a single swappable accent color as the
only active-state signal. All tokens live in `src/renderer/src/styles/theme.css`.

## Source Of Truth

| File                                     | Purpose                                                               |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `src/renderer/src/styles/theme.css`      | Global color, spacing, typography, radius, z-index, and motion tokens |
| `src/renderer/src/styles/components.css` | Shared button, input, shell, and layout styles                        |
| `src/renderer/src/styles/utilities.css`  | `.display-heading`, `.ink-rail`, `.card-surface`, and text helpers    |
| `src/renderer/src/styles/modals.css`     | Modal layout and overlay styling                                      |
| `src/renderer/src/styles/responsive.css` | Breakpoints and responsive behavior                                   |
| `src/renderer/src/styles/animations.css` | Reusable animation helpers                                            |
| `src/renderer/src/theme/accent.ts`       | Accent scheme definitions and runtime API                             |
| `src/renderer/src/tabs/alerts.css`       | Alert composer and preview styles (email preview fenced — see below)  |
| `src/renderer/src/tabs/notes/notes.css`  | Notes masonry, cards, and editor styles                               |
| `src/renderer/src/tabs/cloud-status.css` | Provider summary cards and incident feed styles                       |

---

## 1. The Accent Ink Language

The design rests on four principles:

1. **Pure-black canvas.** App background is `#000000`. Surfaces step up only slightly
   (`#0a0a0a`, `#111111`). Elevated floating surfaces sit at `#161616`.
2. **Typography-first hierarchy.** Weight contrast replaces surface contrast. Display
   headings use weight 200; body text uses 500; emphasis uses 700–800. No heading
   background fills.
3. **Four text-dimming tiers.** Primary `#fff` → secondary `#bdbdbd` → tertiary
   `#8a8a8a` → quaternary `#767676`. Quaternary is the legibility floor (≥ 4.5 : 1
   on black); do not use a lighter shade for readable text.
4. **1 px `#1d1d1d` dividers, edge-rails over boxes.** Horizontal rules and the
   `.ink-rail` left-border replace boxy card outlines wherever content allows.

---

## 2. Display Headings

Large section titles follow the ink heading pattern:

- `font-size: var(--text-display)` — fluid `clamp(34px, 3vw, 56px)`
- `font-weight: 200`
- `text-transform: lowercase`
- `letter-spacing: -0.02em`
- Accent period appended via `::after { content: '.'; color: var(--accent); font-weight: 800 }`

Two shared classes apply the full pattern:

- **`.display-heading`** — standalone section headings (`utilities.css`)
- **`.collapsible-header-title`** — heading inside `CollapsibleHeader` (`components.css`)

**Moderated variant — `.toolbar-title`** (`components.css`): same weight-200 lowercase
style but at `var(--text-xl)` (`clamp(24px, 1.6vw, 32px)`), used in list toolbar
contexts where a full display-size heading would be too large.

---

## 3. Edge-Rail Pattern

`.ink-rail` is the primary row/card treatment — a 4 px left border with no box
background:

```css
.ink-rail                /* neutral: border-left: 4px solid var(--color-border-strong) */
.ink-rail--accent        /* active / featured: border-left-color: var(--accent) */
.ink-rail--alarm         /* problem: border-left-color: var(--alarm) */
```

**Semantics:**

| Modifier   | Token                             | Meaning                           |
| ---------- | --------------------------------- | --------------------------------- |
| (default)  | `--color-border-strong` `#2a2a2a` | neutral, not active               |
| `--accent` | swappable accent color            | active, selected, featured        |
| `--alarm`  | `#ff4539` fixed                   | genuine problem or critical state |

Rails encode state at a glance from 10 ft. Never swap the alarm rail for decorative
use or use accent rails for severity.

The older `.accent-strip` absolute-positioned div is kept for backward compatibility
but is superseded by `.ink-rail`.

---

## 4. Elevated-Surface Rule

Boxes with a background fill (`#161616` + `1px #2a2a2a` border + shadow) are
reserved exclusively for **floating surfaces** that sit above the canvas:

- Modals and confirm dialogs
- Popovers and tooltips
- Context menus and combobox dropdowns
- Toast/reminder overlays
- Drag ghost elements

Inline content areas (list rows, tab panels, cards in masonry, split-panel columns)
use a transparent background against the `#000` canvas, differentiated only by
typography weight and edge rails. Do not give inline surfaces an elevated background.

The relevant token is `--color-bg-surface-elevated: #161616` combined with
`--border-strong: 1px solid #2a2a2a` and an appropriate `--shadow-*` value.

---

## 5. Accent System

### Schemes

Five schemes are defined in `theme/accent.ts` (`ACCENT_SCHEMES`) and as
`:root[data-accent="…"]` overrides in `theme.css`:

| ID       | Label                | `--accent` swatch |
| -------- | -------------------- | ----------------- |
| `red`    | Signal Red (default) | `#e63946`         |
| `blue`   | Blue                 | `#3b82f6`         |
| `green`  | Green                | `#22c55e`         |
| `pink`   | Pink                 | `#ec4899`         |
| `purple` | Purple               | `#a855f7`         |

### How It Works

`data-accent` on `<html>` switches the three base variables. All derived values
recompute automatically:

| Token             | Source                                                    |
| ----------------- | --------------------------------------------------------- |
| `--accent`        | scheme base color                                         |
| `--accent-hover`  | lighter midtone                                           |
| `--accent-bright` | brightest; used for text on dark (≥ 4.5 : 1 on `#000`)    |
| `--accent-dim`    | `color-mix(in srgb, var(--accent) 12%, transparent)`      |
| `--accent-subtle` | `color-mix(in srgb, var(--accent) 6%, transparent)`       |
| `--on-accent`     | `#000000` — text/icon color on a filled accent background |

Legacy aliases (`--color-accent`, `--color-accent-hover`, etc.) forward to the live
tokens and remain functional.

### TypeScript API (`src/renderer/src/theme/accent.ts`)

```ts
ACCENT_SCHEMES; // AccentScheme[] — id, label, swatch
ACCENT_STORAGE_KEY; // 'relay-accent'
DEFAULT_ACCENT; // 'red'

getStoredAccent(); // → AccentId — reads localStorage, falls back to 'red'
setAccent(id); // persist + apply immediately
initAccent(); // apply stored scheme; also wires window 'storage' listener
```

`initAccent()` wires a `window.addEventListener('storage', …)` handler so the kiosk
pop-out window stays in sync with the main window via the shared `localStorage` key.
Call it once at renderer startup.

---

## 6. Fixed Semantic Palette

These colors are **never** changed by accent scheme selection:

| Token                    | Value                               | Use                           |
| ------------------------ | ----------------------------------- | ----------------------------- |
| `--alarm`                | `#ff4539`                           | Genuine system problems only  |
| `--alarm-bright`         | `#ff6b61`                           | Alarm hover / text on dark    |
| `--alarm-dim`            | `color-mix(alarm 12%, transparent)` | Alarm fill tint               |
| `--ok`                   | `#2bb24c`                           | Positive / resolved / healthy |
| `--color-warning`        | `#ffb000`                           | Non-critical caution          |
| `--color-warning-subtle` | `rgba(255,176,0,0.12)`              | Warning tint background       |

**Rule:** use `--alarm` only when the user has a real problem to act on. Never use it
for decorative highlights. Never use `--accent` for severity or urgency signals.

Group and note category colors (`--color-group-blue`, `--color-group-purple`, etc.)
are user-data color assignments. They stay as literal values and are not re-mapped by
accent or alarm logic.

---

## 7. Chips

Chips are square (2 px border-radius), compact label badges with three modes:

| Mode                        | Style                                                                     | Example use                                                                  |
| --------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Informational** (outline) | `border: 1px solid --color-border-strong`, transparent bg, secondary text | `.contact-entry-chip` unselected state                                       |
| **Featured** (accent)       | `background: --accent-dim`, `color: --accent-bright`, no border           | `.contact-entry-chip` selected; `.popout-alert-chip--info`; `.toolbar-badge` |
| **Alarm** (solid)           | `background: --alarm`, `color: #000`, `font-weight: 800`                  | `.popout-alert-chip--danger`; alarm action chips                             |

Chips should not use custom fills outside these three modes. Alarm chips always use
`#000` for their label text (not `--on-accent`).

---

## 8. Buttons and Inputs

### TactileButton (`src/renderer/src/components/TactileButton.tsx`)

All four variants use 2 px border-radius and `font-weight: 700`:

| Variant   | Background  | Border                  | Text color                                  |
| --------- | ----------- | ----------------------- | ------------------------------------------- |
| `default` | transparent | `--color-border-strong` | `--color-text-secondary` → primary on hover |
| `primary` | `--accent`  | `--accent`              | `--on-accent` (`#000`), weight 800          |
| `ghost`   | transparent | transparent             | `--color-text-tertiary` → primary on hover  |
| `danger`  | `--alarm`   | `--alarm`               | `#000000`, weight 800; fixed — not themed   |

Sizes:

| Size prop      | Height | Padding                   | Font size   |
| -------------- | ------ | ------------------------- | ----------- |
| `sm` (default) | —      | `7px 16px`                | 13 px       |
| (base)         | —      | `9px 20px`                | `--text-sm` |
| `md`           | 48 px  | `0 24px`                  | `--text-md` |
| icon-only      | —      | 0, width 40 px (34 px sm) | —           |

Focus ring: `box-shadow: 0 0 0 2px var(--color-accent-dim)` + `border-color: --accent`.

Active/toggled-on state: `.is-active` applies `background: --accent-dim`,
`color: --accent-bright`, transparent border.

### `.tactile-input`

Height 44 px, transparent background, `1px solid --color-border-strong`, 2 px radius.
Focus: `border-color: --accent` + `box-shadow: 0 0 0 2px --color-accent-dim`.

### Header Search Bar (`.header-search-bar`)

Underline-only input: `border-bottom: 2px solid --color-border-strong`, no box.
On focus-within: `border-bottom-color: --accent`. Max-width 400 px.

---

## 9. Typography

### Fonts

- **UI font:** `Outfit Variable` — loaded as variable font; fallback `Outfit, sans-serif`
- **Mono font:** `JetBrains Mono` — used for timestamps, phone numbers, IDs, and any
  tabular numeric (`font-variant-numeric: tabular-nums`)

### Fluid Scale

All sizes use `clamp()` tuned for dual-distance viewing: 24" desktop at arm's length
and 55" TV at approximately 10 ft (both at 1080p).

| Token            | Value                       | ~px at 1920 px wide |
| ---------------- | --------------------------- | ------------------- |
| `--text-2xs`     | `clamp(13px, 0.72vw, 14px)` | 14 px               |
| `--text-xs`      | `clamp(14px, 0.8vw, 16px)`  | 15 px               |
| `--text-sm`      | `clamp(15px, 0.9vw, 18px)`  | 17 px               |
| `--text-base`    | `clamp(16px, 1.05vw, 20px)` | 20 px               |
| `--text-md`      | `clamp(18px, 1.2vw, 23px)`  | 23 px               |
| `--text-lg`      | `clamp(20px, 1.4vw, 27px)`  | 27 px               |
| `--text-xl`      | `clamp(24px, 1.6vw, 32px)`  | 32 px               |
| `--text-2xl`     | `clamp(28px, 2vw, 40px)`    | 38 px               |
| `--text-3xl`     | `clamp(34px, 2.6vw, 50px)`  | 50 px               |
| `--text-4xl`     | `clamp(42px, 3.2vw, 62px)`  | 62 px               |
| `--text-display` | `clamp(34px, 3vw, 56px)`    | 56 px               |

### Weight Tokens

`--weight-regular: 400` / `--weight-medium: 500` / `--weight-semibold: 600` /
`--weight-bold: 700` / `--weight-extrabold: 800` / `--weight-black: 900`

---

## 10. Alerts Email-Preview Exemption

`src/renderer/src/tabs/alerts.css` contains two fenced regions marked with:

```
/* === EMAIL CONTENT — DO NOT RESTYLE … */
…
/* === END EMAIL CONTENT … */
```

Everything within those fences is **exported content** — the white-canvas email
preview card that matches the actual sent alert email. Its hardcoded colors (white
background, dark text, literal severity colors) are correct and intentional. Never
apply ink tokens, accent variables, or theme changes inside these fences.

---

## 11. Styling Rules

### Do

- Use tokens from `theme.css` instead of hardcoded shared values
- Prefer shared classes and components before adding one-off patterns
- Keep styles in the existing CSS files unless a feature already owns its own
  stylesheet
- Use `:focus-visible` for keyboard focus states
- Keep dynamic runtime styling limited to cases that truly need inline values
- Use `.ink-rail` modifiers to communicate state via the left-rail color
- Use `--alarm` only for genuine problems the user must act on

### Do Not

- Do not add Tailwind, CSS modules, or CSS-in-JS to new renderer code
- Do not hardcode common spacing, radii, or colors that already exist as tokens
- Do not add custom button patterns when `TactileButton` already covers the case
- Do not use `--accent` for severity or urgency semantics
- Do not use `--alarm` decoratively (borders, section tints, unrelated highlights)
- Do not give inline content surfaces an elevated (`#161616`) background fill

### Inline Style Exceptions

Inline styles are acceptable when the value is produced at runtime:

- `react-window` row positioning
- `@dnd-kit` transform values
- Dynamic CSS custom properties (e.g., per-entity accent color passed as `--swatch`)
- Runtime-computed dimensions

Static design values must stay in CSS.

---

## 12. Accessibility Baseline

- **Focus ring:** `box-shadow: 0 0 0 2px var(--color-accent-dim)` + accent border on
  all interactive elements via `:focus-visible`
- **Color + shape:** State must be communicated by at least two signals — color alone
  is insufficient. Rail color is supplemented by label text or icon change.
- **Contrast floors:** Text quaternary (`#767676`) is the minimum for any readable
  text on `#000`. Accent-bright colors in each scheme are verified ≥ 4.5 : 1 on
  black. `--on-accent` (`#000`) on accent-fill buttons meets contrast requirements.
- **Reduced motion:** Animations that flash or pulse (e.g., critical reminder overlay)
  include a `@media (prefers-reduced-motion: reduce)` override.
- Clickable non-button elements need semantic ARIA roles and keyboard handlers.

---

## Layout Tokens

| Token                           | Value          |
| ------------------------------- | -------------- |
| `--sidebar-width-collapsed`     | 110 px         |
| `--header-height`               | 56 px          |
| `--space-1` … `--space-12`      | 4 px … 64 px   |
| `--radius-sm` … `--radius-pill` | 6 px … 9999 px |
| `--z-dropdown`                  | 100            |
| `--z-overlay`                   | 1000           |
| `--z-popover`                   | 5000           |
| `--z-modal`                     | 9999           |
| `--z-window-controls`           | 10001          |
| `--z-command-palette`           | 10002          |
| `--z-critical`                  | 20000          |
