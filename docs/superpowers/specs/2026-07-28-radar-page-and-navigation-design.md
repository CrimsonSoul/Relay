# Dispatcher Radar Page and Navigation Design

**Status:** Approved design

**Date:** 2026-07-28

**Surface:** Relay desktop app, Radar navigation item, and Dispatcher Radar tab

## Job and audience

Relay operators use Radar during active operations to answer two questions at once:

1. What is the overall XCenter and service condition?
2. Which dispatcher or queue needs attention?

The surface must support a fast balanced scan without hiding exact queue data or
turning Radar into a generic dashboard-card grid. Radar remains desktop-only
because it depends on the Electron session and corporate SSO cookie.

## Approved direction

The approved page is **Direction C: Dispatcher Lanes**, modified so the
operational health rail sits on the **left** of the dispatcher lanes.

The full composition is:

1. Relay's existing application navigation at the far left.
2. A Radar health rail containing XCenter, PaPA, service metrics, and the
   dashboard clock.
3. Dispatcher lanes using the remaining flexible width.

The health rail provides a stable snapshot. The lanes provide detail and receive
most of the available space.

## Radar navigation item

The Radar navigation item must retain the same footprint as every other
navigation item:

- Full shell: existing `120px × 56px` button footprint.
- Compact shell: existing `56px × 48px` button footprint.
- The standard Relay accent rail continues to mean **active tab**.
- Radar health is represented by one small semantic-color dot.
- Do not add a health-colored background wash or a health-colored full rail.
- Show both XCenter counts beneath or beside the Radar label/icon.

The dot uses the existing Radar tones:

- Green: Healthy
- Yellow: Warning
- Red: Critical
- Magenta: Attention
- Neutral gray: Unknown

Color is reinforcement only. The tooltip and accessible name must include the
status word and exact counts.

### Compact count format

The visible navigation counts use a compact format in both full and collapsed
shells:

- Values below 1,000 remain exact: `936`.
- Values at or above 1,000 use compact notation with at most one decimal:
  `1,807` becomes `1.8k`.
- Whole compact values omit an unnecessary decimal: `2,000` becomes `2k`.
- Normal compact rounding is allowed: `9,999` becomes `10k`.
- A missing count is shown as `—`.

The full item separates values with spaces (`2k · 1.8k`). The collapsed item
removes the spaces (`2k·1.8k`). The exact values remain available in the
tooltip, accessible name, and Radar page.

## Radar page

### Header

The existing Relay page header remains recognizable:

- `RADAR` context label
- `Dispatcher Radar` title
- Overall state expressed with a text label and semantic dot
- Dashboard refresh action

The dashboard clock belongs in the health rail. The header should not repeat it.

### Left health rail

The rail appears before the dispatcher lanes visually and in DOM order. It
contains:

1. XCenter OK and Pending counts, shown exactly with tabular numerals.
2. PaPA message types and depths.
3. Service metrics with their source-provided tones and values.
4. Dashboard clock and stale/update context.

Section rules and spacing create hierarchy. The rail is not a stack of rounded
cards.

### Dispatcher lanes

Each dispatcher is a semantic section containing:

- Source-provided dispatcher tone and name
- Last schedule timestamp
- Last pub/sub timestamp
- Queue name and exact depth
- A clear `No queues reported` state when appropriate

Queue names may be long dotted identifiers. They truncate visually when space
is constrained, while the complete name remains available through native text
selection or a tooltip.

Raw queue depths do not receive inferred warning or critical colors. Only
source-provided tones may assign semantic color. This avoids inventing
thresholds Relay does not own.

## Responsive behavior

The approved left-to-right structure applies to both Relay navigation modes:

- Full application sidebar
- Compact application sidebar

The health rail stays on the left while the Radar content area has enough width
for readable dispatcher lanes. It may narrow within defined limits, while lane
names truncate safely.

At the app's extreme narrow-window range, when a left rail would leave
insufficient room for a usable dispatcher lane, the health rail converts to a
full-width summary above the lanes. This is a safety fallback, not the normal
desktop composition. It must not cause horizontal page overflow.

Responsive behavior should be driven by the Radar content width rather than
assuming the application sidebar is always expanded.

## Loading, authentication, and failure states

### Refreshing

- Change the refresh label to `REFRESHING`.
- Disable repeated refresh activation.
- Keep the last good snapshot visible.
- Do not replace the board with a spinner.

### Sign-in required

- Show the existing session-expired notice and `SIGN IN` action near the page
  header.
- Keep the last good snapshot visible when one exists.
- Do not present the retained snapshot as freshly updated.

### Fetch or parse error

- Show the existing error message with a clear stale-data indication.
- Preserve the last good snapshot and last successful update time.
- Do not show a healthy status merely because retained data exists.

### No usable snapshot

- Show dashes for unavailable XCenter counts.
- Show one focused unavailable/empty message in the lane area.
- Keep PaPA and service sections structurally stable without fabricating rows.

## Interaction boundaries

This redesign does not add sorting, filtering, queue expansion, queue
thresholds, charts, historical trends, or new actions. Radar remains a
read-only current snapshot with refresh and sign-in recovery.

The redesign does not change:

- Radar polling
- SSO session behavior
- Parser behavior
- IPC payloads
- Existing client/server compatibility
- Relay Web's desktop-only Radar boundary

## Accessibility

- Overall, dispatcher, and metric states pair color with text.
- The Radar navigation accessible name includes the exact XCenter values and
  status word even when visible values are compact.
- Focus and active states remain distinct from health state.
- All numeric data uses tabular numerals.
- Dispatcher sections, timestamps, queues, and service metrics retain semantic
  headings/list or description-list structure.
- Reduced motion requires no special branch because the approved design adds no
  decorative animation.

## Implementation scope

Expected implementation targets are limited to the existing Radar and sidebar
surface:

- `src/renderer/src/tabs/RadarTab.tsx`
- `src/renderer/src/tabs/radar.css`
- `src/renderer/src/components/sidebar/SidebarButton.tsx`
- `src/renderer/src/components/sidebar/sidebar.css`
- Focused Radar and sidebar tests

No PocketBase, main-process Radar parser, preload, IPC contract, or Relay Web
change is required.

## Verification requirements

Focused coverage must verify:

- Compact count formatting for `null`, `0`, `999`, `1,000`, `1,807`, `2,000`,
  and `9,999`.
- Exact counts and status words remain in the navigation accessible name.
- Full and collapsed navigation modes show both counts and one status dot.
- The Radar item has no health wash or health-colored rail.
- The normal active-tab accent remains.
- The health rail precedes dispatcher lanes in DOM order.
- Long queue names do not force horizontal page overflow.
- No-queue, refreshing, sign-in-required, error, and empty-snapshot states.
- Existing Radar data and refresh/sign-in actions remain intact.

Repository-wide completion still requires the Relay verification gates in
`AGENTS.md`, including Electron integration coverage because the surface is
desktop-only.

## Out of scope

- Radar data or parser changes
- New status thresholds
- Historical charts or trend storage
- Relay Web availability
- Changes to other sidebar items
- Changes to the global Relay visual identity
