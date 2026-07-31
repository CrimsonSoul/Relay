# Relay Web Feature Parity Design

**Date:** 2026-07-31

**Status:** Approved for implementation planning

**Scope:** Relay Web import reliability, Dispatcher Radar availability, and a bounded desktop-to-Web feature-parity audit

## Problem

Relay Web is intended to reuse Relay's shared renderer and operational workflows, but two current behaviors break that expectation:

1. Data Manager file selection can return `null` after a user selects a valid file. The hidden file input treats the browser window's focus return as cancellation after a zero-delay timer. When the focus event wins the race against the input's `change` event, the valid selection is discarded and the modal reports a generic import failure without parsing or writing the file.
2. Dispatcher Radar is explicitly removed from Relay Web. The sidebar filters out the Radar item, the browser bridge returns a synthetic desktop-only error snapshot, Radar notifications are mounted only for Electron, and the Relay Web support documentation omits Radar. The main process already owns a continuously refreshed `RadarManager` snapshot that can be shared without exposing CW Dashboard cookies.

The Web runtime also needs a deliberate parity audit so later desktop features cannot silently remain hidden, stubbed, or inert in Relay Web without an approved device-specific reason.

## Goals

- Make supported-browser file selection reliable in Relay Web.
- Keep user cancellation neutral rather than reporting it as a failure.
- Show live processed/total progress and outcome counts during large imports.
- Preserve Relay's existing row-isolated, sequential upsert semantics and row-level errors.
- Restore Radar navigation, page content, refresh, status, and queue notifications in Relay Web.
- Share the Relay server PC's existing Radar snapshot without exposing or proxying CW SSO credentials.
- Audit the shared UI and browser bridge for accidental parity gaps.
- Update the canonical Relay Web, architecture, and security documentation to match the implemented boundary.

## Approved parity boundary

Every shared operational feature is expected to work in Relay Web unless it depends on one of these approved device-specific capabilities:

- PocketBase backup, restore, and backup retention controls
- Server/client connection setup and reconfiguration
- Offline cache reads, queued offline mutations, and offline file caching
- Native window controls and Electron popout management
- Custom local reminder/alarm-file selection
- Image clipboard capture
- Restart-persistent Wiki upload queues and local file reselection recovery

Those exclusions remain explicit capability gates. They must not produce visible but inert controls. Radar is no longer an approved desktop-only exclusion.

## Approaches considered

### Shared parity path with a narrow Radar Web API — selected

Keep imports on the shared renderer-to-PocketBase path, add progress to the shared import service, and expose only the main-process-owned Radar snapshot through authenticated Relay Web routes. This preserves one import implementation and introduces the smallest new Web trust surface.

### Web-only batch import and Radar proxy

A server-side Web import endpoint could reduce browser request count, but it would duplicate parsing, upsert, error, and validation behavior. It would create a second import contract and a larger browser-only mutation surface. This is not justified by the current failure.

### Point fixes only

Increasing the picker delay and showing the Radar item without a real data route would leave behavior fragile and incomplete. It would also fail the requested parity audit.

## Data Manager design

### File selection

Move browser file selection into a small testable helper with an explicit result contract. The input's `change` and `cancel` events are authoritative. A focus-return fallback may resolve cancellation only after a bounded grace period and only if neither authoritative event has settled the request and the input still has no selected file.

The helper must:

- accept `.json`, `.csv`, and `.xlsx` files;
- enforce the existing 25 MiB limit before reading;
- read text and `ArrayBuffer` content once;
- clean up its input, listeners, and timer on every terminal path;
- distinguish cancellation from a read or size error; and
- allow a delayed `change` event to win after the browser window regains focus.

The Data Manager modal treats cancellation as no-op. It shows a failure only for an actual picker, read, parse, connectivity, or import error.

### Import progress

Add an optional progress callback to the shared bulk-upsert path and thread it through JSON, CSV, and Excel imports into `useDataManager`.

Progress contains:

- `processed`: records that reached a terminal created, updated, or errored state;
- `total`: parsed records scheduled for upsert;
- `imported`: successfully created records;
- `updated`: successfully updated records; and
- `errors`: the number of accumulated parse and row errors.

Progress begins after parsing establishes the total and updates after each row. Writes remain sequential to preserve predictable load, duplicate-name behavior, and row ordering. A failed row is recorded and later rows continue. Successful earlier writes are not rolled back; the final result accurately reports partial success.

The Import panel shows `Processed X of Y` with imported, updated, and error counts while work is active. The existing final result retains row-level messages and the compact first-errors-plus-remainder presentation.

## Radar Web design

### Authority and session semantics

`RadarManager` remains the single snapshot, polling, coalescing, and stale-data authority. Relay Web displays the Relay server PC's snapshot. Web sessions do not receive the server's CW cookies, provide browser cookies to the server, or authenticate Radar independently.

If the server PC's CW Dashboard session expires, Web retains the stale snapshot and explains that an operator must repair the session from Relay Desktop on the server PC. Desktop keeps its existing sign-in window. The Web notice does not offer an inert sign-in button.

### Authenticated Web routes

Extend the operational Web service boundary with:

- `GET /relay-api/v1/operations/radar` — return the current snapshot;
- `POST /relay-api/v1/operations/radar/refresh` — request the manager's coalesced refresh; authenticated, CSRF-protected, and rate-limited; and
- `radar-snapshot-changed` session event — publish every manager snapshot change to connected Relay Web sessions.

Responses and events use a shared runtime validator for the existing `RadarSnapshot` shape. The gateway owns one manager subscription and releases it during disposal. Route handlers tolerate a temporarily unavailable manager by returning the canonical empty/unavailable snapshot rather than throwing an unbounded error.

### Shared renderer behavior

- Radar appears in the Web sidebar with the same status semantics and accessible name as Desktop.
- `RadarTab` consumes the Web bridge snapshot and refresh methods without a Web-specific page fork.
- The `ORIGINAL` action opens the fixed Radar URL in the browser's normal navigation context.
- Radar queue notifications mount in the main Web workspace, use the same silent first-snapshot baseline, priority, and escalation rules, and remain disabled in popouts.
- Web reconnect fetches the latest snapshot; session events provide live changes between reads.

## Feature-parity audit

Build and review a runtime parity matrix from:

- main navigation and retained tabs;
- Settings and Data Manager sections;
- `BridgeAPI` methods and `WebBridge` implementations;
- runtime capability gates;
- browser-safe file, clipboard, notification, and external-link actions; and
- the supported/excluded lists in `docs/relay-web.md`, `docs/architecture.md`, and `docs/SECURITY.md`.

For every difference, the implementation must either:

1. make the shared feature operational in Web;
2. gate it through one of the approved device-specific capabilities with an accurate explanation; or
3. record a concrete blocker that requires a separate approved design because it changes a trust or data boundary.

The pass must not broaden Relay Web to public networks, add an offline mutation queue, expose desktop secrets, or recreate native filesystem and window capabilities in the browser.

## Error handling

- Picker cancellation: no toast and no result panel.
- Picker/read failure: specific visible error, no import call.
- Invalid JSON or unusable CSV/Excel structure: final error result, no false success.
- Per-row PocketBase failure: continue sequentially, update progress, retain the row message.
- Radar read failure: preserve the last usable snapshot and mark it stale.
- Radar refresh throttling or route failure: keep retained data and show the existing stale/error treatment.
- Radar sign-in required in Web: explain the server-desktop recovery action without exposing credentials or presenting an ineffective browser action.

## Testing strategy

### Focused renderer tests

- Focus returns before a delayed file `change`; the selected file still imports.
- A real `cancel` settles cleanly and removes the hidden input.
- Oversized and unreadable files produce specific errors.
- Progress starts with the parsed total, advances once per terminal row, and preserves created, updated, and error counts.
- The modal does not toast on cancellation and does show partial-success results.
- Web Sidebar includes Radar and retains its live accessible status.
- Web Radar session-repair copy replaces the ineffective sign-in action.
- Radar queue notifications mount in Web but not popouts.

### Main and Web bridge tests

- Radar snapshot and refresh routes require authentication.
- Refresh requires CSRF and enforces its per-session rate limit.
- Snapshot responses are validated and manager refreshes remain coalesced.
- Manager changes publish the expected Web event and gateway disposal unsubscribes.
- `WebBridge` maps get, refresh, open-original, and subscription behavior correctly.

### Browser tests

Use the disposable Relay Web test environment to verify:

- the shared navigation set includes Radar;
- the Radar workspace renders a seeded server snapshot and can refresh;
- a browser-selected import file reaches the shared importer;
- visible progress reaches its total and the final counts are accurate; and
- approved desktop-only controls remain absent or explicitly unavailable.

Invoke the suite through `npm run test:web`. Do not use live Relay data for browser tests.

### Completion gates

Run focused tests first, then:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:web
git diff --check
```

Report any unavailable check plainly.

## Documentation

Update the canonical live documents:

- `docs/relay-web.md` adds Radar to the supported experience and describes server-side Radar session recovery.
- `docs/architecture.md` documents the server-owned Radar snapshot route/event flow and removes the desktop-only statement.
- `docs/SECURITY.md` records that Radar snapshots, not CW cookies, cross the authenticated Relay Web boundary.

Historical specs that described Radar as desktop-only remain unchanged. This design supersedes that historical boundary for current implementation and live documentation.

## Acceptance criteria

1. Selecting a valid import file in supported Relay Web browsers cannot be mistaken for cancellation because focus returned before `change`.
2. Cancelling the file picker produces no failure toast.
3. A 977-record JSON server import displays total progress and returns accurate imported, updated, and error counts without changing sequential upsert semantics.
4. Radar is visible and usable in Relay Web using the server PC's current snapshot.
5. Web Radar receives live snapshot changes, supports rate-limited manual refresh, preserves stale data on failure, and directs expired SSO recovery to Relay Desktop.
6. Radar queue notifications follow the existing priority and escalation rules in Web.
7. Every Web/Desktop difference found by the audit is operational, explicitly capability-gated, or recorded as a separate trust-boundary blocker.
8. Approved device-specific exclusions remain excluded.
9. Focused tests, `npm run test:web`, and the required repository gates pass.

## Working-tree preservation

The implementation must preserve the pre-existing uncommitted compact Radar header-action changes in:

- `src/renderer/src/tabs/RadarTab.tsx`
- `src/renderer/src/tabs/__tests__/RadarTab.test.tsx`
- `src/renderer/src/tabs/radar.css`
- `tests/e2e/css-visual-contracts.spec.ts`

Those edits are compatible with this design but are not part of the design-document commit.
