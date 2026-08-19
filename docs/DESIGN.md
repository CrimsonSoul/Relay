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
| `src/renderer/src/styles/tab-chrome.css`                     | Shared top-level page headers and command rows                        |
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

### Top-level tab chrome

Compose is the visual reference for the seven top-level operational destinations. Each uses a
three-band frame: `.tab-page-header`, an optional named `.tab-command-bar`, and the working canvas.
`TabPageHeader`, `TabCommandBar`, and `TabCommandGroup` own this shared structure; tab styles remain
responsible for their domain content.

- Page metadata uses the UI font, tabular numerals, and a text label whenever color communicates
  status. Live state uses the shared unboxed `.tab-page-status` treatment: an 8 px semantic dot
  beside the text label. Metadata may wrap below the title at constrained widths but must never
  overlap it.
- Utility commands belong in the left group and use a 36 px control height. Workflow commands
  belong in the right group and use a 40 px control height. Toolbars keep both groups on one row
  while their content fits, then wrap without changing DOM or keyboard order. The compact layout
  makes each group full width only at 720 px and below.
- Command labels use Title Case. A command row has at most one filled primary action; supporting
  and reversible actions remain secondary or icon-only with an accessible name.
- Knowledge has no top-level commands, so it renders no empty command row.
- This contract applies only to the outer tab frame. Nested pane, editor, table, PDF, filter, and
  other domain-specific toolbars retain their own interaction and density rules.

### Service Status provider rows

Service Status remains an operational coverage list, not a generic vendor dashboard. Its overview
keeps one scannable row per operator-facing provider, ordered by outage, unknown, degraded, then
operational. Juniper Mist is one row even though the server retains four regional buckets for
compatibility; Dynatrace, Proofpoint, and CrowdStrike are also one row each. The summary, provider
count, keyboard order, and status bar use the displayed fourteen-provider list rather than the raw storage bucket
count.

Selecting Juniper Mist uses the existing provider-detail workspace with compact `All`, `Global`,
`EMEA`, `APAC`, and `Federal` filters. Each filter includes accessible posture text. `All` is the
default and deduplicates incidents shared by multiple regions; an `Affected` line lists the union of
published regions. Selecting a region filters those incidents and uses that region's own outage,
unknown, degraded, or operational posture. Dynatrace uses the same `Affected` treatment for its
cloud and region containers. Affected scopes are text, not color-only signals or a new card layer.

CrowdStrike is visibly marked `Third-party` in its overview row and detail workspace because its
automated signal comes from StatusGator rather than CrowdStrike. The source action says
`StatusGator`; a separate `Official support` action goes to CrowdStrike. Incident actions say
`View StatusGator report` and must not imply official confirmation. Downdetector remains a manual
secondary link, never an automated health input.

An active outage outranks feed uncertainty in the visible posture. Feed uncertainty outranks a
retained degradation, so an old warning cannot be presented as current after a failed refresh. With
no active outage, an unavailable or incomplete feed reads Unknown and retains any last-good detail
without implying it is current. Juniper Mist, Dynatrace, Proofpoint, and CrowdStrike use the same
row geometry, focus return, responsive behavior, and accessible status text as every other provider;
the regional filter introduces no modal or nested navigation.

Workflow actions state only outcomes Relay can observe. Compose may say it opened a Teams draft or
copied recipients, but not that Teams created or sent a meeting. Alerts follows the same rule for
Outlook and downloaded drafts. Destructive and externally consequential actions retain confirmation
or review steps owned by their feature.

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

Search results label the action they perform. A primary row or Enter opens the exact record,
document, workspace, or tab without changing unrelated Compose state. Actions that do change the
bridge, such as Add group or a contact's `+ Bridge` control, remain separate and have explicit
accessible names. Keyboard hints describe only actions available for the active result.

### Persistent release update indicator (`.release-update-indicator`)

When packaged desktop Relay discovers a newer normal release, the global header action area shows a
compact `TactileButton` before the world clock. Wide and full-screen layouts use a concise state
label: `Update`, `Downloading`, `Install`, `Installing`, `Restart`, or `Update issue`, followed by
`· vX.Y.Z`. At the existing 1200 px compact-shell breakpoint and below, the state label contracts to
`vX.Y.Z`. The version always comes from the latest validated release response and changes when a
later release is discovered. Its accessible name includes both the version and current action.

The indicator uses a static accent dot, accent-bright text, a restrained accent tint, the standard
2 px control radius, and the shared focus treatment. It does not pulse, glow, use ambient
attention-seeking animation, use warning or alarm colors, or offer a dismiss or snooze action; it
retains the ordinary hover and press feedback of a `TactileButton`. Clicking it opens Relay's fixed
**Update Relay** dialog when the desktop updater bridge is present. Older builds fall back to the
fixed GitHub Releases page. The control remains visible on every tab until the installed version is
current; a transient refresh failure or repeated same-version check does not erase a previously
confirmed update or manual progress.

The dialog uses the standard modal shell and a single three-stage line for Download, Install, and
Restart. It names the current stage, shows bounded byte progress during download, explains the
immutable-GitHub and SHA-256 trust model, and discloses that publisher signing is not included.
Buttons name the exact next action. Download, install, and restart are never combined; cancellation
is offered only while downloading, and installation temporarily prevents dismissal while the
Windows bootstrap prepares the runtime. **View on GitHub** remains a secondary action throughout
the flow, including download, preparation, restart-ready, and error states. Mutable releases replace
installation controls with that review action. Failures name what failed and present only a valid recovery such as **Retry download**,
**Retry install**, **Check again**, or **Retry restart**.

The compact label must remain visible when the sidebar rests at 64 px. It may not shrink, wrap,
overlap the centered search control or platform window controls, or disappear with the world clock.
At 720 px and below, the breadcrumb and search shortcut badge yield space while the search field
remains shrinkable, preserving the indicator through Relay's 400 px desktop window minimum.
At 520 px and below, modal footer actions stack at full width while the three-stage line remains a
single readable row. The one-time toast announces each newly discovered version with **Review
update**; the persistent control itself is not a repeatedly announced live region. Relay Web and
pop-out windows do not render it.

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

The card's base font rides `--font-family-base` and therefore uses IBM Plex Sans. The fenced rules
remain part of the exported-content contract.

### Operator action hierarchy

Alerts keeps History in the utility group and exposes one delivery primary action: Open in Outlook
on Desktop or Download Draft in Relay Web. Save Image remains a visible secondary action; lower
frequency actions stay in the keyboard-accessible overflow. Optional delivery details remain
collapsed until requested.

---

## 11. Knowledge Workspace

Knowledge is the single sidebar destination for the Wiki, Contacts, and Servers surfaces. The app
header always identifies the outer route as `Relay / Knowledge`; the workspace's own navigation
identifies the active inner destination.

- Launcher and keyboard order is exactly **Wiki, Contacts, Servers**. Each destination is a real
  button with a production-shaped preview, an explicit unknown-count state, and responsive
  three/two/one-column layout that preserves DOM order.
- Destinations mount on first use and remain retained. Navigation preserves selected records,
  filters, reader position, and local scroll state; opening an exact search result may reveal that
  record but does not change bridge recipients.
- Notes remain contextual to Contacts, Servers, or Problems. Relay has no standalone Notes
  workspace.
- The Wiki reader defaults to Continuous and offers Single page. Mode changes preserve the open
  document, page, and PDF lifetime; bounded rendering, reduced-motion behavior, and page-local retry
  states keep long documents usable without replacing the whole reader.
- Internal PDF destinations stay in Relay. Approved HTTP(S) links require an explicit action and
  open through the validated system-browser boundary.

---

## 12. Styling Rules

### Compact navigation

At widths at or below 1200 px, the sidebar rests at 64 px and expands labeled navigation above the
content on hover or keyboard focus; the active tab never reflows. The overlay remains open while
either pointer or focus is inside the rail, and reduced-motion mode removes its width animation.
Top-level shortcuts follow sidebar order through Cmd/Ctrl+7 for Radar. While Problems is active,
Alt+Down and Alt+Up move through unaddressed problems and Alt+N focuses the selected response note;
editable controls and modals suppress these triage shortcuts.

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

## 13. Accessibility Baseline

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
rests the main sidebar at a 64 px icon rail, changes the brand to `r.`, and hides the world clock.
Hovering the rail or moving keyboard focus into it expands the full labels over the active workflow
without changing the content width; accessible names and hover tooltips remain available as
fallbacks.

The Dynatrace Problems workspace switches from its queue/detail split to a single stacked column at
900 px and below. Its Service Desk ticket control and primary local-disposition action also become
full-width so they remain usable around half of a 1080p display.
