# Relay Startup Performance Design

**Date:** 2026-07-21
**Status:** Approved

## Summary

Relay will present a lightweight application shell as soon as Electron can create a window, while required runtime initialization continues behind that visible state. The normal workspace will remain gated until its current safety prerequisites are complete: configuration and data-root resolution, required IPC registration, PocketBase health, required schema reconciliation and migrations, and the runtime state needed by the selected server or client mode.

The implementation will also shorten the underlying critical path. Heavy PDF, canvas, and client-only SQLite modules will no longer load before their features or runtime mode need them. PocketBase will avoid an unconditional credential-repair command on healthy installations, detect process readiness faster, reconcile managed collections from a shared schema snapshot, and move optional search storage plus scheduled backup and retention work out of workspace startup.

Required migrations remain authoritative and blocking for data access. The optimization changes when Relay presents progress and removes redundant work; it does not skip validation, weaken migration postconditions, expose partially migrated data, or convert required failures into apparent success.

## Evidence and Baseline

The existing startup path performs these stages serially before creating the main window in server mode:

1. eager main-process module evaluation;
2. Electron readiness and general service construction;
3. data-root resolution;
4. PocketBase credential CLI upsert;
5. PocketBase process launch and health polling;
6. app-user and superuser authentication;
7. required and optional collection bootstrap;
8. privileged runtime and supporting service startup;
9. main-window creation and renderer load.

Recent local server-mode logs measured a representative PocketBase critical path at approximately 717 milliseconds:

- unconditional superuser CLI upsert: 212 milliseconds;
- stale-process inspection, process launch, and health detection: 255 milliseconds; and
- app authentication plus schema bootstrap: 250 milliseconds.

PocketBase printed its server-started message about 190 milliseconds before Relay's fixed-interval health poll detected it. The optional Wiki search bootstrap is awaited inside `startPocketBase()` and may consume its full three-second deadline even though its failure is explicitly nonfatal. Backup and retention scheduling immediately launches a database cleanup that overlaps the renderer's first load.

The built main entry also eagerly imports `@napi-rs/canvas`, PDF.js, and `better-sqlite3`. Fresh-process measurements on the development Mac attributed approximately 481 milliseconds to canvas loading and 133 milliseconds to PDF.js loading. These figures are diagnostic baselines rather than portable guarantees, but they identify module boundaries that do not belong on every startup path.

## Goals

- Show an unmistakably live Relay window before PocketBase startup, schema reconciliation, or client-cache initialization completes.
- Keep the workspace inaccessible until all required startup safety conditions have succeeded.
- Reduce normal server-mode PocketBase critical-path time by at least 30 percent against the same-machine baseline.
- Remove the optional Wiki search bootstrap's three-second deadline from workspace readiness.
- Avoid loading PDF rendering and cover-generation dependencies until a cover must actually be generated.
- Avoid loading `better-sqlite3` in server mode and load it only after the shell is visible in client mode.
- Prevent backup, retention, indexing, discovery, or other best-effort services from competing with the first meaningful render.
- Capture durable startup milestone timings so future regressions can be diagnosed from ordinary logs.
- Preserve server, client, setup, reconfiguration, shutdown, and crash-recovery behavior.

## Non-goals

- Skipping required collection validation or migrations based only on the application version.
- Allowing the renderer to read or mutate PocketBase while required schema work is incomplete.
- Keeping PocketBase alive after Relay exits or introducing a separate background daemon.
- Replacing PocketBase, changing its data model, or modifying the PocketBase binary.
- Purging operating-system caches, weakening code signing, disabling security checks, or relying on undocumented launch flags.
- Treating a splash screen alone as completion; workspace-ready time remains a measured outcome.
- Redesigning the normal Relay application shell or unrelated feature loading.

## Startup State Contract

The main process will own a monotonic startup state with these public phases:

```ts
type StartupPhase = 'launching' | 'preparing-data' | 'ready' | 'failed';

type StartupState = {
  phase: StartupPhase;
  message: string;
  sequence: number;
};
```

The renderer receives the state through one read channel and one broadcast channel registered before the main window is created. `sequence` increases with every transition so a late or duplicated event cannot move the renderer backward. The state contains only bounded user-safe copy; detailed errors and timing data remain in main-process logs.

The allowed progression is:

```text
launching -> preparing-data -> ready
    |              |
    +------------> failed
```

An unconfigured installation may transition directly from `launching` to `ready` after setup IPC is available. A runtime reconfiguration starts a new internal startup generation and reuses the visible window, but events from an older generation cannot publish into the new state.

## Early Window and Renderer Gate

After `app.whenReady()`, Relay will install permission policy, register the startup-state IPC boundary, and begin creating the main window before starting PocketBase or client offline infrastructure. Main-window loading and required runtime bootstrap will then proceed concurrently.

The production HTML contains a small static startup shell in the root element. It uses inline-safe markup, the existing dark background, and a system font so first paint does not depend on React, application fonts, PocketBase, or feature chunks. Its initial copy is `Starting Relay...`.

The renderer bootstrap will:

1. retain the static shell while React and the normal `App` module begin loading;
2. subscribe to startup-state changes and read the current snapshot to close the subscription race;
3. show `Preparing Relay data...` while the main process reports `preparing-data`;
4. mount the already-loaded normal application only after `ready`; and
5. replace the progress state with a bounded startup error if the main process reports `failed`.

This is a data-access gate, not just visual decoration. The normal application cannot invoke setup, PocketBase, cache, privileged, or feature IPC until the main process has registered those handlers and published `ready`.

The existing window reveal fallback remains available for renderer failures. The static shell is the content that triggers the initial `ready-to-show`; Relay does not wait for the normal application module before presenting the window.

## Runtime Bootstrap Ordering

The main process will split startup into three groups.

### Presentation-critical

- Electron readiness;
- permission and security-header installation;
- startup-state IPC registration; and
- main-window creation and static-shell loading.

These steps run first and contain no PocketBase, PDF, canvas, or SQLite dependency.

### Workspace-critical

- application configuration and data-root resolution;
- general IPC registration;
- knowledge PDF service construction without loading its renderer;
- upload-queue restoration required by the UI;
- server-mode PocketBase health, required authentication, schema reconciliation, and migrations; or
- client-mode cache and pending-mutation store initialization; and
- the minimum selected-mode runtime needed by the renderer.

Relay publishes `ready` only after the applicable workspace-critical work succeeds. The normal React application then mounts and performs its existing connection bootstrap.

### Deferred

- optional Wiki search storage bootstrap and search-runtime start;
- backup and retention's first scheduled run;
- daily knowledge-cache cleanup scheduling;
- memory heartbeat startup;
- optional LAN discovery and other best-effort services that do not establish the desktop data-safety boundary; and
- heavyweight feature modules not needed by the initial workspace.

Deferred work starts from contained promises after `ready`. Each task logs its own failure and may update its existing feature-specific availability state, but it cannot revert global startup to `failed`.

Shutdown cleanup must tolerate every partial-startup boundary. Resources are registered for cleanup immediately after construction, and startup generations that lose a reconfiguration race dispose their owned resources without publishing state.

## Heavy Module Boundaries

`KnowledgeCoverService` will no longer statically import the PDF/canvas implementation. Its default cover-render function will dynamically import the renderer on the first cache miss that actually requires local cover generation. Stored and cached covers remain available without loading `@napi-rs/canvas` or PDF.js.

The main entry will dynamically import client offline infrastructure only when the loaded configuration is client mode. Server and unconfigured modes therefore do not load `better-sqlite3` through the client-cache path.

Knowledge extraction continues to run in its existing worker. The optimization must not move PDF parsing onto the Electron main thread.

A production build check will verify that the main entry has no static import of:

- `@napi-rs/canvas`;
- `pdfjs-dist/legacy/build/pdf.mjs`; or
- `better-sqlite3`.

Those dependencies may remain in on-demand chunks or mode-specific modules.

## PocketBase Fast Path

### Credential handling

The normal path will start PocketBase and authenticate the configured superuser through the local API. A successful authentication proves that the configured secret and stored superuser already agree, so the CLI upsert is unnecessary.

If and only if authentication produces a definitive credential rejection, Relay will:

1. stop the just-started PocketBase process cleanly;
2. run the existing bounded `superuser upsert` CLI command;
3. restart PocketBase;
4. authenticate the superuser again; and
5. continue only after that verification succeeds.

Timeouts, connection failures, malformed responses, database errors, and other ambiguous failures must not trigger credential mutation. They remain startup failures with detailed redacted logging. This retains the current recovery ability for changed configuration secrets while removing the CLI process and database write from healthy launches.

App-user authentication and repair retain their current credential-rejection safeguards. Required schema work uses the verified superuser client and never exposes its auth store to the renderer.

### Health detection

PocketBase health polling will use a fast initial cadence with bounded backoff instead of sleeping a fixed 200 milliseconds after every failed attempt. The first retries occur after 20 and 40 milliseconds, then increase to a maximum 200-millisecond interval until the existing ten-second deadline.

Relay will continue to require a successful `/api/health` response. It will not treat stdout text, an open port, or a live PID as sufficient readiness. Process errors and early exit continue to reject startup and terminate the spawned child.

Stale-process cleanup remains unchanged and identity-checked in this implementation. Relay must never kill an unrelated process merely because it occupies the configured port.

### Schema reconciliation

Required schema validation still runs on every server startup because collections can be changed independently of the Relay application version. The optimization will reduce requests rather than trust a stale version marker.

`collections.getFullList()` returns the managed collection metadata used to build one bootstrap snapshot. When an entry contains the complete fields, indexes, rules, and auth options required for reconciliation, Relay will compare directly against that snapshot instead of fetching the same collection again. If an entry is incomplete, reconciliation falls back to `collections.getOne()` for that collection.

The bootstrap context will be reused by migration checks that only need the same pre-write collection metadata. Any migration that creates, patches, or retires collections must refresh or explicitly update the snapshot before post-write validation. Existing record re-reads and migration postconditions remain unchanged.

Collection creation and patching remain ordered where PocketBase rule or relation validation depends on an earlier definition. Independent read-only comparisons may be computed together, but writes are not parallelized merely for speed.

### Required and optional storage

The required batch API, managed collections, role-account migration, Knowledge library state, and Knowledge category migration remain workspace-critical.

Wiki search fields and search-chunk storage retain their existing retry and three-second deadline, but the operation starts after global `ready`. Knowledge search reports unavailable until the operation succeeds and the search runtime has started. A hung or failed optional bootstrap is contained and cannot delay the desktop workspace.

### Maintenance scheduling

Backup and retention managers may be constructed once PocketBase is authenticated, but their first backup/cleanup cycle will begin 30 seconds after global `ready`. The existing 24-hour recurring interval remains unchanged. This prevents database enumeration, deletion checks, or backup compression from competing with initial rendering and connection bootstrap.

If Relay exits before the initial delay, shutdown cancels the pending work. Manual backup and restore remain available after the normal application is ready and are not subject to the scheduling delay.

## Failure Handling

- A failure before any window can be created retains the native critical-error fallback and exits cleanly.
- A workspace-critical failure publishes `failed`, updates the visible shell to `Relay could not start.`, logs the detailed redacted cause, and opens the existing native critical-error dialog with generic restart guidance. Dismissing the dialog performs normal partial-resource cleanup and quits Relay, matching the current fatal-startup lifecycle.
- A credential rejection may enter the one bounded CLI recovery path. Ambiguous failures never mutate credentials.
- A failed required migration never publishes `ready` and never exposes the normal application.
- Optional search, discovery, backup, retention, cache cleanup, and telemetry failures are logged and isolated after readiness.
- A second-instance request focuses the visible startup window just as it focuses the normal workspace.
- Startup-state IPC applies the same trusted-sender validation as other desktop-only channels.

## Performance Instrumentation

The main process will record monotonic milestones relative to the process performance time origin so eager module evaluation is represented in the first captured timestamp. At minimum, logs will include:

- entry module evaluated;
- Electron ready;
- main window created;
- startup shell ready to show;
- data root ready;
- PocketBase process healthy;
- PocketBase credentials ready;
- required schema ready;
- workspace ready; and
- normal renderer mounted.

The renderer reports its first successful normal-application mount through a trusted one-way startup milestone channel. Each completed launch emits one bounded summary containing phase durations and total elapsed milliseconds. It contains no filesystem paths, URLs, account data, secrets, tokens, or database contents.

Development benchmark tooling will launch Relay with an isolated temporary user-data directory and report repeated runs. Automated tests assert ordering and blocking semantics rather than brittle machine-wide wall-clock limits. Same-machine before/after benchmark comparisons provide the performance acceptance evidence.

## Testing Strategy

Implementation follows red-green TDD for each behavior slice.

### Startup coordinator and renderer gate

- Prove the window-creation dependency is invoked before server or client workspace bootstrap resolves.
- Prove the normal application does not mount before `ready`.
- Prove a snapshot closes the subscribe/read race and sequence numbers prevent backward transitions.
- Prove required failure produces the bounded error state.
- Prove an unconfigured installation reaches setup without PocketBase startup.
- Prove reconfiguration cannot publish stale-generation events.

### Heavy modules

- Prove cached and stored covers do not invoke the dynamic renderer importer.
- Prove the first generated cover imports once and concurrent requests share the existing in-flight boundary.
- Prove server and unconfigured startup do not import client offline infrastructure.
- Inspect the production main entry for forbidden static heavyweight imports.

### PocketBase

- Prove successful superuser API authentication never invokes the CLI upsert.
- Prove definitive credential rejection performs exactly one stop, CLI repair, restart, and verification sequence.
- Prove timeout and non-credential failures do not invoke the CLI.
- Prove fast health retries retain the ten-second deadline and child-process cleanup behavior.
- Prove complete collection snapshots avoid per-collection reads and incomplete snapshots fall back safely.
- Prove required migrations still block `ready` and retain their post-write validation.
- Prove a never-resolving optional search bootstrap does not delay workspace readiness.
- Prove initial maintenance waits 30 seconds after readiness and recurring scheduling remains daily.

### Final verification

- Run focused tests after each behavior slice.
- Run the full relevant unit, cache, and renderer test suite.
- Run Electron interaction tests covering startup, setup, server mode, and client mode.
- Run typecheck, lint, production build, and formatting checks.
- Run repeated same-machine launch benchmarks against the recorded baseline.
- Inspect a production build to confirm the static startup shell and on-demand heavyweight chunks.
- Perform one independent final code review after implementation.

## Acceptance Criteria

- The first visible Relay shell appears before PocketBase or client SQLite initialization completes.
- Server-mode workspace readiness still requires every existing required authentication, schema, and migration condition.
- Healthy server startup does not execute `pocketbase superuser upsert`.
- Credential mismatch recovery remains functional and verified.
- PocketBase health is still established through `/api/health`, with faster early retries.
- Normal server-mode PocketBase critical-path median improves by at least 30 percent on the same-machine benchmark.
- An optional Wiki search bootstrap that consumes or exceeds three seconds does not delay the workspace.
- Scheduled backup and retention do not start during the first 30 seconds after workspace readiness.
- The production main entry contains no static PDF.js, canvas, or client SQLite import.
- Required-startup failures remain visible, bounded, redacted, and cleanup-safe.
- All focused and complete verification commands pass with no new startup warnings or unhandled rejections.
