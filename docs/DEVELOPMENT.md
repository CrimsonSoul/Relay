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

| File                                               | Purpose                                                     |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `package.json`                                     | Scripts and tool entry points                               |
| `eslint.config.js`                                 | Lint rules and per-layer restrictions                       |
| `vitest.config.ts`                                 | Main/shared test config                                     |
| `vitest.renderer.config.ts`                        | Renderer test config                                        |
| `src/shared/ipc.ts`                                | Bridge API and IPC channel definitions                      |
| `src/shared/ipcValidation.ts`                      | Shared IPC validation helpers                               |
| `src/shared/dynatrace.ts`                          | Dynatrace URL validation and navigation classification      |
| `src/renderer/src/services/pocketbase.ts`          | Renderer PocketBase client and connection state             |
| `src/renderer/src/hooks/useCollection.ts`          | Realtime collection subscription and offline cache fallback |
| `src/renderer/src/hooks/useOptimisticList.ts`      | Optimistic list state over realtime data                    |
| `src/renderer/src/hooks/useClientPresence.ts`      | Client heartbeat, client-count state, and connect toasts    |
| `src/renderer/src/hooks/useDynatraceDashboards.ts` | Renderer state for dashboard settings and launch actions    |
| `src/main/dynatrace/DynatraceWindowManager.ts`     | Relay-framed Dynatrace popout windows and navigation policy |
| `src/main/dynatrace/DynatraceDashboardStore.ts`    | Local dashboard URL and popout bounds storage               |

## Data Access Pattern

### Renderer Services

PocketBase collection CRUD lives in `src/renderer/src/services/`.

Current conventions:

- Initialize PocketBase once through `initPocketBase()`
- Access the shared client through `getPb()`
- Keep collection logic in service modules, not components
- Call `requireOnline()` before writes that should fail fast while offline
- Route API failures through `handleApiError()`

In Relay, normal record CRUD is performed directly from the renderer via the PocketBase SDK. It does not go through Electron IPC.

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
- Offline cache reads and sync triggers
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

Server setup defaults to a local-only PocketBase listener (`127.0.0.1`). Use the direct LAN access option only when the server should accept connections from other machines on the network.

Client setup normalizes host-only server entries to HTTPS. Explicit HTTP URLs are accepted for trusted LAN targets such as private IPs, `.local` names, and single-label machine names. Public HTTP URLs are rejected unless the insecure HTTP opt-in is selected.

### PocketBase Binary Layout

PocketBase binaries are downloaded into architecture-specific resource folders:

- `resources/pocketbase/win32-x64/pocketbase.exe`
- `resources/pocketbase/darwin-arm64/pocketbase`
- `resources/pocketbase/darwin-x64/pocketbase`
- `resources/pocketbase/linux-x64/pocketbase`
- `resources/pocketbase/linux-arm64/pocketbase`

Use `npm run download:pocketbase -- --platform=<platform> --arch=<arch>` to fetch a specific target. Packaged builds resolve the binary by `process.platform` and `process.arch`, while local development can still fall back to the legacy `resources/pocketbase/pocketbase` path if an older checkout already has it.

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

`useCollection()` is the standard pattern for list data backed by PocketBase realtime subscriptions.

It handles:

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
- Client mode writes a heartbeat every 15 seconds and hides the server-only client-count block
- Records older than 45 seconds are treated as inactive

The server is intentionally excluded from the count. Only records with `mode: "client"` are considered active clients.

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

Relay uses two Vitest configurations:

| Suite       | Config                      | Environment |
| ----------- | --------------------------- | ----------- |
| Main/shared | `vitest.config.ts`          | Node        |
| Renderer    | `vitest.renderer.config.ts` | jsdom       |

Common commands:

```bash
npm test
npm run test:unit
npm run test:renderer
npm run test:coverage
npm run test:electron
```

Coverage thresholds are currently 80% for lines, functions, branches, and statements in both Vitest configs.

Renderer coverage is run through the renderer test wrapper:

```bash
npm run test:renderer -- --coverage
```

Security scanners are not tied to public tokens in the repo. For local checks, pass credentials through the environment or your OS secret store:

```bash
npm exec --yes snyk -- test --all-projects --dev
npm exec --yes snyk -- code test
sonar-scanner
```

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
