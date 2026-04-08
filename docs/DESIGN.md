# Relay Design Guide

Current visual and interaction conventions for the Relay renderer.

## Overview

Relay uses a token-driven design system defined in `src/renderer/src/styles/theme.css`.
The current UI is built around:

- A responsive light/dark theme with `system`, `light`, and `dark` preferences
- A red primary accent (`--color-accent`) with cyan reserved for secondary or informational use
- Shared surface, border, spacing, and typography tokens consumed by plain CSS
- Reusable interaction primitives such as `TactileButton`, `.tactile-input`, and `.card-surface`

The active theme is applied by `src/renderer/src/hooks/useTheme.ts`, which writes the resolved theme to `document.documentElement.dataset.theme`.

## Source Of Truth

Use these files as the implementation references:

| File                                     | Purpose                                                               |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `src/renderer/src/styles/theme.css`      | Global color, spacing, typography, radius, z-index, and motion tokens |
| `src/renderer/src/styles/components.css` | Shared button, input, shell, and layout styles                        |
| `src/renderer/src/styles/utilities.css`  | Shared utility classes such as `.card-surface` and `.accent-strip`    |
| `src/renderer/src/styles/modals.css`     | Modal layout and overlay styling                                      |
| `src/renderer/src/styles/responsive.css` | Breakpoints and responsive behavior                                   |
| `src/renderer/src/styles/animations.css` | Reusable animation helpers                                            |
| `src/renderer/src/tabs/alerts.css`       | Alert composer and preview styles                                     |
| `src/renderer/src/tabs/notes/notes.css`  | Notes masonry, cards, and editor styles                               |
| `src/renderer/src/tabs/cloud-status.css` | Provider summary cards and incident feed styles                       |

## Theme Tokens

### Color System

Primary UI colors come from `theme.css`:

- Backgrounds: `--color-bg-app`, `--color-bg-surface`, `--color-bg-surface-elevated`, `--color-bg-card`
- Text: `--color-text-primary`, `--color-text-secondary`, `--color-text-tertiary`
- Accent: `--color-accent`, `--color-accent-hover`, `--color-accent-subtle`, `--color-accent-dim`
- Semantic: `--color-danger`, `--color-accent-green`, `--color-warning`
- Borders: `--color-border`, `--color-border-strong`, `--color-border-accent`

The default theme is dark. Light mode overrides are defined under `[data-theme='light']` in the same file.

### Typography

- Base UI font: `--font-family-base` (`Instrument Sans Variable`)
- Monospace font: `--font-family-mono` (`JetBrains Mono`)
- Responsive font sizes: `--text-2xs` through `--text-4xl`
- Shared weights: `--weight-regular` through `--weight-black`

Prefer the tokens instead of raw font sizes or weights.

### Layout Tokens

Relay standardizes spacing and shell sizing through tokens such as:

- `--space-1` through `--space-12`
- `--radius-sm` through `--radius-2xl`
- `--sidebar-width-collapsed`
- `--header-height`
- `--z-*` layers for overlays, modals, window controls, and command surfaces

## Core UI Patterns

### Buttons

Use `src/renderer/src/components/TactileButton.tsx` for button interactions.

Supported variants:

- `primary`
- `secondary`
- `ghost`
- `danger`

Supported sizes:

- `sm`
- `md`

The component also supports `active`, `loading`, `icon`, and `block` states.

### Inputs

Text inputs should use the shared `.tactile-input` styling from `components.css`.

Expected behavior:

- Full-width layout by default
- Elevated surface on hover/focus
- Accent border and glow on focus

### Cards And Surfaces

Use `.card-surface` from `utilities.css` for reusable card styling.

It provides:

- Shared surface background
- Standard border and radius
- Hover border/background transitions

Use `.accent-strip` when a card needs a thin colored indicator on the left edge.

### Shell Layout

The app shell is composed of:

- Left sidebar navigation
- Top header with breadcrumb, search, and utility actions
- Tab content area

Most tabs follow one of these patterns:

- A single-column content layout
- A split layout with a main list and a detail panel
- A specialized layout such as the Notes masonry grid or the Alerts two-panel composer

## Feature-Specific Notes

### Alerts

`src/renderer/src/tabs/alerts.css` mixes app-theme surfaces for authoring with a forced light preview card for screenshot/export fidelity.

Key conventions:

- Severity buttons use per-severity color states
- The preview card uses a white email-style canvas regardless of app theme
- Highlighting and event-time affordances are styled as alert-specific primitives rather than global tokens

### Notes

`src/renderer/src/tabs/notes/notes.css` uses a masonry layout and color-tinted note cards.

Key conventions:

- Font size is controlled via `data-font-size` on the notes grid
- Note colors are lightweight surface tints, not full theme changes
- Drag-and-drop state is communicated through border, opacity, and lift changes

### Cloud Status

`src/renderer/src/tabs/cloud-status.css` uses plain surfaces instead of heavier card treatments.

Key conventions:

- Provider cards summarize health at a glance
- Severity is communicated with status dots, text color, and badges
- Filters are compact pill buttons styled with the shared token palette

## Styling Rules

### Do

- Use tokens from `theme.css` instead of hardcoded shared values
- Prefer shared classes and components before adding one-off patterns
- Keep styles in the existing CSS files unless a feature already owns its own stylesheet
- Use `:focus-visible` for keyboard focus states
- Keep dynamic runtime styling limited to cases that truly need inline values

### Don't

- Don't document or reintroduce the older amber-only or dark-only visual system
- Don't add Tailwind, CSS modules, or CSS-in-JS to new renderer code
- Don't hardcode common spacing, radii, or colors that already exist as tokens
- Don't add custom button patterns when `TactileButton` already fits the use case

## Inline Style Exceptions

Inline styles are acceptable when the value is produced at runtime, for example:

- `react-window` row positioning
- `@dnd-kit` transform values
- Dynamic CSS custom properties
- Per-entity accent colors derived in TypeScript

Static design values should stay in CSS.

## Accessibility

Renderer styles should preserve the existing accessibility baseline:

- Keyboard focus must remain visible
- Clickable non-button elements need semantic roles and keyboard handlers
- Color should reinforce state, not be the only indicator

Use the current renderer components as the pattern reference when adding new UI.
