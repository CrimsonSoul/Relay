# Radar Queue Notifications and Sidebar Indicator Design

- **Date:** 2026-07-29
- **Status:** Approved

## Goal

Simplify the Radar navigation item so it uses the same geometry and visual rhythm as Relay's
other primary tabs, while adding focused toast notifications when any of three operational
Radar targets transition into the dashboard's red state:

- `prod01`
- `prod02`
- `Transactional Emails Queue Depth`

Relay will use the source dashboard's semantic colors. It will not infer new queue-depth
thresholds from numeric values.

## Scope

This change is limited to the desktop renderer's Radar navigation indicator and in-app toast
notifications. It does not change the Radar parser, polling interval, IPC contract, PocketBase,
Relay Web, system notifications, or alert sounds.

## Sidebar Indicator

The Radar tab will return to the same single-row layout, height, spacing, and icon/label
alignment as the other primary tabs.

- Remove the visible XCenter count row in both full and compact sidebar modes.
- Keep one small semantic status pip.
- Position the pip within the standard tab geometry rather than using a Radar-specific grid.
- Preserve the normal Relay accent rail as the active-tab signal.
- Use the current Radar tone for fresh snapshots.
- Use the neutral/unknown pip when the snapshot is unavailable, stale, requires sign-in, or
  carries a refresh error.
- Keep the health label and exact XCenter counts in the tooltip and accessible name. Counts
  remain available without occupying persistent sidebar space.
- Continue pairing every color with text in the accessible name so color is not the only status
  signal.

The status-capable sidebar button remains reusable, but its status payload no longer needs
visible `detail` or `compactDetail` content.

## Notification Architecture

Add a dedicated desktop renderer notification manager alongside the existing Dynatrace
notification manager. It will subscribe to the shared Radar snapshot and use Relay's existing
toast context.

This keeps notification state independent of:

- whether the Radar tab is currently open;
- whether the sidebar is expanded or compact;
- repeated component mounting inside the Radar page; and
- navigation presentation details.

The manager will be inactive in Relay Web and popout windows.

## Tracked Targets

The manager identifies the targets from fresh Radar snapshots:

- Dispatcher names matching `prod01` or `prod1`, case-insensitively.
- Dispatcher names matching `prod02` or `prod2`, case-insensitively.
- A service metric whose normalized label is `Transactional Emails Queue Depth`.

For each target, Relay reads the existing `tone` supplied by the Radar dashboard. A target is
critical only when that tone is exactly `red`.

## Transition and Deduplication Rules

1. The first fresh, usable Radar snapshot establishes a silent baseline. Relay does not toast
   for targets that are already red when the application starts.
2. A later transition from any explicit non-red tone to `red` produces an alert.
3. Repeated red snapshots and manual refreshes do not produce duplicate alerts.
4. A target re-arms only after a later fresh snapshot reports an explicit non-red tone.
5. A missing target is unknown, not recovered. Removing a target from a snapshot does not
   re-arm it.
6. Snapshots with `lastUpdated === 0`, `signInRequired`, or `error` are ignored for transition
   detection.
7. When multiple targets transition to red in the same snapshot, Relay emits one combined
   toast listing all affected targets.

## Toast Presentation

The toast uses Relay's error styling and operational queue:

- Singular title: `Radar queue critical`
- Plural title: `Radar queues critical`
- Message: a concise list of the affected target names
- Duration: 8 seconds
- Action: `Open Radar`, which switches the main window to the Radar tab
- Sound: none

## Operational Toast Priority

The operational queue will use this exact order:

1. Dynatrace Problems
2. Radar critical queues
3. Cloud outages
4. Cloud degradation
5. Routine toasts

A Radar toast interrupts and queues a currently visible cloud toast. A Dynatrace Problem
interrupts Radar. Interrupted operational toasts remain queued and resume according to the
existing toast lifecycle instead of being discarded.

## Error and Stale-State Handling

Stale or failed Radar updates retain their existing page-level recovery UI but cannot create or
clear notification transitions. This prevents network errors, expired SSO sessions, or missing
dashboard markup from producing false recovery and repeat-alert cycles.

The sidebar status pip becomes neutral during these states, with the tooltip/accessibility label
reporting stale or unavailable status. Retained XCenter values may remain in that descriptive
text but are not presented as current visual figures.

## Testing

Focused renderer tests will cover:

- no visible count row in full or compact sidebar markup;
- the Radar button using the normal tab footprint and alignment;
- one semantic status pip with fresh, stale, and unavailable snapshots;
- retained health and exact XCenter information in the tooltip and accessible name;
- silent initial baseline, including an initially red target;
- individual Prod01, Prod02, and Transactional Emails transitions into red;
- one combined toast when multiple targets turn red together;
- no duplicate toast while a target remains red;
- recovery followed by a later red transition;
- missing targets not counting as recovery;
- stale, errored, sign-in-required, and pre-initial snapshots being ignored;
- `Open Radar` navigation;
- the priority order Dynatrace, Radar, cloud outage, cloud degradation, then routine;
- Dynatrace preemption and Radar preemption of cloud toasts; and
- wide and compact Electron sidebar layout contracts.

Before completion, Relay's required typecheck, lint, formatting, unit, renderer, build, audit,
diff, and Electron verification gates will run on the committed implementation.
