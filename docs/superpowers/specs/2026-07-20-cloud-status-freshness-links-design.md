# Cloud Status Freshness and Provider Links Design

## Problem

The outage-focused Status workspace currently treats every Cloud Status item with `severity === 'error'` as active, regardless of age. RSS providers retain historical items and do not expose a reliable lifecycle identifier, so old records from March and April can appear as active outages in July. The redesign also removed the provider X and Downdetector actions that operators still use to validate vendor reports.

## Goals

- Treat only recent outage records as current operational signals.
- Use one freshness rule for Status presentation and cloud-outage toast eligibility.
- Restore each provider's configured official Status, X, and Downdetector actions.
- Preserve the compact outage-focused layout and provider coverage posture.
- Keep raw server snapshots and provider parsers unchanged.

## Current-Outage Rule

A Cloud Status item is a current outage only when all of the following are true:

1. `severity === 'error'`.
2. `pubDate` parses to a valid timestamp.
3. The timestamp is no more than seven rolling days old at evaluation time.

Invalid dates and records older than seven days are not current outages. Future-dated records remain eligible so ordinary provider clock skew does not suppress a real outage.

The seven-day window is defined once in renderer Cloud Status logic and reused by both `CloudStatusTab` and `useAppCloudStatus`. The raw snapshot continues to retain warning, informational, resolved, and historical records.

## Status Workspace Behavior

The External outages workspace continues to show only current outages. Provider posture, provider ordering, headline counts, outage rows, and status-bar counts all derive from the same current-outage selector.

- A provider with at least one current outage is labeled `Outage`.
- A provider whose feed failed is labeled `Unknown` unless it has a current outage.
- A provider with only stale error records is labeled `No outage`.
- Stale records are not displayed in the active outage queue.
- The all-clear and unavailable-feed copy remains unchanged.

Each provider coverage entry restores external validation actions:

- `Status` opens the configured official status page.
- The configured X handle opens `https://x.com/<handle>` and is omitted when no handle exists.
- `Downdetector` opens the provider's configured Downdetector page.

The actions are present in both the active-outage provider list and the no-outage coverage view. Each action has a complete accessible name containing the provider and destination. The all-clear coverage entries are no longer implemented as one large status-page button because that would prevent separate nested actions.

## Cloud Toast Behavior

`useAppCloudStatus` applies the same current-outage rule when restoring cached IDs, establishing the first usable baseline, finding new outage IDs, and replacing the active ID set.

- Stale error records never generate a cloud toast.
- A snapshot containing only stale error records is a silent no-outage baseline.
- A current outage still notifies once when it first appears after the baseline.
- Existing warning-to-outage, resolution/reopen, batching, and Dynatrace-priority behavior remains unchanged.

The toast rule evaluates freshness from the item's publication timestamp rather than the snapshot timestamp, preventing an old feed item from becoming new merely because Relay refreshed or persisted the snapshot.

## Component Boundaries

- A small renderer Cloud Status utility owns the seven-day constant and current-outage predicate.
- `CloudStatusTab.tsx` consumes the predicate for presentation, counts, posture, and ordering, and restores provider actions.
- `useAppCloudStatus.ts` consumes the predicate for cache baselining, new-outage detection, and active-ID tracking.
- Shared IPC types, main-process providers, snapshot persistence, and the toast priority queue remain unchanged.

## Error Handling and Edge Cases

- Invalid `pubDate` values fail closed and do not appear or alert as outages.
- The seven-day boundary is inclusive.
- Provider feed failures remain `Unknown`; stale errors do not override that posture.
- Providers without an X handle show Status and Downdetector only.
- Existing external-URL allowlisting already permits official provider pages, `x.com`, and `downdetector.com`.
- The current five-minute Cloud Status refresh naturally ages an item out without adding a separate UI timer.

## Verification

Use red-green TDD.

- Utility tests cover current errors, the inclusive seven-day boundary, stale errors, invalid dates, and non-error severities.
- `CloudStatusTab.test.tsx` proves stale errors are absent from rows, posture, ordering, and counts while a recent outage remains visible.
- Status tests prove official Status, configured X, and Downdetector actions open the expected URLs in active and all-clear coverage views, including omission of an unavailable X action.
- `useAppCloudStatus.test.ts` proves stale errors do not enter the baseline or create toasts and that a current new outage still produces the existing `cloud-outage` delivery classification.
- Run the focused Status and hook tests, the complete relevant renderer suite, type checking, linting, formatting checks, the Impeccable detector, and the production build.
