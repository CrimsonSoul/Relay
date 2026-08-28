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

## Automated Releases

Relay publishes normal GitHub Releases automatically from the protected `main` branch. A push to
`main` starts `.github/workflows/release.yml`. Version resolution and Windows packaging can begin
while the workflow waits for `Build quality gate`, `SonarQube quality gate`, and `Snyk security
gate` on that exact commit, but no versioned asset, tag, draft, or published release is created
until all three gates and the Windows package succeed. A failed, cancelled, skipped, neutral,
stale, or missing gate blocks publication.

`scripts/release-version.mjs` derives the next normal semantic version from conventional commits
since the highest reachable `vX.Y.Z` tag:

- `fix:`, `perf:`, and `revert:` increment the patch version.
- `feat:` increments the minor version.
- A `!` before the subject colon or a `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer increments the
  major version.
- Documentation, test, CI, build, style, refactor, and chore-only updates do not create an empty
  release.
- When no release tag exists, the first release is `v1.0.0`.

Because protected `main` uses squash merges, a release-intended pull request title must itself use
the applicable conventional prefix; branch commit subjects alone do not guarantee release
classification. Preserve a title such as `feat(release): describe the capability` for a minor
release or `fix(release): describe the correction` for a patch release through merge. The build
quality gate rejects non-conventional pull request titles and reruns when a title is edited.

The calculated version is injected into Electron package metadata without changing the source
commit. The reusable Windows job must still pass its native dependency build, Windows updater and
private-DACL integration tests, persistent bootstrap smoke test, packaged startup benchmark, and
isolated boundary harness. It also packages two synthetic consecutive versions and drives the real
`ReleaseUpdateManager` through local download staging, the native target bootstrap, checkpoint,
stable-launcher restart, candidate promotion, and predecessor retention in an isolated runner root.
Harness builds compile both the managed runtime root and the launcher's recovery-data root beneath
that disposable `RUNNER_TEMP` parent; production launchers keep the normal LocalAppData and AppData
defaults. The integration restores any pre-existing Relay shortcuts and waits for the promoted
runtime to become quiescent before deleting its owned parent.
That job continues to pass
`Relay.exe` internally so build and baseline workflows share the same verified executable. The
release job packages that executable as `Relay-vX.Y.Z-windows-x64.zip`, with exactly one top-level
member named `Relay.exe`, and creates a draft release containing only the ZIP plus
`Relay-vX.Y.Z-windows-x64.zip.sha256`. Before publication, the workflow requires both GitHub asset
digests to match the locally generated bytes. It then publishes the draft as the normal latest
release and waits for GitHub to report the release immutable with two valid SHA-256 asset digests.
The checksum covers the downloadable ZIP, not the executable inside it. Repository release
immutability must remain enabled; a mutable published release is notification-only and cannot be
installed by Relay.

The injected package version is also the installed version shown under **Settings > About**. Desktop
Relay checks GitHub's latest public normal release at startup and every 15 minutes while running.
Completed results are not cached, so each scheduled check can discover a newly published version;
concurrent requests still share one in-flight lookup. When a newer `vX.Y.Z` release exists, Relay
shows one advisory notification per version and a persistent, non-dismissible header action. The
header uses `Update · vX.Y.Z` in wide layouts and `vX.Y.Z` at the 1200 px compact-shell breakpoint,
updates when a later release is discovered, and remains until the installed version is current.
The toast's **Review update** action and the header control open the **Update Relay** dialog. On a
packaged Windows x64 build, an immutable release with the exact expected assets exposes three
separate manual actions: **Download update**, **Install update**, and **Restart Relay**. Relay never
downloads, executes, or restarts from a release check alone. Mutable or malformed releases remain
reviewable on the fixed GitHub Releases page but are not installable.
The immutable-release re-fetch and response body remain inside the explicit download's abort and
deadline scope. Cancelling while GitHub metadata is pending returns the dialog to the available
state and allows another download attempt instead of leaving the action single-flighted.

The update dialog also renders the validated latest-release notes. **Settings > About** reads up to
ten stable releases from the persistent desktop cache immediately, then refreshes the fixed GitHub
history endpoint in the background. Conditional ETag requests avoid downloading an unchanged
history; immutable cached notes are never replaced. Cached notes remain available offline, while a
first-load failure offers an explicit retry and does not affect updater actions. The serialized
cache is capped at 512 KiB; refresh keeps the newest entries that fit so a successful write always
remains readable by the same bounded loader.
The updater dialog version-binds those notes to its active manager snapshot. A newer discovery
result cannot replace notes for an older update that is installing or waiting for restart; missing
same-version notes render as unavailable instead of showing another release's body.

Packaged Windows x64 updates also participate in retained-build recovery. The stable launcher keeps
the current runtime plus the three most recently promoted runtimes. Before restart, server mode
stops PocketBase and takes a complete data snapshot; client mode checkpoints its local cache and
pending-change databases. The candidate must complete a 60-second supervised health probation
within the shared 195-second launcher deadline before promotion. Every protocol-2 runtime marker
contains SHA-512 hashes for the executable, every shipped Electron DLL, application archive,
PocketBase executable and privileged hook, `better-sqlite3`, and Koffi; the catalog binds the marker
hash, and both native and TypeScript recovery paths verify the marker plus those files. A failed
candidate is removed, the server snapshot is restored when applicable, the prior runtime resumes,
and that exact immutable `tag@commit` fingerprint is retained in a bounded quarantine history rather
than blocking a different commit at the same version.

If restart preparation fails after server or client teardown begins, Relay restarts through the
stable supervisor so the current runtime and its services return without accepting an incomplete
candidate. Server restoration keeps the displaced live-data tree until the journal is complete and
the activated catalog proves the intended build is current; interrupted cleanup is retried on the
next launcher start. Promotion and automatic rollback write a transaction-bound settlement intent
before activating `state.ini`. On startup the launcher proves that intent against the terminal
catalog state and clears an interrupted update request before retrying displaced-data cleanup.
Successful protected preparation is resumable across a normal exit, crash, or Windows restart. A
stable-launcher start with a valid pending checkpoint preserves `update-request.ini` and
`prepared.ini`, launches the current runtime, and lets the new main process restore **Restart Relay**
only after revalidating the source state and complete prepared runtime. It does not activate the
candidate automatically. The Windows boundary harness exercises this pending launch before
completing the checkpoint and promotion.

The stable launcher has its own compatibility generation, separate from the recovery-state protocol.
Any launcher behavior change must advance both the launcher generation and its probe exit code so a
new bootstrap cannot mistake an older executable for the required supervisor. The packaged Windows
smoke test installs the previous artifact first, then requires the current installer to expose the
expected launcher probe before accepting the prepared update.

**Settings > About > Recovery** is the normal operator surface. Only a freshly reauthenticated Owner
can roll back or repair. A server rollback snapshots the version being left before restoring the
selected version's snapshot, while client rollback preserves the cache and pending queue. Data epoch
mismatches block rollback. A missing retained runtime can be rebuilt from only its exact immutable
GitHub tag and full commit; repair does not alter current data or select the repaired build. The
Start-menu **Relay Recovery** shortcut and automatic launcher fallback open this same screen from a
verified retained runtime when the current runtime cannot start.

A new installation establishes a recovery baseline with no predecessors. An installation upgraded
from legacy launcher state establishes the protocol-2 baseline during its first subsequent in-app
update, using the executing recovery-capable runtime as the only initial predecessor; an older
runtime without complete recovery identity is never guessed into the catalog. Therefore rollback
choices appear only after at least one recovery-aware update has passed probation.

That first recovery-aware update attempts the protected transaction normally. If preparation fails,
the updater may retry the installer once through direct prepare-only activation, but only after it
removes the protected request, revalidates the staged bytes, and re-reads a non-redirected
protocol-1 `state.ini` that names the canonical running build. This preserves the manual-upgrade
compatibility path without allowing protocol-2 state, a retained fallback runtime, malformed legacy
metadata, or a changed installer to bypass recovery validation. The successful direct path restarts
through the stable launcher and remains protocol 1 until a later protected update can establish the
baseline.

Builds that predate the desktop updater must still be upgraded manually. Once a build has the manual
update flow, a newer installer replaces any incompatible stable launcher before staging its runtime,
so the in-app update can cross launcher generations safely. Relay Web does not receive the desktop
updater bridge. A failed or malformed GitHub response remains silent so update discovery cannot
interrupt normal operations or erase a previously confirmed update; failures after an explicit
updater action are shown with a recovery path.

Focused renderer coverage for this flow must verify the dynamic release label, later-version
replacement, persistence after a failed refresh, one notification per version, the recoverable
open-release error, malformed-success handling, desktop-only rendering, the three manual actions,
download progress and cancellation, immutable-release refusal, wide and compact-shell label
variants, structured release-note rendering, cached/offline history states, and 400 px minimum-width
geometry with the Windows window-control reservation. Recovery coverage must also exercise strict
catalog/request parsing, current-plus-three rotation, stopped server snapshots, client WAL
checkpoints, probation success and failure, PocketBase Job Object containment, native promotion and
restore contracts, Owner reauthentication, incompatible or missing rollback targets, exact-tag
repair, fallback-runtime UI, and transaction-aware runtime/snapshot cleanup.

Release runs queue instead of cancelling one another. A rerun treats a release attached to the exact
commit as complete only when the ZIP and checksum are both present, their uploaded metadata and
API digests are canonical, the checksum matches the ZIP, the archive passes an integrity check, its
exact member list is `Relay.exe`, and GitHub reports the release immutable. An incomplete draft is
deleted and rebuilt cleanly before publication; asset uploads are never overwritten in place. A
published release is never repaired or overwritten: incomplete, mutable, corrupt, or structurally
invalid published state fails closed and requires a new version. Older releases keep their original
asset format. Do not publish through a local npm script or tag a commit outside `main`; merge the
release-worthy conventional commit through the protected `main` pull-request workflow.

## CI Verification and Exact-Tree Reuse

The Build workflow keeps the required `Build quality gate` as a fail-closed aggregate of static
checks, unit tests, and two renderer-test shards. The security workflow similarly runs unit
coverage and two renderer-coverage shards, merges their reports before Sonar analysis, and keeps
the required `Snyk security gate` fail closed. Sonar always runs for the exact final `main` commit,
including its reviewed-issue reconciliation; optimization never turns a post-merge branch Sonar
scan into a reused PR result.

Vitest suppresses console output from passing tests while retaining failure output. The ESLint,
Prettier, and Sonar content-addressed caches are advisory and failure-tolerant: they can improve
runtime but cannot supply correctness, credentials, dependencies, build outputs, or release
assets.

Merged internal pull requests can be evaluated for exact-tree reuse. The resolver remains in
shadow mode by default; only the exact repository variable value
`RELAY_CI_TREE_REUSE_MODE=enabled` permits reuse. Enabling it still requires matching internal PR,
base, head, parent, recursive tree, required-check, workflow-run, and artifact provenance. Any
missing, malformed, ambiguous, stale, expired, or mismatched signal selects the normal full Build,
Snyk, and coverage work instead. The PR provenance attestation and merged LCOV artifact last one
day and are optimization evidence only, never a release or branch-protection authority.

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
documented status API. Juniper Mist uses the credential-free SorryApp API at `status.mist.com` and
is fetched once per poll before notices are routed to Global, EMEA, APAC, and Federal buckets.
Primary Dropbox availability uses the official credential-free Statuspage summary endpoint at
`status.dropbox.com`; Dropbox Sign remains outside this provider row.

Equinix availability uses the official credential-free Statuspage summary endpoint at
`equinixproductstatus.statuspage.io/api/v2/summary.json`. Keep it in the extension snapshot so it
participates in polling, retention, feed-error handling, posture, refresh, counts, and notifications.
Its public status page must remain an exact-host desktop external link with a lookalike-host denial
test.

Provider-family additions must preserve existing renderer/server contracts. When older clients do
not recognize a new provider union, keep the existing snapshot exact and add a separate
server-owned compatibility singleton. Updated clients can merge the partitions; do not append new
provider keys to a record consumed by older clients.

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

The Relay server polls Dynatrace Grail for open problems and a rolling year of resolved history.
Problems, local NOC notes, and local addressed metadata are stored in PocketBase, so clients on the
LAN see the same operational history without sending local response data back to Dynatrace.

The server-owned query has three mutually exclusive scope modes: all problems, one or more selected
alerting profiles, or one custom DQL filter expression. Administration presents the server-discovered
alerting-profile catalog as a multi-select list. Custom DQL is never combined with that list; switching
modes clears the inactive filter when the scope is saved. A legacy configuration or request that
contains both is treated as custom-DQL-only.

Normal problem polling also checks the cached alerting-profile catalog. Relay fetches a fresh catalog
at most once per hour and always refreshes it during a forced reconciliation, so newly created
profiles become selectable without waiting for the daily full problem reconciliation. A temporary
catalog failure preserves the last successful list and does not interrupt problem synchronization;
ordinary retries remain hourly.

Relay preserves the complete custom expression, including its internal `or` and `and` clauses. It
polls `dt.davis.problems` directly for the latest display state, but determines custom-scope
eligibility by applying the expression to the raw `DAVIS_PROBLEM` event stream used by Dynatrace
workflows. Matching event IDs are joined back to the latest problem view, so Relay does not wait for
workflow execution or email delivery. Full custom-scope reconciliation walks the eligible one-year
set in stable problem-ID pages instead of treating Dynatrace's per-query record limit as the end of
the result. Expressions may reference `event.status_transition`. Do not include `fetch`, a leading
`filter` pipe, other pipeline stages, comments, or control characters.

Owner and Administrator sessions manage this server-wide scope from Relay administration. Review
first runs the protected `administration.dynatrace-problem-scope.test` command, which validates the
prospective complete scope with Dynatrace and returns the currently active match count. Syntax or
request failures prevent the write. A valid zero-match scope is allowed but shown as a warning. The
matcher is exposed only in the protected administration snapshot; ordinary public Dynatrace
settings remain compatible with clients that know only the alerting-profile list. A profile update
from such a client selects profile mode and clears custom DQL rather than combining the two
mechanisms.

Saving a validated scope queues a full reconciliation and returns without holding the administration
request open for the one-year backfill. Problems that leave scope are marked hidden instead of being
deleted, preserving their notes and local disposition. Incremental custom-scope polls fetch both new
workflow-eligible matches and the latest records for all changed problems. A later delivery-only
update that does not match the expression cannot revoke an already eligible problem, but its latest
status and details still refresh in Relay. Daily reconciliation remains authoritative for the
complete rolling-year eligibility set. A truncated full custom-scope result fails closed and leaves
the last complete visible scope intact.

After a successful sync, Relay removes resolved problems whose Dynatrace end time is more than 365
days old. Records excluded from scope receive the same 365-day retention window. Associated local
notes and addressed state are removed only when their problem record reaches that retention
boundary. In-scope open problems are never aged out, even when they began more than a year ago.

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

`npm run test:electron` builds the current source before launching Playwright so it cannot test a
stale `dist` tree. Test-mode Electron windows remain native-hidden and unfocused; on macOS the test
process also uses accessory activation policy so the suite does not take over the interactive
desktop. Run the command through npm so its native-module ABI restoration always executes.

Changes to the Windows bootstrap, stable launcher, retained-runtime metadata, rollback, or repair
path also require `npm run build:win`. The local package script compiles both NSIS executables,
produces the Windows package for target-binary inspection, and restores the host `better-sqlite3`
module afterward. The Windows CI package job additionally exercises the persistent-bootstrap
boundary harness. Unit and source-contract tests are valuable on macOS, but only that Windows job
and its packaged smoke and updater-manager integration tests exercise the actual native bootstrap,
stable process supervisor, Job Object, shortcut, retained build, snapshot swap, restart, and
probation lifecycle.

`npm run test:web` builds Relay, starts a real Relay Web server in an isolated temporary data directory, and runs the critical browser workflow in Chromium profiles for Chrome and Edge plus WebKit for Safari. Run the command through npm so the native `better-sqlite3` module is restored to the correct ABI after Electron exits.

Coverage thresholds are currently 80% for lines, functions, branches, and statements in the main/shared and renderer configs. The cache config has no independent coverage threshold.

Renderer coverage is run through the renderer test wrapper:

```bash
npm run test:renderer -- --coverage
```

Security scanners require credentials and repository context. Pass credentials through the
environment or an OS secret store, never command arguments:

```bash
npm run test:coverage:sonar
npm run security:sonar:ci -- --pull-request=<number>
npm run security:sonar:ci -- --branch=main
npm run security:snyk:ci
```

Sonar reads `SONAR_TOKEN`, `SONAR_ORGANIZATION`, optional `SONAR_HOST_URL`, and `GITHUB_SHA`.
Snyk reads `SNYK_TOKEN`, optional `SNYK_ORG`, and the standard GitHub repository/ref variables.
Use lower-level commands only when diagnosing one phase:

```bash
npm run security:sonar -- -Dsonar.organization=<organization>
npm run security:sonar:quality-gate -- wait-analysis --branch=main
npm run security:sonar:issues -- --branch=main
npm run security:sonar:quality-gate -- check-quality-gate --branch=main
npm run security:snyk
```

The CI wrappers classify runs as Clean, Finding, Unavailable, or Configuration. Finding and
Configuration block. Unavailable is limited to documented transient scanner/network failures; it
produces no security decision and must be retried before release. Missing credentials, invalid
scope, authorization failures, malformed responses, and unknown failures are Configuration errors.

`test:coverage:sonar` generates the LCOV inputs used by Sonar without enforcing the repository's
aggregate local thresholds. Use `npm run test:coverage` when you need the local aggregate-threshold
decision.

`.github/workflows/security.yml` owns the exact pull-request and `main`-branch gate sequence.
Publishing requires successful Build, SonarQube, and Snyk checks plus resolved review findings.
If a fixed CodeRabbit review has not resumed, comment `@coderabbitai review` on the pull request and
wait for its Request Changes state and review conversations to clear.
See `docs/SECURITY.md` for security policy and gate interpretation. The reviewed-finding reconciler
is a restricted `main`-branch write operation and is not part of normal local development.

### Screenshot Refresh

The README screenshot set is produced by an explicit Electron Playwright harness:

```bash
npm run build
RELAY_CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/redesign-screenshots.spec.ts -c playwright.electron.config.ts
```

Generated images land in `tmp/redesign-shots/`. Inspect them for demo-only content and accidental
overlays before copying the current README set:

```bash
cp tmp/redesign-shots/compose.png docs/screenshots/compose.png
cp tmp/redesign-shots/alerts.png docs/screenshots/alerts.png
cp tmp/redesign-shots/oncall.png docs/screenshots/oncall.png
cp tmp/redesign-shots/knowledge.png docs/screenshots/knowledge.png
cp tmp/redesign-shots/cloud-status.png docs/screenshots/cloud-status.png
cp tmp/redesign-shots/radar.png docs/screenshots/radar.png
```

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
