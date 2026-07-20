# Cloud Status Outage and Toast Priority Design

## Problem

Relay's Status workspace currently gives outages, degraded notices, informational updates, and resolved history similar visual weight. It includes three feed modes, search, provider filtering, social links, and per-item expansion even though operators primarily need to know whether a monitored vendor is reporting an outage.

Cloud Status notifications also treat both outages and degraded notices as toast-worthy. Those toasts share an unprioritized stack with Dynatrace Problem notifications, so a secondary vendor update can compete with Relay's primary operational signal.

## Goals

- Make the Status workspace answer two questions quickly: whether any monitored vendor is reporting an outage and which outage needs attention.
- Keep monitored-provider coverage explicit so an empty outage queue cannot be mistaken for missing data.
- Notify for newly arriving vendor outages only.
- Keep every newly opened Dynatrace Problem toast-worthy, regardless of Dynatrace severity.
- Guarantee that Dynatrace Problem toasts appear before cloud-outage toasts without losing the cloud alert.
- Preserve Relay's precise, dark, scan-friendly command-console visual language.

## Non-goals

- Changing provider polling, server snapshot persistence, severity classification, or shared Cloud Status schemas.
- Removing warning, informational, or resolved records from server data or the local cache.
- Changing the Dynatrace Problems workspace, API sync, alerting-profile filters, or problem lifecycle.
- Suppressing routine success, error, or informational toasts elsewhere in Relay.
- Adding a notification center, historical notification log, user-configurable priorities, or desktop operating-system notifications.

## Selected UX

The Status workspace becomes **External outages**. It removes the Active, Recent, and Resolved tabs, shared search control, provider selection/filtering, social profile actions, Downdetector actions, and collapsed incident rows.

When one or more outages exist, the workspace uses the selected coverage-plus-outage-queue layout:

- The left rail lists all monitored providers.
- Providers with at least one `error` item are ordered first and labeled `Outage`.
- Providers whose feed failed are ordered next and labeled `Unknown`.
- All remaining providers retain their configured order and are labeled `No outage`.
- Each provider keeps one restrained link to its official status page.
- The right pane lists only `error` items, newest first.
- Outage title, provider, publication time, sanitized description, and official source action are visible without expansion.

When there are no outage items, the workspace uses a quieter all-clear surface. It says `No reported outages`, shows the monitored-provider count, and retains a compact list of provider names. The wording deliberately avoids `All services normal`, because degraded notices may exist in the underlying snapshot but are intentionally outside this workspace's scope.

If any provider feeds are unavailable, Relay retains the existing warning notice and marks those providers `Unknown`. The all-clear headline becomes `No reported outages from available feeds` so missing feeds cannot be interpreted as proof of health.

The header retains last-updated time and manual refresh. The status bar reports monitored-provider count and active-outage count only.

## Cloud Status Notification Behavior

`useAppCloudStatus` continues to consume the server-owned realtime snapshot and cache it locally. Its notification behavior changes as follows:

1. Restore cached `error` item IDs into the active-outage-ID set. Hidden severities do not enter this set.
2. Treat the first usable snapshot from either realtime delivery or manual refresh as a silent baseline when no cache was restored. Existing outages therefore do not replay as new alerts on startup.
3. On subsequent snapshots and explicit refreshes, consider only `error` items whose IDs are absent from the active-outage-ID set.
4. Batch simultaneous new outage items into one cloud-outage toast, preserving the current primary-item plus `(+N more)` summary pattern.
5. Replace the active-outage-ID set with the current snapshot's `error` item IDs after processing.
6. An item that escalates from warning to outage therefore notifies once. An outage that downgrades, resolves, or disappears leaves the set and can notify again if it later reopens.

Warnings, informational notices, and resolved updates never create cloud-status toasts.

## Dynatrace Notification Behavior

`DynatraceProblemNotificationManager` keeps its current silent initial baseline, 250 ms batching window, severity-based primary-problem ordering, sound, eight-second duration, and `Open Problems` action.

Every newly arriving record with `status === 'OPEN'` remains eligible. This includes availability, monitoring-unavailable, error, performance, resource-contention, custom-alert, and informational Dynatrace severities. The manager marks these toasts as Dynatrace operational notifications so the toast provider can prioritize them.

## Operational Toast Queue

`ToastOptions` gains a typed delivery classification with three values:

- `routine` is the default and preserves existing application-toast behavior.
- `cloud-outage` enters the lower-priority operational lane.
- `dynatrace-problem` enters the higher-priority operational lane.

The Toast provider owns one operational lane in addition to routine toasts. Only one operational toast is visible at a time.

- A cloud-outage toast displays immediately when no operational toast is active.
- A cloud-outage toast arriving while Dynatrace is active waits in FIFO order.
- A Dynatrace Problem toast arriving while a cloud outage is visible preempts it. Relay cancels the cloud timer, returns the cloud toast to the front of its queue, and displays Dynatrace.
- Additional Dynatrace Problem batches queue ahead of all cloud outages in their own arrival order.
- After the Dynatrace queue drains, the interrupted or waiting cloud outage displays with its full configured duration. Queue time never consumes display time.
- Closing or activating a toast action advances the operational queue immediately.
- Routine toasts remain available. When routine and operational toasts coexist, the active operational toast renders first in the container, ensuring Dynatrace remains visually primary.

Operational toasts retain their existing semantic presentation: error-level messages use assertive live-region behavior, while non-error Dynatrace severities retain polite warning behavior. Preemption changes delivery order, not the toast's content, type, action, or accessibility semantics.

## Component Boundaries

- `CloudStatusTab.tsx` owns outage-only presentation, provider posture, exact copy, source actions, ordering, and responsive layout.
- `useAppCloudStatus.ts` owns snapshot baselining, item-ID deduplication, outage-only notification selection, and cloud-toast delivery classification.
- `DynatraceProblemNotificationManager.tsx` owns Dynatrace collection baselining, batching, content, sound, action, and Dynatrace delivery classification.
- `Toast.tsx` owns operational priority, preemption, queue activation, visible-duration timers, closing transitions, routine-toast coexistence, and cleanup.
- Server cloud-status aggregation and shared snapshot types remain unchanged.

This keeps source-specific eligibility close to each source while centralizing cross-source delivery order in the only component that can coordinate all toasts.

## Edge Cases and Cleanup

- Provider feed failures never count as outages and never trigger a cloud toast.
- A snapshot containing warnings and outages counts and displays only the outages.
- Multiple outages received in one snapshot create one queued cloud toast.
- Repeated outage snapshots do not duplicate notifications for active outage IDs.
- A warning that escalates to an outage notifies; an outage that resolves and later reopens can notify again.
- Unmounting the Toast provider clears active, closing, and queued timers.
- Unmounting the Dynatrace manager clears its batching timer as today.
- A preempted cloud toast retains its action and message and restarts with a full duration after Dynatrace clears.
- Reduced-motion behavior remains intact; queue transitions use the existing toast open/close motion rather than adding choreography.
- Responsive layout stacks coverage above the outage queue on narrow windows. The all-clear provider list wraps without horizontal scrolling.

## Verification

Use red-green TDD for each behavior slice.

- `CloudStatusTab.test.tsx` covers outage-only counts and rows, hidden warning/info/resolved records, `No outage`, `Unknown`, provider ordering, precise all-clear copy, unavailable-feed copy, official source actions, and removed filters/search/social links.
- `useAppCloudStatus.test.ts` covers silent cached and uncached startup baselines, warning suppression, warning-to-outage escalation, resolved-and-reopened outages, new-outage batching, deduplication, and the `cloud-outage` delivery classification.
- `DynatraceProblemNotificationManager.test.tsx` covers every open Dynatrace severity, existing batching/action/sound behavior, and the `dynatrace-problem` delivery classification.
- `Toast.test.tsx` covers cloud FIFO delivery, Dynatrace-first ordering, active-cloud preemption, full-duration resume, multiple Dynatrace batches ahead of cloud, manual dismissal, action-driven advancement, routine-toast coexistence, accessibility roles, and timer cleanup.
- Existing App and responsive-shell tests confirm the Status route and retained-tab behavior remain intact.

Run the focused renderer tests after each slice, then the complete relevant renderer/unit suites, type checking, linting, formatting checks, and the production build before claiming completion.
