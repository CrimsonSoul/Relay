# Development Guide

Current patterns, workflows, and contributor conventions for Relay.

## Overview

Relay is an Electron app with a React renderer, a typed preload bridge, and a PocketBase-backed data model.

Use these directories as the primary mental model:

- `src/main/`: Electron lifecycle, security, IPC handlers, PocketBase bootstrap, offline cache, backup logic
- `src/preload/`: typed `window.api` bridge
- `src/renderer/`: UI, hooks, services, tabs, and styles
- `src/shared/`: shared types, IPC channels, schemas, and utilities

For runtime structure, see `docs/architecture.md`.

## Source Of Truth

These files define the current workflow and should win over stale assumptions:

| File                                                 | Purpose                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `package.json`                                       | Scripts and tool entry points                               |
| `eslint.config.js`                                   | Lint rules and per-layer restrictions                       |
| `vitest.config.ts`                                   | Main/shared test config                                     |
| `vitest.cache.config.ts`                             | Main-process cache test config                              |
| `vitest.renderer.config.ts`                          | Renderer test config                                        |
| `src/shared/ipc.ts`                                  | Bridge API and IPC channel definitions                      |
| `src/shared/ipcValidation.ts`                        | Shared IPC validation helpers                               |
| `src/shared/dynatrace.ts`                            | Dynatrace URL validation and navigation classification      |
| `src/renderer/src/services/pocketbase.ts`            | Renderer PocketBase client and connection state             |
| `src/renderer/src/stores/collectionStore.ts`         | Collection fetch, realtime, reconnect, and cache lifecycle  |
| `src/renderer/src/stores/collectionStoreRegistry.ts` | Shared collection-store registry and query identity         |
| `src/renderer/src/hooks/useCollection.ts`            | React adapter over the shared collection store              |
| `src/renderer/src/hooks/useOptimisticList.ts`        | Optimistic list state over realtime data                    |
| `src/renderer/src/hooks/useClientPresence.ts`        | Client heartbeat, client-count state, and connect toasts    |
| `src/renderer/src/hooks/useDynatraceDashboards.ts`   | Renderer state for dashboard settings and launch actions    |
| `src/main/dynatrace/DynatraceWindowManager.ts`       | Relay-framed Dynatrace popout windows and navigation policy |
| `src/main/dynatrace/DynatraceDashboardStore.ts`      | Local dashboard URL and popout bounds storage               |

## Startup Performance

Relay shows a static renderer shell as soon as the first window loads, while required workspace
and PocketBase initialization continue in the main process. Optional search-index repair,
retention scheduling, backup cleanup, and other maintenance start only after the workspace is
ready.

Run the repeatable desktop benchmark with:

```sh
npm run benchmark:startup
```

The command builds Relay and launches it only against a disposable app-data directory. It never
opens the current user's Relay database. The JSON report contains:

- `provisioning`: a first-ever launch, including PocketBase credential and schema creation
- `postUpdate`: the first healthy launch against an existing data directory, used as the closest
  repeatable proxy for first launch after a build or application update
- `warmMedian`: the median user-visible window and workspace times from five additional launches
- `timeline`: Relay's internal monotonic milestones, including window creation, shell readiness,
  PocketBase health, credentials, schema, workspace readiness, and renderer mount

Compare results on the same machine and power state. The proxy does not reproduce OS-level cache
changes made by a particular installer, so use packaged-build measurements as the final release
check when update behavior itself changes.

## Data Access Pattern

### Renderer Services

PocketBase collection CRUD lives in `src/renderer/src/services/`.

Current conventions:

- Initialize PocketBase once through `initPocketBase()`
- Access the shared client through `getPb()`
- Keep collection logic in service modules, not components
- Call `requireOnline()` before writes that should fail fast while offline
- Route API failures through `handleApiError()`

In Relay, normal record reads and online writes go directly from the renderer to PocketBase. Standard writes pass through `mutationGateway.ts`: it uses the PocketBase SDK while online, routes offline-capable desktop mutations through validated IPC into the main-process queue, and rejects offline writes in Relay Web.

### Adding A Service

For a new collection-backed feature:

1. Add a service module in `src/renderer/src/services/`
2. Keep the exported API narrow and async
3. Add a hook in `src/renderer/src/hooks/` for UI-facing state and effects
4. Write tests next to the service or in a nearby `__tests__/` directory

Prefer using `createCrudService<T>()` from `crudServiceFactory.ts` when the collection only needs standard CRUD behavior.

### PocketBase Filters

Escape user-provided values with `escapeFilter()` before interpolating them into PocketBase filter strings.

```ts
import { escapeFilter, getPb } from './pocketbase';

const record = await getPb()
  .collection('contacts')
  .getFirstListItem(`email="${escapeFilter(email)}"`);
```

## IPC Pattern

IPC is reserved for work the renderer should not do directly.

Current examples:

- Window management
- Setup and PocketBase connection bootstrap
- Client setup metadata such as local hostname and LAN server discovery
- Dynatrace dashboard storage, session clearing, and popout opening
- Cloud status aggregation
- Clipboard and shell/file-system actions
- Alert image and logo persistence
- Offline mutation enqueueing, cache reads, and sync triggers
- Backup creation and restore
- Renderer-to-main logging

Rules:

- Define channels and bridge types in `src/shared/ipc.ts`
- Validate payloads with shared schemas from `src/shared/ipcValidation.ts`
- Expose new bridge methods from `src/preload/index.ts`
- Keep handlers in `src/main/handlers/`

### Service Status Sources

Service Status is aggregated in the main process from official RSS feeds, Statuspage JSON, or a
documented status API.

## Connection, Realtime, And Offline Behavior

### Setup And Transport Security

New server setup enables direct LAN access by default and binds PocketBase to `0.0.0.0`. Clear **Allow direct LAN access** during setup to bind only to `127.0.0.1`. Keep the LAN-bound default only on trusted operator-controlled networks; use host firewall and network controls to limit which stations can reach the PocketBase port.

Client setup normalizes host-only server entries to HTTPS. Explicit HTTP URLs are accepted for trusted LAN targets such as private IPs, `.local` names, and single-label machine names. Public HTTP URLs are rejected unless the insecure HTTP opt-in is selected.

Relay release artifacts target Windows only. macOS remains a supported local development host, so
Darwin runtime branches, PocketBase downloads, and Electron development tests must remain working.

### PocketBase Binary Layout

PocketBase binaries are downloaded into architecture-specific resource folders:

- `resources/pocketbase/win32-x64/pocketbase.exe`
- `resources/pocketbase/darwin-arm64/pocketbase`
- `resources/pocketbase/darwin-x64/pocketbase`
- `resources/pocketbase/linux-x64/pocketbase`
- `resources/pocketbase/linux-arm64/pocketbase`

Use `npm run download:pocketbase -- --platform=<platform> --arch=<arch>` to fetch a specific target. Packaged builds resolve the binary by `process.platform` and `process.arch`, while local development can still fall back to the legacy `resources/pocketbase/pocketbase` path if an older checkout already has it.

Checked-in PocketBase JavaScript hooks live separately under
`resources/pocketbase/hooks/`. The binary directories remain ignored, but hooks are source and must
be committed. The Windows package copies that directory to `pocketbase/hooks` beside the embedded
binary. Local macOS development loads the same checked-in hooks without producing a Mac release
artifact. Server startup deliberately fails if the required privileged reauthentication hook is
missing or not registered. The new hook and paired-client reauthentication call must be tested as a
coordinated server/client rollout; mixed versions retain ordinary connectivity but cannot complete
fresh-password protected actions.

### Role Accounts And Existing-Install Migration

Ordinary Relay workflows do not require an identity selection or protected sign-in. Protected authentication is username-only and main-process-owned. Effective roles are derived from account IDs plus the singleton authority state:

- `ryan` / Ryan Bledsoe is the initial Owner referenced by `ownerAccountId`.
- `charles` / Charles Gibbs is an Administrator.
- Zero or one stored Publisher account is effective when its ID equals `publisherAccountId`.
- Owner-only Administrator lifecycle and ownership commands must remain denied to Administrators; Owner and Administrators may manage the Publisher.

Fresh installs create Ryan and Charles inactive with generated unusable credentials and `mustChangePassword`; a real password is set only on the Relay server PC. Password setup and recovery are server-local. Do not add email login, email reset, remote activation, a default password, or renderer access to the protected auth store. `scripts/seed.mjs` seeds ordinary demo/application data only and must not manufacture role accounts or a legacy operator roster.

`src/main/privileged/RoleAccountMigration.ts` owns the one-time legacy conversion. Migration work must preserve existing protected-account IDs, paired-device `accountId` bindings, and every non-empty historical display-name snapshot. Legacy `role=operator` auth rows are retired because ordinary Relay use is passwordless; migration defers instead if one of those rows still owns a paired device. The exact legacy `relay_login_roster` view is validated and deleted before `relay_operators`, and both retirements happen only after converted accounts and singleton pointers have been re-read and validated. A deferred result is a startup safety stop, not permission to improvise or delete legacy identity data.

Before testing an existing installation:

1. Leave the live `pb_data` path read-only. Determine whether PocketBase is running and whether `data.db-wal` is active.
2. Prefer a PocketBase backup for a consistent full snapshot. Otherwise use SQLite's online backup operation from a read-only source connection for each SQLite database and copy non-database files into a new explicit temporary directory. Never copy a live `data.db` alone while WAL activity is possible.
3. Record the pre-migration account IDs, paired-device `accountId` values, Publisher pointer/count, legacy-roster presence, and all non-empty `author`, `addressedBy`, `createdBy`, and `displayNameSnapshot` values.
4. Run the candidate build only against the temporary copy. Never point a development build or migration harness at the live path.
5. Verify exactly one Owner (`ryan`, Ryan Bledsoe), Charles as Administrator (`charles`, Charles Gibbs), zero or one Publisher, neither legacy roster collection/view after success, identical paired-device account IDs, and byte-for-byte identical pre-existing non-empty historical snapshots.

Keep the consistent pre-migration backup through deployment verification. If planning defers, leave live data untouched. If conversion fails after writes begin, stop Relay and restore the complete backup before starting the prior build. Do not repair authority pointers by hand, restore only selected tables, or run an old build against a partially converted database.

### Connection State

`src/renderer/src/services/pocketbase.ts` owns the renderer connection lifecycle.

Current connection states:

- `connecting`
- `online`
- `offline`
- `reconnecting`
- `auth-failed` (server reachable but credentials rejected — recover via Settings → Reconfigure)

Health checks use an adaptive cadence: an immediate probe on startup and reconnect attempts, then every 5 seconds while degraded and every 30 seconds while `online` or `auth-failed`, with browser `online`/`offline` window events triggering immediate re-evaluation. If the realtime SSE connection drops while subscriptions are active, the client treats it as a disconnect and runs a reconnect cycle plus a refetch so list data cannot silently go stale.

The bottom-left sidebar connection indicator is the canonical user-facing status. It shows connected, reconnecting, offline, auth-failed, and cached-data states. The older bottom-right offline banner was removed so Relay does not show contradictory status in two places.

Use:

- `onConnectionStateChange()` to subscribe
- `isOnline()` to branch behavior
- `requireOnline()` to reject writes while disconnected

### Realtime Collections

`CollectionStore` in `src/renderer/src/stores/collectionStore.ts` owns the shared lifecycle for list data backed by PocketBase. `useCollection()` resolves a store through `collectionStoreRegistry.ts` and exposes its immutable snapshot to React with `useSyncExternalStore`.

The store handles:

- Initial full fetch
- Realtime subscription setup
- Sort preservation for incoming events
- Offline cache fallback
- Reconnect-triggered resubscribe and pending-sync flush

### Client Presence

`useClientPresence()` is active in server mode for display and in client mode for heartbeats.

Current behavior:

- Server mode subscribes to `client_presence` and shows the active client count above Settings in the sidebar
- The sidebar client block uses the same button styling and hover affordance as other sidebar footer items
- Hovering the block shows active client hostnames
- New client sessions trigger toast notifications
- Client mode writes a heartbeat every 30 seconds and hides the server-only client-count block
- Records older than 90 seconds are treated as inactive

The server is intentionally excluded from the count. Desktop client and browser records are considered active clients. Browser records use a bounded `Web · Browser · address` label and the same expiry window.

### Relay Web Runtime

The optional Relay Web service runs only in server mode and is implemented in `src/main/web/`. It serves the built renderer and a narrow same-origin API on a port separate from PocketBase. `src/renderer/src/runtime/` selects either the Electron preload adapter or the browser session adapter without forking the feature UI.

The browser session exposes capability flags for device-specific operations. Keep desktop-only behavior behind those capabilities rather than testing the user agent inside feature components. Relay Web does not provide offline cache/replay or browser push notifications.

See `docs/relay-web.md` for operator setup and the supported browser boundary.

### Dynatrace Dashboards

Dynatrace dashboards are configured from Settings and launched from the sidebar dashboard button.

Implementation notes:

- Dashboard definitions live in `dynatrace-dashboards.json` under the app data directory, not in PocketBase
- URLs must be HTTPS and under `dynatrace.com`
- Popout windows use Relay chrome in the host `BrowserWindow`
- The dashboard content runs in a separate `WebContentsView` with `backgroundThrottling: false`
- The content session uses `persist:relay-dynatrace` so Microsoft SSO can persist independently from the app shell
- Navigation is limited to Dynatrace hosts and Microsoft authentication hosts
- Settings exposes a session clear action for forced reauthentication

### Dynatrace Problems

The Relay server polls the read-only Dynatrace Problems API for open problems and a rolling year of
resolved history. Problems, local NOC notes, and local addressed metadata are stored in PocketBase,
so clients on the LAN see the same operational history without sending local response data back to
Dynatrace.

After a successful sync, Relay removes resolved problems whose Dynatrace end time is more than 365
days old. Their associated local notes and addressed state are removed in the same cleanup. Open
problems are never aged out, even when they began more than a year ago.

### Optimistic Lists

When UI state needs optimistic updates on top of realtime collection data, layer `useOptimisticList()` on top of `useCollection()`.

This prevents external realtime events from overwriting local optimistic state while mutations are still settling.

## Renderer Conventions

### Hooks

Hooks in `src/renderer/src/hooks/` should own:

- Feature-level state
- Side effects
- Service orchestration
- View-facing callbacks

Components should stay focused on rendering and local interaction details.

### Tab Loading

`src/renderer/src/App.tsx` uses a mount-once tab model.

Current behavior:

- Compose loads eagerly
- Most other tabs are lazy-loaded
- Visited tabs remain mounted to preserve local state and scroll position

### Styling

Relay uses plain CSS plus shared design tokens.

Conventions:

- Reuse existing tokens in `src/renderer/src/styles/theme.css`
- Reuse shared primitives such as `TactileButton`, `.tactile-input`, and `.card-surface`
- Keep feature-specific CSS near the feature when that pattern already exists

For UI guidance, see `docs/DESIGN.md`.

## Testing

### Dynatrace Problems Demo Data

With Relay running in server mode, supply the server passphrase through the environment and seed a
realistic mix of open, locally addressed, and resolved Dynatrace Problems:

```bash
RELAY_SEED_SUPERUSER_PASSWORD='<server passphrase>' npm run seed:dynatrace
```

The command replaces only demo Problems, local state, and NOC notes whose problem ID begins with
`RELAY-DEMO-`. It does not alter contacts, alerts, standalone Relay notes, real Dynatrace Problems,
the stored API token, or Dynatrace itself. Remove the demo records with:

```bash
RELAY_SEED_SUPERUSER_PASSWORD='<server passphrase>' npm run seed:dynatrace:clear
```

The default PocketBase endpoint is `http://localhost:8090`. Set `RELAY_SEED_PB_URL` when the Relay
server uses another port. `RELAY_SEED_PB_DATA_DIR` can override the PocketBase data directory used
to create the temporary seed superuser.

The demo seed intentionally writes historical `author` and `addressedBy` snapshots but does not create a current operator identity. New ordinary Problem notes and addressed-state changes are unattributed. Keep the historical strings non-empty in fixtures so migration and rendering regressions remain visible.

### Test Suites

Relay uses three Vitest configurations:

| Suite               | Config                      | Environment |
| ------------------- | --------------------------- | ----------- |
| Main/shared/scripts | `vitest.config.ts`          | Node        |
| Main-process cache  | `vitest.cache.config.ts`    | Node        |
| Renderer            | `vitest.renderer.config.ts` | jsdom       |

Common commands:

```bash
npm test
npm run test:unit
npm run test:cache
npm run test:renderer
npm run test:coverage
npm run test:electron
npm run test:web
npm run test:knowledge-upload-soak
```

`npm test` runs the main/shared, cache, and renderer suites in sequence. `test:knowledge-upload-soak` is a standalone stress harness rather than a Vitest suite.

`npm run test:web` builds Relay, starts a real Relay Web server in an isolated temporary data directory, and runs the critical browser workflow in Chromium profiles for Chrome and Edge plus WebKit for Safari. Run the command through npm so the native `better-sqlite3` module is restored to the correct ABI after Electron exits.

Coverage thresholds are currently 80% for lines, functions, branches, and statements in the main/shared and renderer configs. The cache config has no independent coverage threshold.

Renderer coverage is run through the renderer test wrapper:

```bash
npm run test:renderer -- --coverage
```

Security scanners are not tied to public tokens in the repo. For local checks, pass credentials through the environment or your OS secret store:

```bash
npm run test:coverage:sonar
npm run security:sonar -- -Dsonar.organization=<organization>
npm run security:sonar:quality-gate -- wait-analysis --branch=test
npm run security:sonar:reviewed -- --branch=test --apply
npm run security:sonar:issues -- --branch=test
npm run security:sonar:quality-gate -- check-quality-gate --branch=test
npm run security:snyk
```

`security:sonar` uses the pinned SonarScanner for NPM and reads `SONAR_TOKEN` plus the optional HTTPS-only `SONAR_HOST_URL` from the environment. `security:snyk` runs the pinned Snyk Open Source and Snyk Code gates and reads `SNYK_TOKEN`; pass `--org=<organization>` to either underlying Snyk command when the account default is not the intended organization. The Open Source gate includes development dependencies because Relay's build and packaging toolchain is part of its supply-chain surface. `security:snyk:monitor` publishes an Open Source dependency snapshot after the gates pass.

`security:sonar:issues` queries every page of the branch or pull-request issue
set after analysis finishes. It fails when any Open, Confirmed, or legacy
Reopened issue remains and reports Accepted/legacy Won't Fix and False Positive
issues separately. Pass exactly one `--branch=<name>` or
`--pull-request=<number>` selector. The command reads the project key from
`sonar-project.properties`, defaults to SonarQube Cloud when
`SONAR_HOST_URL` is unset, and reads authentication only from `SONAR_TOKEN`.

`security:sonar:quality-gate` reads the scanner's
`.scannerwork/report-task.txt`, validates its HTTPS host, project, and exact
compute-task identity, and requires one `--branch` or `--pull-request` scope.
The `wait-analysis` phase blocks until that task succeeds. After the
test-branch reconciler and zero-open check, `check-quality-gate` proves that
analysis is still the latest branch analysis, polls the recalculated live branch
gate for a bounded period, and rechecks freshness before accepting green. Pull
requests never mutate issue state, so they use the immutable analysis ID and
fail a non-passing gate immediately.

`security:sonar:reviewed` is a write operation restricted to `test` and requires
the explicit `--apply` latch. It contains an exact manifest of the 49 findings
that were individually reviewed during the zero-warning cleanup: 43
behavior-preserving Accepted decisions and six evidence-backed False
Positives. Before changing anything, it verifies every observed key, rule, and
component, and it refuses to proceed if any other Open or Confirmed finding
exists. Each transition adds a short audit rationale. The `test`-branch push
workflow runs this exact reconciliation after fresh analysis; later pushes are
idempotent once those decisions exist. Avoid running it locally unless an
administrator token is intentionally available.

`test:coverage:sonar` generates both LCOV reports without applying the repository's historical aggregate thresholds. The remote SonarQube quality gate enforces coverage on new code, while `npm run test:coverage` remains the explicit local aggregate-threshold check.

The `Security and Code Quality` GitHub Actions workflow is intentionally anchored to Relay's authoritative `test` branch. Internal pull requests targeting `test` run the pinned SonarQube, Snyk Open Source, Snyk Code, and build quality gates. Pull-request scans never change Sonar issue state or the canonical Snyk monitored snapshot. After merge, the `test` push repeats the scanners, reconciles only the pinned Sonar review manifest, and updates the Snyk snapshot identified by target reference `test`. The Sonar scanner uploads unit and renderer LCOV reports without waiting on a gate that may still contain a pending reviewed decision. Relay then waits for the exact compute task, enforces zero open issues, and verifies the remote quality gate for that same analysis. The reconciler is idempotent and fails before its first write if any unknown Open or Confirmed issue appears or reviewed metadata drifts. Scanner credentials are scoped only to their scanner steps and remain in GitHub Actions secrets, while organization and host identifiers are stored as repository variables.

### Screenshot Refresh

The README screenshot set is produced by an explicit Electron Playwright harness:

```bash
npm run build
npx playwright test tests/e2e/redesign-screenshots.spec.ts -c playwright.electron.config.ts
```

Generated images land in `tmp/redesign-shots/`. Copy the selected captures into `docs/screenshots/` before committing documentation updates.

### Renderer Test Setup

`src/renderer/test/setup.ts` provides the shared renderer test environment.

It currently:

- Loads `@testing-library/jest-dom`
- Patches missing `HTMLDialogElement` methods in jsdom
- Provides a localStorage fallback when needed

If a hook or component depends on toast context, wrap it with `NoopToastProvider` from `src/renderer/src/components/Toast.tsx`.

### Test Placement

Both of these patterns are already used in the repo:

- Adjacent `*.test.ts` or `*.test.tsx` files
- Nearby `__tests__/` directories

Match the surrounding feature instead of introducing a new structure.

## Linting And Code Style

Relay uses ESLint flat config plus Prettier.

Important current rules from `eslint.config.js`:

- `@typescript-eslint/no-explicit-any`: `error` in app code, `warn` in tests
- `@typescript-eslint/no-floating-promises`: `error`
- `@typescript-eslint/no-misused-promises`: `error` in app code
- `react-hooks/rules-of-hooks`: `error`
- `jsx-a11y` rules are enabled in renderer code
- `jsx-a11y/no-autofocus` is intentionally disabled for current modal/search behavior

Renderer, main, preload, and shared code all have slightly different lint environments. Check the file globs in `eslint.config.js` before assuming a rule applies everywhere.

## Practical Contributor Rules

- Prefer the smallest correct change over broad refactors
- Keep domain CRUD in renderer services, not React components
- Use IPC only for privileged or system-level work
- Validate new IPC payloads in shared schemas
- Reuse existing hooks and shared UI primitives before adding new abstractions
- Keep docs aligned with current code paths instead of preserving old architecture notes
