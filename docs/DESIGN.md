# Relay Design Guide

Current visual and interaction conventions for the Relay renderer.

## Overview

Relay uses the **Accent Ink** design language: a softened charcoal canvas,
typography-first hierarchy through IBM Plex Sans weight contrast, and a single swappable
accent color as the only active-state signal. All tokens live in
`src/renderer/src/styles/theme.css`.

## Source Of Truth

| File                                                         | Purpose                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `src/renderer/src/styles/theme.css`                          | Global color, spacing, typography, radius, z-index, and motion tokens |
| `src/renderer/src/styles/components.css`                     | Shared button, input, shell, and layout styles                        |
| `src/renderer/src/styles/utilities.css`                      | `.display-heading`, `.ink-rail`, `.card-surface`, and text helpers    |
| `src/renderer/src/styles/modals.css`                         | Modal layout and overlay styling                                      |
| `src/renderer/src/styles/responsive.css`                     | Breakpoints and responsive behavior                                   |
| `src/renderer/src/styles/animations.css`                     | Reusable animation helpers                                            |
| `src/renderer/src/theme/accent.ts`                           | Accent scheme definitions and runtime API                             |
| `src/renderer/src/tabs/alerts.css`                           | Alert composer and preview styles (email preview fenced — see below)  |
| `src/renderer/src/tabs/cloud-status.css`                     | Provider summary cards and incident feed styles                       |
| `src/renderer/src/features/knowledge/knowledgeWorkspace.css` | Knowledge launcher and internal destination shell                     |
| `src/renderer/src/features/knowledge/knowledge.css`          | Wiki library, management, and PDF reader                              |

---

## 1. The Accent Ink Language

The design rests on four principles:

1. **Softened charcoal canvas.** App background is `#09090b`. Surfaces step up
   gently (`#111114`, `#19191d`). Elevated floating surfaces sit at `#222227`.
2. **Typography-first hierarchy.** Weight contrast replaces surface contrast. Rare
   display titles use weight 200; body text uses 500; emphasis uses 700–800. No
   heading background fills.
3. **Four text-dimming tiers.** Primary `#eee9ec` -> secondary `#beb6bb` ->
   tertiary `#928a90` -> quaternary `#847c82`. Quaternary is the legibility floor
   (>= 4.5 : 1 on the charcoal canvas); do not use a lighter shade for readable
   text.
4. **1 px `#2b292e` dividers, edge-rails over boxes.** Horizontal rules and the
   `.ink-rail` left-border replace boxy card outlines wherever content allows.

---

## 2. Heading Hierarchy

The app header breadcrumb provides top-level tab identity. Pane headings use
`.toolbar-title`: an uppercase, `0.12em`, weight-800 accent eyebrow matching section
labels such as the Compose sidebar's GROUPS heading.

The giant lowercase treatment with an accent period belongs to the `relay.` sidebar
wordmark and is not the default for tabs or panes. `.display-heading` and
`.collapsible-header-title` retain that older styling for compatibility, but new
surfaces should use the breadcrumb and eyebrow hierarchy unless a design explicitly
calls for a standalone display title.

---

## 3. Edge-Rail Pattern

**Reference utility** — `.ink-rail` defines the canonical row/card treatment — a 4 px left border with no box
background; existing components implement the same declarations locally — use the utility class for new work:

```css
.ink-rail                /* neutral: border-left: 4px solid var(--color-border-strong) */
.ink-rail--accent        /* active / featured: border-left-color: var(--accent) */
.ink-rail--alarm         /* problem: border-left-color: var(--alarm) */
```

**Semantics:**

| Modifier   | Token                             | Meaning                           |
| ---------- | --------------------------------- | --------------------------------- |
| (default)  | `--color-border-strong` `#39363c` | neutral, not active               |
| `--accent` | swappable accent color            | active, selected, featured        |
| `--alarm`  | `#ff4539` fixed                   | genuine problem or critical state |

Rails encode state at a glance from 10 ft. Never swap the alarm rail for decorative
use or use accent rails for severity.

The older `.accent-strip` absolute-positioned div is kept for backward compatibility
but is superseded by `.ink-rail`.

---

## 4. Elevated-Surface Rule

The elevated combination (`--color-bg-surface-elevated` + strong border + shadow) is
reserved for **floating surfaces** that sit above the canvas:

- Modals and confirm dialogs
- Popovers and tooltips
- Context menus and combobox dropdowns
- Toast/reminder overlays
- Drag ghost elements

Inline content should not imitate elevation. Dense rows and panels should prefer a
transparent canvas with dividers or edge rails. When grouping needs a filled boundary,
use the lower-level `--color-bg-surface` or `--color-bg-card` tokens with the existing
border treatment and no shadow; Knowledge launcher cards and filter/tool surfaces are
current examples.

The relevant token is `--color-bg-surface-elevated: #222227` combined with
`--border-strong: 1px solid #39363c` and an appropriate `--shadow-*` value.

Shared controls, cards, and generic modals use 2px corners. Reuse the radius already
owned by an existing component instead of inferring more rounding from surface size.
A rounded one-off surface next to square chips reads as foreign.

---

## 5. Accent System

### Preset Schemes

Ten schemes are defined in `theme/accent.ts` (`ACCENT_SCHEMES`) and as
`:root[data-accent="…"]` overrides in `theme.css`:

| ID       | Label                | `--accent` swatch |
| -------- | -------------------- | ----------------- |
| `red`    | Signal Red (default) | `#e63946`         |
| `orange` | Orange               | `#f97316`         |
| `yellow` | Yellow               | `#facc15`         |
| `blue`   | Blue                 | `#3b82f6`         |
| `cyan`   | Cyan                 | `#06b6d4`         |
| `green`  | Green                | `#22c55e`         |
| `lime`   | Lime                 | `#84cc16`         |
| `pink`   | Pink                 | `#fc8da9`         |
| `purple` | Purple               | `#a855f7`         |
| `violet` | Violet               | `#8b5cf6`         |

The orange and yellow schemes are deliberately tuned as non-semantic operator
preferences so they stay distinguishable from the fixed `--alarm` red-orange
(`#ff4539`) and `--color-warning` amber (`#ffb000`).

Settings can also save up to four custom hexadecimal accents. A custom accent derives
its hover and bright variants at runtime, lifts `--accent-bright` until it meets the
dark-canvas contrast floor, and chooses black or white for `--on-accent` according to
which has the stronger contrast against the fill.

Accent scheduling is workstation-local and optional. It assigns a preset or saved
custom color to three fixed `America/Chicago` windows: Day (6 AM–2 PM CT), Swing
(2 PM–10 PM CT), and Night (10 PM–6 AM CT). When enabled, the active slot overrides
the manually stored accent and is reevaluated at the next slot boundary.

### How It Works

For presets, `data-accent` on `<html>` switches the base variables. Custom colors set
the same properties inline after deriving accessible variants:

| Token             | Source                                                          |
| ----------------- | --------------------------------------------------------------- |
| `--accent`        | scheme base color                                               |
| `--accent-hover`  | lighter midtone                                                 |
| `--accent-bright` | brightest; used for text on dark (>= 4.5 : 1 on `#09090b`)      |
| `--accent-dim`    | `color-mix(in srgb, var(--accent) 12%, transparent)`            |
| `--accent-subtle` | `color-mix(in srgb, var(--accent) 6%, transparent)`             |
| `--on-accent`     | `#000000` for presets; computed black or white for custom fills |

Legacy aliases (`--color-accent`, `--color-accent-hover`, etc.) forward to the live
tokens and remain functional.

### TypeScript API (`src/renderer/src/theme/accent.ts`)

```ts
ACCENT_SCHEMES; // AccentScheme[] — id, label, swatch
ACCENT_STORAGE_KEY; // 'relay-accent'
CUSTOM_ACCENT_STORAGE_KEY; // 'relay-custom-accent' — active custom color
CUSTOM_ACCENTS_STORAGE_KEY; // 'relay-custom-accents'
ACCENT_SCHEDULE_STORAGE_KEY; // 'relay-accent-schedule'
ACCENT_SCHEDULE_SLOTS; // Day, Swing, and Night in America/Chicago
DEFAULT_ACCENT; // 'red'

getStoredAccent(); // → AccentId — reads localStorage, falls back to 'red'
setAccent(id); // persist + apply immediately
setCustomAccent(hex); // normalize, save, and apply a custom accent
setAccentScheduleEnabled(enabled); // persist and apply schedule state
setAccentScheduleSlot(slotId, choice); // assign a preset or saved custom color
initAccent(); // apply schedule or stored accent; wire cross-window storage sync
```

`initAccent()` applies the scheduled slot when scheduling is enabled, otherwise it
applies the stored manual accent. It also schedules the next boundary check and wires
a `window.addEventListener('storage', …)` handler so the kiosk pop-out stays in sync
with the main window. Call it once at renderer startup.

---

## 6. Fixed Semantic Palette

These colors are **never** changed by accent scheme selection:

| Token                    | Value                                               | Use                                                       |
| ------------------------ | --------------------------------------------------- | --------------------------------------------------------- |
| `--alarm`                | `#ff4539`                                           | Genuine system problems only                              |
| `--alarm-bright`         | `#ff6b61`                                           | Alarm hover / text on dark                                |
| `--alarm-dim`            | `color-mix(in srgb, var(--alarm) 12%, transparent)` | Alarm fill tint                                           |
| `--ok`                   | `#2bb24c`                                           | Positive / resolved / healthy                             |
| `--color-warning`        | `#ffb000`                                           | Non-critical caution                                      |
| `--color-warning-subtle` | `rgba(255,176,0,0.12)`                              | Warning tint background                                   |
| `--info`                 | `#1565c0`                                           | Informational blue (matches the email card's INFO banner) |
| `--info-bright`          | `#42a5f5`                                           | Info lifted for black-ink fills / text on dark            |

**Rule:** use `--alarm` only when the user has a real problem to act on. Never use it
for decorative highlights. Never use `--accent` for severity or urgency signals.

Group and note category colors (`--color-group-blue`, `--color-group-purple`, etc.)
are user-data color assignments. They stay as literal values and are not re-mapped by
accent or alarm logic.

---

## 7. Chips

Chips are square (2 px border-radius), compact label badges with four modes:

| Mode                        | Style                                                                                                                                         | Example use                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Informational** (outline) | `border: 1px solid --color-border-strong`, transparent bg, secondary text                                                                     | `.contact-entry-chip` unselected state                                       |
| **Featured** (accent)       | `background: --accent-dim`, `color: --accent-bright`, no border                                                                               | `.contact-entry-chip` selected; `.popout-alert-chip--info`; `.toolbar-badge` |
| **Alarm** (solid)           | `background: --alarm`, `color: #000`, `font-weight: 800`                                                                                      | `.popout-alert-chip--danger`; alarm action chips                             |
| **Severity** (solid fills)  | Fixed severity token as solid fill with `#000` ink, `font-weight: 800` — includes the INFO solid (`background: --info-bright`, `color: #000`) | Severity chips in alert history and the alerts form                          |

Chips should not use custom fills outside these four modes. Solid chips (alarm and
severity fills) always use `#000` for their label text (not `--on-accent`).

---

## 8. Buttons and Inputs

### TactileButton (`src/renderer/src/components/TactileButton.tsx`)

All four variants use 2px corners. Secondary and ghost use weight 700; primary and
danger use weight 800:

| Variant               | Background  | Border                  | Text color                                  |
| --------------------- | ----------- | ----------------------- | ------------------------------------------- |
| `secondary` (default) | transparent | `--color-border-strong` | `--color-text-secondary` → primary on hover |
| `primary`             | `--accent`  | `--accent`              | `--on-accent`, weight 800                   |
| `ghost`               | transparent | transparent             | `--color-text-tertiary` → primary on hover  |
| `danger`              | `--alarm`   | `--alarm`               | `#000000`, weight 800; fixed — not themed   |

Sizes:

| Size prop       | Height | Padding                   | Font size   |
| --------------- | ------ | ------------------------- | ----------- |
| (base, default) | —      | `9px 20px`                | `--text-sm` |
| `sm`            | —      | `7px 16px`                | 13 px       |
| `md`            | 48 px  | `0 24px`                  | `--text-md` |
| icon-only       | —      | 0, width 40 px (34 px sm) | —           |

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

- **UI font:** `IBM Plex Sans` — locally bundled weights 400, 500, 600, and 700 plus
  400 italic; fallback `'Segoe UI', system-ui, sans-serif`
- **Mono font:** `JetBrains Mono` — reserved for genuinely technical surfaces only:
  the kiosk clock (`.popout-kiosk-timestamp`), `kbd`/`code`/`pre` and keycap chips
  (`.shortcuts-modal-key`), host:port addresses (`.setup-config__discover-addr`),
  data paths, and the fenced email-preview content in `alerts.css`
- **Everything else uses the UI font** — including timestamps, dates, counts, phone
  numbers, and shift time windows. Numeric values get
  `font-variant-numeric: tabular-nums` for aligned digits without the code texture

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

`src/renderer/src/tabs/alerts.css` contains two fenced regions marked with full-width banner comments:

```
/* ==========================================================================
   EMAIL CONTENT — DO NOT RESTYLE. ...
   ========================================================================== */
```

The first region spans from `.alerts-email-card` through the highlight-pill rules,
ending with an "END EMAIL CONTENT" banner. The second region is the `.alerts-email-event-time*`
banner rules, marked with its own EMAIL CONTENT and END EMAIL CONTENT banners.

Everything within those fences is **exported content** — the white-canvas email
preview card that matches the actual sent alert email. Its hardcoded colors (white
background, dark text, literal severity colors) are correct and intentional. Never
apply ink tokens, accent variables, or theme changes inside these fences.

The card's base font rides `--font-family-base` and therefore uses IBM Plex Sans with the
redesign; this is intentional. The fenced rules themselves are unchanged from the
pre-redesign baseline.

---

## 11. Knowledge Workspace

Knowledge is the single sidebar destination for the Wiki, Contacts, and Servers surfaces. The app
header always identifies the outer route as `Relay / Knowledge`; the workspace's own navigation
identifies the active inner destination.

### Launcher

- Launcher order and keyboard order are exactly **Wiki, Contacts, Servers**.
- Each destination is a full-size real button with a Relay-native preview of its production
  surface: library/reader for Wiki, directory/detail context for Contacts, and infrastructure/detail
  context for Servers.
- The three previews use the black canvas, sharp dividers, dense type, and one restrained accent
  signal. They are not floating SaaS cards: no decorative shadow, gradient, glow, or excessive
  rounding.
- Counts are live when available and expose useful singular/plural accessible names. Unknown
  counts remain explicit rather than displaying a misleading zero.
- At desktop width the launcher uses three columns, then collapses to two and one without changing
  DOM or focus order.

### Retained destinations and contextual notes

Wiki, Contacts, and Servers mount on first entry and remain retained when hidden. Returning to a
destination preserves its selected document or record, filters, detail panel, and local scroll
state. The internal navigation provides a clear Knowledge-home action plus direct destination
buttons; all controls use real button semantics and visible focus states.

Notes are contextual only. Contact and server detail panels may display and edit their attached
notes and tags. There is no standalone Notes tab, masonry surface, or freeform-note design pattern.
Dynatrace problem notes remain part of the Problems workflow and do not appear in Knowledge.

### Wiki PDF reader

The reader defaults to **Continuous** and exposes a toolbar toggle to **Single page**. Continuous
mode reserves a stable shell for every page so the scrollbar represents the whole PDF, while only
the current page and a bounded overscan window mount canvases. The page indicator follows the most
visible page. Single mode renders one page and keeps the same navigation, zoom, link, retry, and
focus behavior.

The view-mode preference is local to the workstation. Switching mode or visiting another
Knowledge destination must retain the current document and page without a second download or PDF
parse. Internal PDF links stay inside the reader; approved HTTP(S) links use the system browser.
Reader motion honors `prefers-reduced-motion`, and page-local failures use a polite live status with
a retry action rather than replacing the entire document.

---

## 12. Service Status

Juniper Mist appears as four separate provider rows labeled **Juniper Mist Global**, **Juniper Mist EMEA**, **Juniper Mist APAC**, and **Juniper Mist Federal** immediately after Cloudflare. All four rows use the same monochrome Juniper Networks mark and the standard provider-row/detail interaction; region is conveyed by text, not by color or icon variants.

Mist rows offer only the official status-page action. They do not invent X or Downdetector destinations. Operational, degraded, outage, and Unknown states continue to use Relay's fixed semantic palette and paired text labels.

## 13. Styling Rules

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
- Do not give inline content surfaces an elevated (`#222227`) background fill

### Inline Style Exceptions

Inline styles are acceptable when the value is produced at runtime:

- `react-window` row positioning
- `@dnd-kit` transform values
- Dynamic CSS custom properties (e.g., per-entity accent color passed as `--swatch`)
- Runtime-computed dimensions

Static design values must stay in CSS.

---

## 14. Accessibility Baseline

- **Focus ring:** `box-shadow: 0 0 0 2px var(--color-accent-dim)` + accent border on
  all interactive elements via `:focus-visible`
- **Color + shape:** State must be communicated by at least two signals — color alone
  is insufficient. Rail color is supplemented by label text or icon change.
- **Contrast floors:** Text quaternary (`#847c82`) is the minimum for any readable
  text on `#09090b`. Accent-bright colors in each preset and custom scheme meet at
  least 4.5 : 1 on the charcoal canvas. Presets use black `--on-accent`; custom
  accents choose black or white according to the stronger fill contrast.
- **Reduced motion:** Animations that flash or pulse (e.g., critical reminder overlay)
  include a `@media (prefers-reduced-motion: reduce)` override.
- Clickable non-button elements need semantic ARIA roles and keyboard handlers.

---

## Layout Tokens

| Token                           | Value                  |
| ------------------------------- | ---------------------- |
| `--sidebar-width-collapsed`     | 136 px / 64 px compact |
| `--header-height`               | 56 px                  |
| `--space-1` … `--space-12`      | 4 px … 64 px           |
| `--radius-sm` … `--radius-pill` | 6 px … 9999 px         |
| `--z-dropdown`                  | 100                    |
| `--z-overlay`                   | 1000                   |
| `--z-popover`                   | 5000                   |
| `--z-modal`                     | 9999                   |
| `--z-window-controls`           | 10001                  |
| `--z-command-palette`           | 10002                  |
| `--z-critical`                  | 20000                  |

### Compact workstation windows

At viewport widths of 1200 px and below, Relay keeps every navigation destination available but
reduces the main sidebar to a 64 px icon rail, changes the brand to `r.`, and hides the world clock.
Labels remain available through accessible names and hover tooltips. This returns horizontal space
to the active workflow without creating a second navigation mode.

The Dynatrace Problems workspace switches from its queue/detail split to a single stacked column at
900 px and below. Its Service Desk ticket control and primary local-disposition action also become
full-width so they remain usable around half of a 1080p display.
