# Relay Design System

Visual language, component patterns, and implementation rules for the Relay UI.

## Table of Contents

- [Theme Overview](#theme-overview)
- [Color System](#color-system)
- [Typography](#typography)
- [Spacing & Layout](#spacing--layout)
- [The Dot Pattern](#the-dot-pattern)
- [Component Catalog](#component-catalog)
- [Animation & Motion](#animation--motion)
- [Styling Rules](#styling-rules)
- [Adding New Components](#adding-new-components)

---

## Theme Overview

Relay uses a **dark-only** theme with **amber accents** on near-black backgrounds. The signature visual element is a **layered dot-scatter pattern** rendered via CSS `radial-gradient` that appears on chrome surfaces (sidebar, header) at full intensity and on content surfaces (cards, panels, modals, toolbars) at ~55% intensity.

Key principles:

- **Dark and quiet** — backgrounds are near-black (#060608 → #0c0e12), never gray
- **Amber is the only brand color** — all interactive accents, focus rings, and highlights use the amber palette
- **Dot pattern = Relay DNA** — the coprime-grid dot scatter ties all surfaces together
- **No competing colors** — semantic colors (red/green/cyan) are used sparingly and only for their specific meaning
- **Subtle borders** — borders are white at very low opacity (0.06–0.16), never solid colors

---

## Color System

All colors are defined as CSS custom properties in `theme.css`. Never use raw hex/rgba values in components — always reference tokens.

### Backgrounds

| Token                         | Value     | Usage                                       |
| ----------------------------- | --------- | ------------------------------------------- |
| `--color-bg-app`              | `#060608` | Root app background                         |
| `--color-bg-surface`          | `#0c0e12` | Content area background                     |
| `--color-bg-surface-elevated` | `#12161c` | Elevated elements (hover states, dropdowns) |
| `--color-bg-card`             | `#0e1016` | Card resting state                          |
| `--color-bg-card-hover`       | `#181d26` | Card hover state                            |
| `--color-bg-sidebar`          | `#080a0e` | Sidebar background                          |
| `--color-bg-chrome`           | `#080a0e` | Header and chrome surfaces                  |

### Text

| Token                     | Value     | Usage                         |
| ------------------------- | --------- | ----------------------------- |
| `--color-text-primary`    | `#f0f2f7` | Headings, primary content     |
| `--color-text-secondary`  | `#94a3b8` | Labels, descriptions          |
| `--color-text-tertiary`   | `#64748b` | Hints, placeholders, metadata |
| `--color-text-quaternary` | `#475569` | Disabled text, watermarks     |

### Accent — Amber

| Token                   | Value                  | Usage                                  |
| ----------------------- | ---------------------- | -------------------------------------- |
| `--color-accent`        | `#f59e0b`              | Primary accent (buttons, links, icons) |
| `--color-accent-hover`  | `#fbbf24`              | Hover state for accent elements        |
| `--color-accent-dim`    | `rgba(245,158,11,0.5)` | Muted accent (inactive indicators)     |
| `--color-accent-subtle` | `rgba(245,158,11,0.1)` | Accent backgrounds (selected states)   |

### Secondary Accent — Cyan

| Token                             | Value                 | Usage                                    |
| --------------------------------- | --------------------- | ---------------------------------------- |
| `--color-accent-secondary`        | `#06b6d4`             | Informational/navigational elements only |
| `--color-accent-secondary-subtle` | `rgba(6,182,212,0.1)` | Cyan background tint                     |

Use cyan sparingly — it exists only for informational callouts, never for primary actions.

### Semantic Colors

| Token                         | Value                  | Usage                       |
| ----------------------------- | ---------------------- | --------------------------- |
| `--color-danger`              | `#ef4444`              | Destructive actions, errors |
| `--color-danger-hover`        | `#f87171`              | Danger hover state          |
| `--color-danger-subtle`       | `rgba(239,68,68,0.12)` | Danger background tint      |
| `--color-accent-green`        | `#22c55e`              | Success states              |
| `--color-accent-green-subtle` | `rgba(34,197,94,0.12)` | Success background tint     |
| `--color-warning`             | `#f59e0b`              | Warning (same as accent)    |

### Borders

| Token                                      | Value                    | Usage                      |
| ------------------------------------------ | ------------------------ | -------------------------- |
| `--color-border-subtle`                    | `rgba(255,255,255,0.07)` | Default card/panel borders |
| `--color-border` / `--color-border-medium` | `rgba(255,255,255,0.1)`  | Standard separators        |
| `--color-border-strong`                    | `rgba(255,255,255,0.16)` | Emphasized borders         |
| `--color-border-accent`                    | `rgba(245,158,11,0.3)`   | Accent-tinted borders      |

Shorthand tokens are also available: `--border-subtle`, `--border-medium`, `--border-strong` (include `1px solid`).

### Shadows

| Token            | Usage                                         |
| ---------------- | --------------------------------------------- |
| `--shadow-xs`    | Subtle depth (small elements)                 |
| `--shadow-sm`    | Cards at rest                                 |
| `--shadow-md`    | Elevated cards, dropdowns                     |
| `--shadow-lg`    | Toasts, popovers                              |
| `--shadow-xl`    | Large floating panels                         |
| `--shadow-modal` | Modal containers (includes white border glow) |

---

## Typography

### Font Families

| Token                   | Font                   | Usage                      |
| ----------------------- | ---------------------- | -------------------------- |
| `--font-family-base`    | Space Grotesk          | All UI text                |
| `--font-family-mono`    | JetBrains Mono         | Code, technical values     |
| `--font-family-weather` | Avenir Next / Segoe UI | Weather tab forecast grids |

### Font Size Scale

Sizes use `clamp()` for viewport-responsive scaling (designed for both 24" desk monitors and 55" TV displays at 1080p):

| Token         | Range   | ~1920px |
| ------------- | ------- | ------- |
| `--text-2xs`  | 11–14px | ~13px   |
| `--text-xs`   | 13–16px | ~15px   |
| `--text-sm`   | 14–18px | ~17px   |
| `--text-base` | 16–20px | ~20px   |
| `--text-md`   | 18–23px | ~23px   |
| `--text-lg`   | 20–27px | ~27px   |
| `--text-xl`   | 24–32px | ~32px   |
| `--text-2xl`  | 28–40px | ~40px   |
| `--text-3xl`  | 34–50px | ~50px   |
| `--text-4xl`  | 42–62px | ~62px   |

### Font Weights

| Token                | Value | Usage               |
| -------------------- | ----- | ------------------- |
| `--weight-regular`   | 400   | Body text           |
| `--weight-medium`    | 500   | Labels              |
| `--weight-semibold`  | 600   | Section headings    |
| `--weight-bold`      | 700   | Card names, buttons |
| `--weight-extrabold` | 800   | Header breadcrumb   |

### Letter Spacing

| Token               | Value   | Usage                               |
| ------------------- | ------- | ----------------------------------- |
| `--tracking-tight`  | -0.02em | Large display text                  |
| `--tracking-normal` | 0       | Body text                           |
| `--tracking-wide`   | 0.04em  | Labels                              |
| `--tracking-wider`  | 0.08em  | Sidebar labels                      |
| `--tracking-widest` | 0.12em  | Header breadcrumb, uppercase labels |

---

## Spacing & Layout

### Spacing Scale

| Token        | Value |
| ------------ | ----- |
| `--space-1`  | 4px   |
| `--space-2`  | 8px   |
| `--space-3`  | 12px  |
| `--space-4`  | 16px  |
| `--space-5`  | 24px  |
| `--space-6`  | 32px  |
| `--space-8`  | 40px  |
| `--space-10` | 52px  |
| `--space-12` | 64px  |

### Border Radius

| Token            | Value  | Usage                      |
| ---------------- | ------ | -------------------------- |
| `--radius-sm`    | 6px    | Small chips, tags          |
| `--radius-md`    | 10px   | Cards, inputs, buttons     |
| `--radius-lg`    | 14px   | Sidebar items, panels      |
| `--radius-xl`    | 20px   | Modals                     |
| `--radius-2xl`   | 28px   | Large containers           |
| `--radius-pill`  | 9999px | Pill badges                |
| `--radius-round` | 50%    | Avatars, circular elements |

### Z-Index Scale

| Token                 | Value | Usage                  |
| --------------------- | ----- | ---------------------- |
| `--z-base`            | 1     | Lifted card elements   |
| `--z-dropdown`        | 100   | Dropdowns, comboboxes  |
| `--z-sticky`          | 500   | Sticky headers         |
| `--z-overlay`         | 1000  | Tooltips, overlays     |
| `--z-popover`         | 5000  | Popovers               |
| `--z-modal`           | 9999  | Modals                 |
| `--z-window-controls` | 10001 | Window chrome buttons  |
| `--z-command-palette` | 10002 | Command palette        |
| `--z-critical`        | 20000 | Modal overlays, toasts |

### Layout Constants

| Token                       | Value |
| --------------------------- | ----- |
| `--sidebar-width-collapsed` | 110px |
| `--header-height`           | 56px  |

### L-Shaped Chrome

The app uses an **L-shaped chrome** layout: the sidebar runs the full height of the left edge, and the header spans the top of the content area (right of sidebar). Both share the same `--chrome-bg` background with `--chrome-pattern` dot overlay. The content area fills the remaining space.

```
┌──────┬──────────────────────────────┐
│      │  Header (chrome + dots)      │
│ Side │──────────────────────────────│
│ bar  │                              │
│      │  Content Area                │
│(chrome│                             │
│+ dots)│                             │
│      │                              │
└──────┴──────────────────────────────┘
```

---

## The Dot Pattern

The signature Relay visual is a **layered amber dot scatter** created with three `radial-gradient` layers at coprime grid spacings. This pushes the visible repeat distance far beyond viewport bounds, creating a pseudo-random appearance.

### Chrome Pattern (sidebar, header)

```css
--chrome-pattern:
  radial-gradient(circle, rgba(245, 158, 11, 0.08) 1px, transparent 1px),
  radial-gradient(circle, rgba(245, 158, 11, 0.06) 0.8px, transparent 0.8px),
  radial-gradient(circle, rgba(245, 158, 11, 0.05) 0.6px, transparent 0.6px);
--chrome-pattern-size: 29px 29px, 37px 37px, 47px 47px;
--chrome-pattern-position: 0 0, 13px 19px, 7px 31px;
```

### Surface Pattern (cards, panels, modals, toolbars)

Same structure at ~55% opacity:

```css
--surface-pattern:
  radial-gradient(circle, rgba(245, 158, 11, 0.045) 1px, transparent 1px),
  radial-gradient(circle, rgba(245, 158, 11, 0.035) 0.8px, transparent 0.8px),
  radial-gradient(circle, rgba(245, 158, 11, 0.028) 0.6px, transparent 0.6px);
--surface-pattern-size: 29px 29px, 37px 37px, 47px 47px;
--surface-pattern-position: 0 0, 13px 19px, 7px 31px;
```

### Applying the Pattern

Use the `.card-surface` utility class (defined in `utilities.css`) which applies the surface pattern automatically:

```css
.card-surface {
  background-color: var(--color-bg-card);
  background-image: var(--surface-pattern);
  background-size: var(--surface-pattern-size);
  background-position: var(--surface-pattern-position);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
```

For custom surfaces that aren't cards, apply the pattern tokens directly:

```css
.my-panel {
  background-color: var(--color-bg-card);
  background-image: var(--surface-pattern);
  background-size: var(--surface-pattern-size);
  background-position: var(--surface-pattern-position);
}
```

### Which Surfaces Get the Dot Pattern?

| Surface                                | Pattern                                 | Intensity |
| -------------------------------------- | --------------------------------------- | --------- |
| Sidebar                                | `--chrome-pattern`                      | Full      |
| Header                                 | `--chrome-pattern`                      | Full      |
| Cards (contact, server, team, on-call) | `--surface-pattern` via `.card-surface` | 55%       |
| Detail panels                          | `--surface-pattern`                     | 55%       |
| Toolbars / CollapsibleHeader           | `--surface-pattern`                     | 55%       |
| Modals                                 | `--surface-pattern`                     | 55%       |
| Command palette                        | `--surface-pattern`                     | 55%       |
| Toasts                                 | None                                    | —         |
| Content area background                | None                                    | —         |
| Dropdowns / Combobox menus             | None                                    | —         |

---

## Component Catalog

### TactileButton

The primary button component. All buttons in the app should use `TactileButton`.

**Variants** (passed via `variant` prop):

| Variant   | Look                        | Usage                           |
| --------- | --------------------------- | ------------------------------- |
| (default) | Dark chrome bg, white text  | Secondary actions               |
| `primary` | Solid amber bg, black text  | Primary/CTA actions             |
| `ghost`   | Transparent, secondary text | Tertiary actions, toolbar icons |
| `danger`  | Red-tinted bg, red border   | Destructive actions             |

**Sizes**: default (44px), `sm` (34px), `md` (48px)

**States**:

- Hover: lift -1px, brighter bg, shadow
- Active: scale(0.98), no lift
- Focus: 3px amber outline (via `:focus-visible`)
- Active/selected: amber subtle bg + amber text (`.is-active`)

### Cards

All list item cards use the `.card-surface` base class for the dot pattern, with a colored `.accent-strip` on the left edge.

**ContactCard**: Name, email, title, phone, group pills, notes indicator. Used in Directory and Assembler virtual lists.

**ServerCard**: Server name, business area, LOB, OS badge with platform color. The OS badge and accent strip color are dynamic per-server (computed from `getPlatformColor`).

**TeamCard**: On-call team card with drag handle, role assignments, time windows. Used on the On-Call Board grid.

**Card interaction**:

```css
.card-surface:hover {
  background-color: var(--color-bg-card-hover);
  border-color: rgba(255, 255, 255, 0.1);
}
```

Selected cards use a `--selected` modifier class that adds an amber left border and subtle amber background wash.

### CollapsibleHeader

Tab headers that collapse to a compact toolbar when the user scrolls. Two states:

- **Expanded**: Shows title (h1, amber, uppercase, extrabold) + subtitle + action buttons
- **Collapsed**: Compact single row with just action buttons

Apply the surface pattern to the header for visual continuity with the chrome.

### Detail Panel

Right-side info panel (280px) showing full details of a selected contact or server. Uses `.card-surface` styling. Hidden on viewports < 900px.

### Modal

Centered overlay with blur backdrop. Structure:

```
.modal-overlay        — fixed fullscreen, rgba(0,0,0,0.42) + blur(24px)
  .modal-container    — max-width 520px, surface pattern bg, radius-xl, shadow-modal
    .modal-header     — chrome bg, icon + title + subtitle
    .modal-body       — content area
    .modal-footer     — action buttons
```

The modal icon wrapper uses amber bg tint: `rgba(245,158,11,0.15)` with `--color-accent` text.

### Toast

Bottom-right notifications. Elevated surface bg, medium border, left color stripe:

| Variant   | Left border color      |
| --------- | ---------------------- |
| `error`   | `--color-danger`       |
| `success` | `--color-accent-green` |
| `info`    | `--color-accent`       |

### Tooltip

Appears above the trigger element on hover. Chrome bg, medium border, 8px 14px padding, small radius, heavy shadow. Animates in with opacity + translateY.

### Sidebar

Collapsed icon-based navigation (110px wide). Each `SidebarItem` shows an icon with an amber active indicator dot. The sidebar label pills use per-item dynamic colors from `getColorForString()`.

The sidebar app icon at the top shows the Relay chain-link symbol in amber.

### SearchInput

Full-width search with magnifying glass icon. Uses `.tactile-input` styling. Focus state adds amber border + amber glow ring:

```css
border-color: var(--color-accent);
box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
```

### GroupPill

Small colored pill showing group membership. Colors are dynamically generated per-group from `getColorForString()`. These are the **only** elements that use non-amber dynamic colors — this is intentional for visual differentiation of groups.

### Avatar

40×40px circle with initials. Uses amber color scheme:

- Background: `rgba(245, 158, 11, 0.15)`
- Text: `#FCD34D`
- Border: `1px solid rgba(245, 158, 11, 0.3)`

### Command Palette

Overlay search dialog (z-index 10002). Surface pattern bg, amber-highlighted matches, keyboard-navigable result list.

---

## Animation & Motion

### Transition Tokens

| Token                  | Duration | Easing              | Usage                          |
| ---------------------- | -------- | ------------------- | ------------------------------ |
| `--transition-micro`   | 0.1s     | ease-out            | Button press, instant feedback |
| `--transition-fast`    | 0.12s    | ease-out (material) | Hover states                   |
| `--transition-base`    | 0.2s     | ease-out (material) | Standard transitions           |
| `--transition-smooth`  | 0.3s     | ease-out (expo)     | Panel transitions              |
| `--transition-bouncy`  | 0.4s     | overshoot           | Playful reveals                |
| `--transition-premium` | 0.6s     | ease-out (expo)     | Page-level animations          |

### Available Animations

| Class                       | Effect                       | Usage              |
| --------------------------- | ---------------------------- | ------------------ |
| `.animate-fade-in`          | Opacity 0→1                  | General entrance   |
| `.animate-slide-down`       | Slide from -8px + fade       | Dropdown reveals   |
| `.animate-scale-in`         | Scale 0.96→1 + fade          | Modal entrance     |
| `.animate-card-entrance`    | Slide up 12px + scale + fade | Card list entrance |
| `.animate-spin`             | Continuous rotation          | Loading spinners   |
| `.animate-active-indicator` | Pulse scale + opacity        | Active state dot   |

### Staggered Entrance

Apply `.stagger-children` to a parent and `.animate-card-entrance` to children. The parent auto-applies `animation-delay` increments of 50ms to child elements (up to 10 children).

### Reduced Motion

All animations respect `prefers-reduced-motion: reduce` — durations collapse to 0.01ms.

---

## Styling Rules

### Do

- Use CSS custom properties from `theme.css` for all colors, spacing, typography, and radii
- Use `.card-surface` for any card-like element that needs the dot pattern
- Use `.tactile-button` variants for all interactive buttons
- Use `.tactile-input` for all text inputs
- Put new styles in the appropriate file (`components.css`, `modals.css`, etc.)
- Use BEM-like naming: `.component-name`, `.component-name--modifier`, `.component-name-child`
- Apply `transition: all var(--transition-base)` or equivalent for hover/state changes
- Use `:focus-visible` for focus styles (3px amber outline, 3px offset)

### Don't

- Don't use inline styles for static values — move them to CSS classes
- Don't use Tailwind, CSS modules, or CSS-in-JS — this is vanilla CSS with tokens
- Don't hardcode colors — always use `var(--color-*)` tokens
- Don't introduce new accent colors — amber is the brand, cyan is informational, red/green are semantic
- Don't skip the dot pattern on surfaces that should have it (see table above)
- Don't use `z-index` values outside the defined scale
- Don't add rounded corners to the app shell itself — only internal elements have border radius

### When Inline Styles Are Acceptable

Some values must remain inline because they are **dynamic at runtime**:

| Scenario                      | Example                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| react-window `style` prop     | Virtual list row positioning (height, top, position)         |
| AutoSizer dimensions          | `height={height}`, `width={width}`                           |
| DnD Kit transforms            | `transform: translate3d(...)` from useSortable               |
| Per-entity dynamic colors     | `getColorForString()` output for group pills, sidebar labels |
| CSS custom property injection | `style={{ '--some-var': value }}`                            |

Everything else should be a CSS class.

---

## Adding New Components

### Checklist

1. **Color**: Use only `var(--color-*)` tokens. No raw hex values.
2. **Background**: If the component is a card/panel/toolbar, apply the surface pattern (use `.card-surface` or apply the tokens directly).
3. **Typography**: Use `var(--text-*)` for font sizes, `var(--weight-*)` for weights, `var(--font-family-*)` for families.
4. **Spacing**: Use `var(--space-*)` tokens for padding/margins/gaps.
5. **Radius**: Use `var(--radius-*)` tokens. Cards use `--radius-md` (10px). Modals use `--radius-xl` (20px).
6. **Borders**: Use `var(--border-*)` shorthand or `var(--color-border-*)` with explicit width.
7. **Shadows**: Use `var(--shadow-*)` tokens.
8. **Transitions**: Use `var(--transition-*)` tokens.
9. **Focus**: Amber `:focus-visible` outline is applied globally — don't override it.
10. **Buttons**: Use `TactileButton` component, not custom button elements.
11. **Accessibility**: Add `role`, `tabIndex`, `onKeyDown` (Enter/Space) to clickable non-button elements.
12. **CSS file**: Add styles to the relevant file in `src/renderer/src/styles/`.
13. **Naming**: Use BEM-like class names scoped to the component.

### Example: Adding a New Card Type

```tsx
// MyCard.tsx
import React, { memo } from 'react';

export const MyCard = memo(({ name, style, selected, onRowClick }: MyCardProps) => (
  <div
    role={onRowClick ? 'button' : undefined}
    tabIndex={onRowClick ? 0 : undefined}
    onClick={onRowClick}
    onKeyDown={
      onRowClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onRowClick();
            }
          }
        : undefined
    }
    className="my-card"
    style={style} /* Only for react-window positioning */
  >
    <div className={`my-card-body card-surface${selected ? ' my-card-body--selected' : ''}`}>
      <div className="accent-strip" style={{ background: 'var(--color-accent)' }} />
      <div className="my-card-info">
        <span className="my-card-name text-truncate">{name}</span>
      </div>
    </div>
  </div>
));
```

```css
/* In components.css */
.my-card {
  padding: 4px 16px;
}

.my-card-body {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px 12px 20px;
  /* .card-surface provides: bg, pattern, border, radius, hover, transition */
}

.my-card-body--selected {
  border-left: 3px solid var(--color-accent);
  background-color: var(--color-accent-subtle);
}

.my-card-name {
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  color: var(--color-text-primary);
}
```

---

## File Reference

| File                                                | Purpose                                                    |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `src/renderer/src/styles/theme.css`                 | All design tokens (colors, spacing, typography, patterns)  |
| `src/renderer/src/styles/components.css`            | Component styles (buttons, inputs, cards, sidebar, panels) |
| `src/renderer/src/styles/modals.css`                | Modal overlay, container, header, body, footer             |
| `src/renderer/src/styles/animations.css`            | Keyframes and animation utility classes                    |
| `src/renderer/src/styles/utilities.css`             | `.card-surface`, text utilities, hover utilities           |
| `src/renderer/src/styles/toast.css`                 | Toast notification styles                                  |
| `src/renderer/src/styles/responsive.css`            | Breakpoints, grid layouts, reduced motion, `.sr-only`      |
| `src/renderer/src/styles/app-icon.css`              | App icon specific styles                                   |
| `src/renderer/src/utils/colors.ts`                  | `getColorForString()` — deterministic color generation     |
| `src/renderer/src/components/shared/PersonInfo.tsx` | `getPlatformColor()` — OS-based color mapping              |
