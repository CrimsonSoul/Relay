# Signal Sans — Relay UI Redesign

## Overview

Redesign Relay's visual identity from the current dark+amber template aesthetic to the "Signal Sans" direction. This applies to all tabs. The Alerts tab gets updated chrome (toolbar, status bar) but its alert-specific components (AlertCard, AlertForm styling) remain unchanged.

### Goals
- Eliminate "AI slop" feel (generic dark+amber, uniform cards, no personality)
- Readable at two distances: 55" 1080p TV from 8ft **and** 24" 1080p monitor at desk
- Approachable for cross-team users who craft alerts — not just power users
- Look good on both macOS and Windows
- Add new UI features surfaced during design exploration (status bars, etc.)

### Constraints
- **Alert card/form styling preserved** — AlertCard rendering and AlertForm visual design stay as-is; tab chrome (toolbar, status bar) gets Signal Sans treatment
- Both display targets are 1080p, so CSS pixel counts are identical — size for the harder case (TV distance)
- Must work cross-platform (no macOS-only visual dependencies)

---

## Design System Changes

### Typography

| Token | Current | New |
|-------|---------|-----|
| `--font-family-base` | Space Grotesk Variable | **Instrument Sans** |
| `--font-family-mono` | JetBrains Mono | JetBrains Mono (unchanged) |

Instrument Sans is a clean, friendly sans-serif that reads well at distance and doesn't feel "techy" or intimidating to non-engineers. JetBrains Mono stays for code, phone numbers, timestamps, and shift times.

### Type Scale (TV-Ready)

All sizes use `clamp()` as today, but with higher floors:

| Token | Current Range | New Range | Usage |
|-------|--------------|-----------|-------|
| `--text-2xs` | 11–14px | **12–14px** | — |
| `--text-xs` | 13–16px | **13–15px** | Status bar, metadata labels |
| `--text-sm` | 14–18px | **14–16px** | Secondary info, tags, buttons, filters |
| `--text-base` | 16–20px | **16–18px** | Body text, emails, detail line 2 |
| `--text-lg` | 20–27px | **18–22px** | Names, card titles |
| `--text-xl` | — | **20–24px** | Toolbar titles, section headers |

### Color Palette

Replace amber-centric palette with signal red + multi-accent system:

**Backgrounds** (slightly warmer blacks):

| Token | Current | New |
|-------|---------|-----|
| `--color-bg-app` | `#060608` | `#070810` |
| `--color-bg-surface` | `#0c0e12` | `#0c0e15` |
| `--color-bg-card` | `#0e1016` | `#0c0e15` (same as surface) |
| `--color-bg-card-hover` | `#181d26` | `#10131b` |
| `--color-bg-surface-elevated` | `#12161c` | `#151821` |
| `--color-bg-sidebar` | `#080a0e` | `#0c0e15` (same as surface) |

**Text** (unchanged, already good):

| Token | Value |
|-------|-------|
| `--color-text-primary` | `#eef0f6` (slightly brighter) |
| `--color-text-secondary` | `#6e7a90` |
| `--color-text-tertiary` | `#374058` |

**Primary Accent** — Signal Red replaces Amber:

| Token | Current (Amber) | New (Signal) |
|-------|-----------------|--------------|
| `--color-accent` | `#f59e0b` | `#e11d48` |
| `--color-accent-hover` | `#fbbf24` | `#be123c` |
| `--color-accent-text` | — | `#fb7185` |
| `--color-accent-dim` | `rgba(245,158,11,0.5)` | `rgba(225,29,72,0.10)` |
| `--color-accent-subtle` | `rgba(245,158,11,0.1)` | `rgba(225,29,72,0.05)` |

**Group/Category Colors** (multi-accent, used for tags, avatars, team dots):

| Name | Color | Dim | Usage |
|------|-------|-----|-------|
| Signal (red) | `#e11d48` / `#fb7185` | `rgba(225,29,72,0.10)` | Primary groups, OPS |
| Blue | `#38bdf8` | `rgba(56,189,248,0.10)` | Field, secondary groups |
| Purple | `#c084fc` | `rgba(192,132,252,0.10)` | HQ, tertiary groups |
| Orange | `#fb923c` | `rgba(251,146,60,0.10)` | Security, warnings |
| Cyan | `#22d3ee` | `rgba(34,211,238,0.10)` | Info, network |
| Green | `#10b981` | `rgba(16,185,129,0.10)` | Online, resolved, success |
| Yellow/Warn | `#eab308` / `#fbbf24` | `rgba(234,179,8,0.10)` | Degraded, caution |
| Danger | `#ef4444` | `rgba(239,68,68,0.10)` | Destructive actions |

**Borders** (unchanged approach, slightly adjusted):

| Token | Value |
|-------|-------|
| `--border-default` | `rgba(255,255,255,0.055)` |
| `--border-subtle` | `rgba(255,255,255,0.03)` |

### Dot Pattern

**Remove the amber dot scatter pattern entirely.** The `--chrome-pattern`, `--surface-pattern`, and `.card-surface` background patterns are part of the "AI slop" feel. Replace with clean flat surfaces. The design gets its texture from typography hierarchy, color-coded elements, and spatial composition instead.

### Border Radius

Slightly rounder to feel friendlier:

| Token | Current | New |
|-------|---------|-----|
| `--radius-sm` | 6px | 6px |
| `--radius-md` | 10px | **8px** |
| `--radius-lg` | 14px | **12px** |
| `--radius-xl` | 20px | **14px** |

### Shadows

Simplify shadow system — rely less on glow effects:

| Token | Notes |
|-------|-------|
| `--shadow-card` | `0 8px 32px rgba(0,0,0,0.3)` — on hover only |
| `--shadow-modal` | Keep existing but remove amber glow component |

---

## Component Changes

### Contact Entries (Compose, Directory)

Replace the current single-line ContactCard with a **two-line entry** layout:

```
[Avatar] Name          [TAG]
         email · title · phone
```

- **Avatar**: 44px rounded square (border-radius: 10-12px), initials, colored by group
- **Line 1**: Name (18px bold) + group tag pill
- **Line 2**: Email · Title · Phone separated by midpoint dots (14px, secondary color)
- **Row height**: ~72px (including 14px padding top/bottom)
- **Remove button**: Hidden by default, appears on hover as a 32px rounded square with × icon
- Color-coded per group (avatar background + tag use same dim color)

### Sidebar (Group Selection)

- **Checkboxes**: 20px rounded squares (border-radius: 5px) with SVG checkmark icon when checked
- Checked state: filled with signal red, white checkmark
- **Group items**: Two-line layout — group name (16px 600) + contact count subtitle (13px muted)
- **Active state**: Subtle red glow background + 3px red left border
- **Footer**: Stats section — total contacts, selected count (in signal red), last bridge time

### Toolbar

- Title: 20px bold
- Badge: Recipient count in signal-red pill (14px bold, 8px border-radius)
- Buttons: Instrument Sans 14px 600, 1px border, 8px border-radius, 9px vertical / 20px horizontal padding
- Primary button: Signal red background, white text
- All button labels are full words ("Copy All" not "CPY", "Draft Bridge" not "DRAFT")

### Status Bar (NEW)

Add a bottom status bar to all tabs:

- Height: ~40px
- Background: surface color, top border
- Left: Connection status with animated green pulse dot + "Connected" / "Synced"
- Center: Context-specific info (keyboard shortcuts on Compose, filter counts on Directory, etc.)
- Right: Summary stats ("38 of 96 selected", "5 providers monitored", etc.)
- Font: 13px, muted color

### Buttons (TactileButton)

- Border-radius: **8px** (up from current varying sizes)
- Font: Instrument Sans (not monospace)
- Sizes adjusted for TV readability:
  - Default: padding 9px 20px, font 14px
  - Small: padding 7px 16px, font 13px
- Primary variant: signal red background
- Ghost variant: transparent with border, dim text, hover brightens

### Tags/Pills

- Font: 12px bold, 0.8px letter-spacing, uppercase
- Padding: 3px 10px
- Border-radius: 6px
- Color-coded per group using dim backgrounds with matching text

### Avatars

- Size: 44px (list entries), 64px (detail panels)
- Shape: Rounded square (border-radius: 10px list, 14px detail)
- Initials: 16px bold (list), 22px bold (detail)
- Color: Group-color dim background + group-color text

---

## Tab-Specific Changes

### Compose Tab
- Switch to two-line contact entries (described above)
- Add status bar with connection status + keyboard shortcuts + selection count
- Sidebar uses new checkbox style with two-line group items + footer stats
- Toolbar uses new button/badge styles
- Remove dot pattern from all surfaces

### Personnel Tab (On-Call Board)
- Team cards: 12px border-radius, surface background, border
- Card header: Team name with color-coded dot (10px, 3px border-radius square), team count
- Person rows within cards: 36px avatar, name (16px 600), role (13px dim), shift time (13px mono, right-aligned)
- Add status bar: "Synced" + last updated + team/person count
- Week range displayed below toolbar

### Directory Tab
- Two-line contact rows matching Compose pattern
- Search bar: full-width, 16px text, signal-red focus border
- Filter toggle buttons: active state uses signal-dim background + signal-text color
- Detail panel on right (320px): avatar, name, fields, group pills, action buttons
- Add status bar: connection + showing X of Y + active filter count

### Status Tab (Cloud Status)
- Provider summary cards in responsive grid: name (17px bold) + status dot (12px, colored) + detail text
- Event feed: severity badge (color-coded pill) + title (16px bold) + description + provider/service + timestamp (mono)
- Filter buttons for providers
- Add status bar: auto-refresh indicator + last updated + provider count

### Notes Tab
- Apply new card styling (remove dot pattern, use new border/radius)
- Tag pills use new color system
- Font size controls stay

### Servers Tab
- Same two-line row pattern as Directory
- Detail panel mirrors Directory detail panel
- Apply new color system to tags

### Radar Tab
- Minimal changes — just update toolbar/chrome styling

### Weather Tab
- Uses its own font family (Avenir Next) — keep that
- Update toolbar and any shared chrome elements to new style

---

## New Features

### Status Bar
Added to all tabs. Shows:
- Connection/sync status with animated indicator
- Tab-specific contextual information
- Summary statistics

### Enhanced Sidebar Stats
Group selection sidebar now shows:
- Total contact count
- Selected count (highlighted in accent color)
- Last bridge timestamp

---

### Alerts Tab
- **Alert card styling (AlertCard, AlertForm) is NOT changed** — the visual design of alert composition and preview is preserved exactly as-is
- The Alerts tab **can** receive: new toolbar button styles, status bar, updated chrome/layout elements consistent with the rest of the app
- Essentially: the alert-specific components keep their current look, but the surrounding tab shell (toolbar, layout chrome) gets the Signal Sans treatment

---

## Excluded from Scope

- **Alert card / form visual design** — AlertCard rendering, AlertForm field styling, severity colors, and alert preview remain unchanged
- **Weather tab font** — keeps Avenir Next / Segoe UI
- **Animations/transitions** — keep existing transition tokens, no changes needed
- **Accessibility** — keep existing focus styles but update amber outline to signal red outline
- **Data/logic** — no changes to hooks, services, or state management

---

## Cross-Platform Notes

- Instrument Sans is a Google Font loaded via `@import` — renders identically on macOS and Windows
- JetBrains Mono is already loaded the same way
- No `-webkit-` prefixed properties that lack Windows equivalents
- Scrollbar styling uses `::-webkit-scrollbar` — works in Electron's Chromium on both platforms
- Border-radius, box-shadow, and all CSS features used are standard and cross-platform
- Font rendering: `-webkit-font-smoothing: antialiased` on macOS, Windows uses its own ClearType — both look good with these font choices
