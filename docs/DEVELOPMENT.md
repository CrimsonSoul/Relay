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

## Dependency Compatibility

Use Node.js 22.23.2 LTS from `.node-version`, with matching Node 22 type declarations, and
install the committed lockfile with `npm ci`. Dependency updates must satisfy peer requirements
and the native runtime contract as well as passing tests. Do not bypass peer validation to force
an unsupported major version into the tree.

The current compatibility bounds are deliberate:

- Node 22 avoids a native cleanup crash reproduced with better-sqlite3 12 rebuilt against
  Node 24.20 headers. Fresh prebuilt installs can hide it; verify the cache tests after native
  module restoration before advancing the Node major version.
- Electron 42 retains Windows prebuilt bindings for better-sqlite3 12; Electron 43's ABI has no
  matching upstream Windows prebuild, so packaging from macOS fails. Electron 44 also removes the
  separate ANGLE libraries required by existing Windows runtime markers. Moving beyond these
  bounds requires verified Windows native builds and a compatible updater transition, including
  validation by already installed clients and retained-build rollback.
- better-sqlite3 12 retains the native binding location covered by the same integrity contract.
  Version 13 moves the loaded binding to `prebuilds/win32-x64.node`; that transition needs the same
  compatibility verification before deployment.
- electron-vite 5 supports Vite through version 7. Keep Vite 7 and React plugin 5 together until
  electron-vite supports Vite 8.
- The React and JSX accessibility lint plugins support ESLint through version 9. The TypeScript
  parser supports TypeScript below 6.1. Keep ESLint 9 and TypeScript 6 until those peer bounds move.
- plist 4 remains loadable by CommonJS packaging consumers on Node 22. Version 5 exposes only an
  import entry point. The existing legacy inflight compatibility override remains pinned rather
  than substituting lru-cache 11's incompatible export shape.

Check the upstream releases again when changing these bounds. Ordinary compatible package and
lockfile updates do not authorize dropping runtime integrity checks or changing existing data.

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
release or `fix(release): describe the correction` for a patch release through merge. The
lightweight title gate rejects non-conventional pull request titles and reruns when a title is
edited without restarting the heavy Build workflow.

The calculated version is injected into Electron package metadata without changing the source commit.
Production Windows packaging always rebuilds native dependencies for the packaged Electron runtime.
Do not cache the mutable better-sqlite3 build directory: packaging and test cleanup restore the host
Node ABI, which can poison a later cache hit. Before upload, the Windows job verifies both native
modules are x64 PE32+ binaries and loads packaged SQLite in a disposable copy of the packaged Electron
executable to execute an in-memory query. Architecture checks alone cannot detect an ABI mismatch.
Host ABI restoration allows the dependency's matching prebuilt binary (including its download cache),
with the installer's source compilation fallback, then runs a fresh Node process and an in-memory
SQLite query to verify the result. It also clears Electron's stale `.forge-meta` ABI markers so the
next package build cannot mistake the restored Node binding for an Electron binding.
Prepackaged synthetic fixtures do not modify native binaries;
they run the host query without rebuilding those dependencies.
The reusable Windows workflow builds the production artifact once, including Windows updater and
private-DACL integration tests and the native checks above. Bootstrap smoke tests and startup
benchmarks then consume that exact artifact on separate disposable Windows runners; each verifies
its SHA-256 against the build job's output, and bootstrap also verifies the previous-artifact digest.
The synthetic updater/boundary job runs alongside the production build. Every branch must succeed
before `Windows package quality gate` exposes the artifact name to the caller. Uploaded candidates
from incomplete or failed runs are never release authority or successful baseline evidence.
Native recovery coverage packages synthetic consecutive fixture versions and exercises
bootstrap activation, stable-launcher fallback, probation, promotion, and predecessor retention in a
disposable `RUNNER_TEMP` root. The updater integration archives the target fixture as the only
top-level `Relay.exe`, drives `ReleaseUpdateManager` through download, extraction, revalidation,
native preparation, stable-launcher restart, promotion, staging cleanup, and predecessor retention.
It restores any pre-existing Relay shortcuts and removes only its owned temporary parent.

The release job packages the verified production executable as
`Relay-vX.Y.Z-windows-x64.zip`, with exactly one top-level member named `Relay.exe`, and creates a
draft release containing only the ZIP plus `Relay-vX.Y.Z-windows-x64.zip.sha256`. Before
publication, the workflow requires both GitHub asset
digests to match the locally generated bytes. It then publishes the draft as the normal latest
release and waits for GitHub to report the release immutable with two valid SHA-256 asset digests.
The checksum covers the downloadable ZIP, not the executable inside it. Repository release
immutability must remain enabled; a mutable published release is notification-only and cannot be
installed by Relay.

For a release pipeline test, set the repository variable `RELAY_RELEASE_TEST_TREE` to the exact
verified Git tree SHA before merging. Only a matching source tree stays draft-only: all quality,
packaging, and Windows gates still run, uploaded ZIP/checksum bytes are downloaded and verified,
and an `always()` cleanup removes only the matching draft at the expected source commit. The test
never publishes a release or creates its release tag. Remove the variable after the run. This
measures push-to-verified-draft time; public promotion and immutability confirmation are excluded.
Malformed test-tree configuration fails closed. Other source trees follow normal publication.

The injected package version is also the installed version shown under **Settings > About**. Desktop
Relay checks GitHub's latest public normal release at startup and every 15 minutes while running.
Completed results are not cached, so each scheduled check can discover a newly published version;
concurrent requests still share one in-flight lookup. When a newer `vX.Y.Z` release exists, Relay
shows one advisory notification per version and a persistent, non-dismissible header action. The
header uses `Update · vX.Y.Z` in wide layouts and `vX.Y.Z` at the 1200 px compact-shell breakpoint,
updates when a later release is discovered, and remains until the installed version is current.
The toast's **Review update** action and the header control open the **Update Relay** dialog. On a
packaged Windows x64 build, an immutable release with the exact expected assets exposes three explicit
actions: **Download update**, **Install update**, then **Restart Relay**. Relay never downloads,
prepares, or restarts from a release check alone. Mutable or malformed releases remain reviewable on
the fixed GitHub Releases page but are not installable. The immutable-release re-fetch and
response body remain inside the explicit download's abort and deadline scope. Cancelling while GitHub
metadata is pending returns the dialog to the available state and allows another download attempt
instead of leaving the action single-flighted.

The update dialog also renders the validated latest-release notes. **Settings > About** reads up to
ten stable releases from the persistent desktop cache immediately, then refreshes the fixed GitHub
history endpoint in the background. Conditional ETag requests avoid downloading an unchanged
history; immutable cached notes are never replaced. Cached notes remain available offline, while a
first-load failure offers an explicit retry and does not affect updater actions. The serialized
cache is capped at 512 KiB; refresh keeps the newest entries that fit so a successful write always
remains readable by the same bounded loader.
The updater dialog version-binds those notes to its active manager snapshot. A newer discovery result
cannot replace notes for an older update that is installing or waiting for restart; missing same-version notes render as unavailable
instead of showing another release's body.

The standalone Windows installer and stable launcher retain Relay's existing retained-build recovery
contract. The stable launcher keeps the current runtime plus the two most recently promoted
runtimes. Every protocol-2 runtime marker contains SHA-512 hashes for the executable, every shipped
Electron DLL, application archive, PocketBase executable and privileged hook, `better-sqlite3`, and
Koffi; the catalog binds the marker hash, and native and TypeScript recovery paths verify the marker
plus those files. A failed candidate is removed, server data is restored when applicable, the prior
runtime resumes, and that exact immutable `tag@commit` fingerprint is retained in bounded quarantine
history rather than blocking a different commit at the same version.

The in-app updater writes a pending protected request and runs the verified staged installer with
`/relay-prepare-only` plus that transaction ID. The bootstrap prepares the target runtime without
closing Relay. The explicit restart action then resolves the configured mode, stops server services
and snapshots server data or checkpoints the client cache and pending queue, atomically completes the
request, and relaunches through the stable supervisor. The supervisor probation-tests the candidate and
either promotes it or restores the prior runtime and server snapshot. A valid prepared transaction is
resumable after process loss; mismatched recovery metadata fails closed. The Windows updater integration
drives download, preparation, restart, promotion, cleanup, and predecessor retention through real native
executables in a disposable root.

The stable launcher has its own compatibility generation, separate from the recovery-state protocol:
the current generation is `7`, with probe exit code `107`.
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

A new installation establishes a recovery baseline with no predecessors. An update from legacy
launcher state establishes the protocol-2 baseline using the executing recovery-capable runtime as the
only initial predecessor; an older runtime without complete recovery identity is never guessed into the
catalog. Therefore rollback choices appear only after at least one recovery-aware update has passed
probation.

Builds that predate the desktop updater must still be upgraded manually. Newer builds prepare updates
in app, and the installer replaces an incompatible stable launcher before staging its runtime so the
flow can cross launcher generations safely. Relay Web does not receive the desktop updater
bridge. A failed or malformed GitHub response remains silent so update discovery cannot interrupt
normal operations or erase a previously confirmed update; failures after an explicit updater action
are shown with a recovery path.

Focused renderer coverage for this flow must verify the dynamic release label, later-version
replacement, persistence after a failed refresh, one notification per version, the recoverable
open-release error, malformed-success handling, desktop-only rendering, the three explicit stages,
download progress and cancellation, immutable-release refusal, install and restart failures, wide
and compact-shell label variants, structured release-note rendering, cached/offline history states,
and 400 px minimum-width geometry with the Windows window-control reservation. Main-process coverage
must prove staged revalidation, protected preparation, checkpoint-before-relaunch, resumability, and
cleanup. Recovery coverage must exercise current-plus-two rotation, stopped server snapshots,
client WAL checkpoints, probation success and failure, PocketBase Job Object containment, native
promotion and rollback, strict runtime integrity, quarantine, settlement reconciliation, manual
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

The Build workflow owns the full pull-request and `main` verification graph. Its required
`Build quality gate` fails closed over formatting, linting, type checking, dependency audit, the
production build, unit coverage plus cache integration tests, four renderer-coverage shards, and
the mandatory `workflow-tests` matrix. Four isolated Electron runners execute
`npm run test:electron -- --fully-parallel --workers=1 --shard=N/4` under Xvfb with an unlocked
ephemeral keyring. Test-level sharding divides large specs across runners while keeping one worker
per runner. A fifth runner executes
`npm run test:pocketbase -- verification/offline-replay-real-pb.test.ts verification/dynatrace-pipeline.test.ts`,
then `npm run test:web` under Xvfb against Chromium and WebKit. Electron runners install only the
Linux libraries they need; the web runner downloads the browsers. Each job uses its own npm install,
and both browser-driven suites retain the npm wrappers that restore the Node native-module ABI.
The matrix runs on every Build invocation, including when exact-tree reuse succeeds; fail-fast is
disabled so every shard reports its result, with uniquely named failure artifacts. Any unsuccessful
or missing matrix result blocks the aggregate gate and the Release workflow that waits for it.
Those coverage jobs are canonical: Sonar consumes their merged reports instead of rerunning the
same tests. The required `SonarQube quality gate` and `Snyk security gate` names remain stable in
the same workflow. Sonar always runs for the exact final `main` commit, including its reviewed-issue
reconciliation; optimization never turns a post-merge branch Sonar scan into a reused PR result.
When validated PR Snyk findings are reused, a lightweight main-only monitor still refreshes the
canonical Snyk project snapshot before the required Snyk gate succeeds.

The Sonar wrapper records analysis/upload, server wait, reviewed-issue reconciliation, issue indexing,
and quality-gate timings in the GitHub job summary, including failed phases. It also ranks completed
sensors reported in the retained normal scanner output. Sensor timings are included in the
analysis/upload phase and must not be added to that phase's elapsed time. This diagnostic summary
uses sanitized timing fields, enables no verbose credential-bearing logs, and cannot change a gate
verdict. Full final-main analysis, security rules, issue checks, and release blocking remain required.

Pull-request title validation runs in the lightweight `Pull Request Title` workflow. Title edits
rerun only its `Release-compatible pull request title` check, not the heavy Build graph. Automatic
Windows packaging runs only once per `main` commit through the Release workflow; the Build
workflow's Windows package remains available by manual dispatch and uses the latest successful
Release artifact as its comparison baseline.

Vitest suppresses console output from passing tests while retaining failure output. The ESLint,
Prettier, and Sonar content-addressed caches are advisory and failure-tolerant: they can improve
runtime but cannot supply correctness, credentials, dependencies, build outputs, or release
assets. ESLint and Prettier may restore a matching dependency-and-configuration prefix from an
earlier commit because both tools validate file content before accepting cached results.

Merged internal pull requests can be evaluated for exact-tree reuse. The resolver remains in
shadow mode unless the exact repository variable value `RELAY_CI_TREE_REUSE_MODE=enabled` permits
reuse. The production repository enables that mode, but reuse still requires matching internal PR,
base, head, parent, recursive tree, all required checks, the dedicated title workflow run, the
shared Build workflow run, and both attestation artifacts. Any missing, malformed, ambiguous,
stale, expired, or mismatched signal selects the normal full Build, Snyk, and coverage work
instead. The PR provenance attestation and merged LCOV artifact last one day and are optimization
evidence only, never a release or branch-protection authority.

Credentialed Sonar and Snyk jobs run only for same-repository pull requests. Repository write
access therefore crosses the CI scanner-secret trust boundary: review who receives it and treat
their branches as privileged. Fork pull requests are excluded from those jobs and do not receive
the scanner credentials.

CodeRabbit review is manual while the public repository is ineligible for its automatic review
tier. Request it with `@coderabbitai review`; its findings remain blocking through review state and
required conversation resolution, but a skipped CodeRabbit status is not represented as automatic
review coverage.

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

Packaged Windows `stable` samples also include `launcherTiming`. The native launcher writes a
bounded local numeric marker only when `RELAY_BENCHMARK_EXIT_AFTER_RENDER=1` and
`RELAY_BENCHMARK_RUN_ID` is a valid UUID. The benchmark reads that marker and reports:

| Field                       | Measured work                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `elapsedMs`                 | Native launcher interval from benchmark initialization through successful runtime process creation             |
| `runtimeValidationMs`       | Total runtime validation time across all attempted runtimes                                                    |
| `contentHashMs`             | Launch-critical content hash verification, included within `runtimeValidationMs`                               |
| `processCreationMs`         | Time in the native runtime process creation call                                                               |
| `runtimeValidationCount`    | Number of runtime validation attempts                                                                          |
| `outsideMeasuredLauncherMs` | Remaining outer process lifetime, including Windows process setup, the NSIS prologue, marker writing, and exit |

`outsideMeasuredLauncherMs` subtracts `elapsedMs` from `processHandoffMs` and clamps small negative
timer-resolution differences to zero. The packaged summary reports per-field medians only when
every sample has a valid marker. Missing markers, including older launchers, and the `prepare` and
`portable` scenarios report `launcherTiming: null`; they do not fabricate zero-duration samples.
Malformed markers fail the benchmark. Startup performance conclusions require measurements from
the actual packaged Windows launch path.

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

Queued desktop updates and deletes use `POST /api/relay/offline/replay` after reading the server
revision. The existing integrity-verified `relay_privileged_reauth.pb.js` hook validates the
allowlisted base collection, normal API rule, and update fields, then compares the observed
`updated` revision and a canonical public-record SHA-256 fingerprint before applying the mutation
in one transaction. The fingerprint distinguishes changes with the same millisecond timestamp;
field modifiers are resolved before API rules are evaluated. A concurrent change returns a
conflict and leaves the queued mutation pending. Creates and ordinary online CRUD retain their
existing PocketBase routes, including for older clients. An older server without the replay route
returns 404; new clients retain those pending changes and tell the operator to update the Relay
server before syncing them.

### Data import and export

Data Manager imports JSON, CSV, and XLSX through `importExportService`. Notes match by
`entityType` plus `entityKey`; on-call entries match by team, role, and name (omitted role/name
match empty text). A repeated import updates the matching record without changing its ID.
Ambiguous on-call matches produce a row error so operators can resolve existing duplicates.
Malformed identities also produce row errors without writing that row.

The export metadata checkbox controls IDs, timestamps, and PocketBase collection metadata in
all three formats, including all-category exports. Data Manager defaults to excluding metadata;
direct export service callers retain the existing include-metadata default. Import always removes
metadata before writing. Full backup restore is a separate desktop server operation; its stopped
replacement and recovery contract is documented in `docs/SECURITY.md`.

Servers additionally offer **Sync full list**, implemented by `serverSyncService` using the
shared `importFileParser`. Ordinary imports remain add/update only. Sync parses the entire
JSON, CSV, or XLSX file before previewing adds, updates, unchanged records, and every removal.
It requires a nonempty list (maximum 10,000 records), valid text fields, and unique server
names after trimming and case folding. Matching rows retain their ID and stored name;
omitted fields and existing custom fields are preserved. Metadata is ignored. Unknown
columns are rejected unless they exist on current server records. Other collections and
notes are untouched; no VDI classification is inferred.

The preview offers a JSON download of the current Servers records and requires explicit
review when rows will be removed. Apply requires an online, unchanged client/account and
rechecks the complete current list before writes and each removal batch. Saves finish before
removals start. `POST /api/relay/servers/sync` contains at most 100 operations and enforces
ordinary collection rules, field validation, and each update/delete target's reviewed public
record inside the same transaction as the writes. Batches are transactional individually; the full sync is not atomic. A later failure keeps confirmed earlier changes,
reports their counts, and consumes the preview. An uncertain response requires a fresh preview
rather than automatic retry. A peer edit after the last read, including a same-timestamp edit,
rejects the whole current batch. Older servers without the guarded route require a server update;
Relay never falls back to unguarded sync writes.
The downloaded list is a data export, not a full database recovery archive.

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
missing or not registered. The hook and paired-client reauthentication call must be tested as a
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

Renderer authentication uses an in-memory PocketBase auth store and removes legacy persisted SDK
credentials. Refresh and health completions belong to their originating client/lifecycle; changing
servers, loading a fresh session, or stopping that lifecycle invalidates stale completions.
Confirmed authentication rejection stays latched through subsequent network errors. A definitive
Web gateway 401 also requests in-place sign-in; capability denials and outages do not.

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

The Relay server reads live problem state from Problems API v2 every 15 seconds through the
same-environment platform endpoint. One server polls for all connected clients. Open problems use an
start-time window beginning at epoch millisecond 1 (the API rejects 0), because the API filters by start/end time rather than update time.
Recent closures use at least a two-hour overlapping window. Previously open local IDs missing from
those results are queried explicitly, so a long outage cannot leave a resolved problem open forever.
Absence from an API result never means resolved. Requests are paginated, bounded, reject redirects,
and respect Retry-After. The interval is a polling target, not an end-to-end delivery guarantee.

The connection uses an OAuth client ID, client secret, and account UUID. Relay exchanges these at
`https://sso.dynatrace.com/sso/oauth2/token` with `client_credentials` and the account resource URN.
The client must allow `environment-api:problems:read`, `storage:events:read`, `storage:buckets:read`,
`storage:bizevents:read`, and `automation:workflows:read`. Its principal must also have the corresponding
environment, bucket, and workflow access, including `environment:roles:viewer`; granting scopes alone
does not grant resource access. One shared in-memory access token serves all read paths, renews before
expiry, and is invalidated on HTTP 401 so the next read obtains a fresh token. Connection replacement validates OAuth and the live
Problems API before saving, so a failed replacement preserves the previous credentials and scope.
The confirmation stays busy through authorization and server verification, preventing dismissal or
duplicate submission while the change is pending. Client credentials are encrypted in server-owned
storage; access tokens are never persisted. Legacy
platform-token configurations retain their scope and notes but require OAuth setup before syncing.

Scope remains an exclusive choice between all problems, exact selected alerting-profile names, and
one custom DQL filter expression. Profile mode uses the Problems API's exact-name selector and Relay's
existing exact-name check. Selecting profiles clears custom DQL; a legacy payload containing both
continues to select custom DQL only. The profile catalog is refreshed during daily or manually forced
history reconciliation. A slow catalog read does not gate the live feed. Selected profiles are saved
separately while DQL is active and restored when switching back to profile mode.

For live custom DQL, configure the **NOC workflow ID** in administration. Use a deployed **standard**
workflow with an active event trigger whose criteria cover every problem the Relay scope may include.
The existing NOC workflow can be reused when it covers that scope. Relay does not modify its trigger,
add tasks, or run it. A narrower source workflow cannot deliver events it never receives: broaden the
source trigger in Dynatrace before relying on a broader Relay matcher. Standard workflow execution
retention and event-trigger execution limits still apply. Relay checks source availability and
throttling at most once a minute and reports failures while continuing API updates for already
admitted problems.

The OAuth client principal needs read access to that workflow. Relay reads
`params.event` directly from event-triggered execution records, including RUNNING executions. It
passes bounded batches of these actual payloads to Dynatrace using `data json:` and a native filter.
Each payload is imported as a nested record and flattened one level before filtering, preserving
reserved metadata such as `dt.system.bucket` and nested values without rewriting the matcher. Thus
matching does not wait for event persistence or scan historical Grail records. Dynatrace evaluates the
expression; Relay does not translate DQL into JavaScript or infer missing event fields from the
Problems API. Keep the expression appropriate to the source payload's fields and types. Pipeline
commands, subqueries, comments, and control characters are rejected. Internal `or`/`and` clauses and
`event.status_transition` are preserved. Matching results join to API records by canonical problem
ID; workflow state cannot reopen an API-closed problem.

Execution reads use a fixed upper time bound, pagination, and two minutes of overlap. Startup catches
up over at least two hours; new events receive a separate recent-page read while older pages remain.
Successful per-execution matching decisions are cached, and a failed page is retried without advancing
the cursor. Only bounded presentation metadata and execution references are retained from payloads.
An unavailable matcher or source prevents new admission and is reported in sync status; already
admitted problems still receive API lifecycle updates. Existing custom scopes without a workflow ID
must configure one for live admission; their historical Grail reconciliation remains available.

A separate daily reconciliation imports the rolling year of Grail history and confirms the complete
scope. Custom-scope reconciliation uses stable problem-ID pagination and fails closed on incomplete
results. Live reads continue while historical queries are pending. Writes are serialized, and recent
live API state and newly matched workflow IDs take precedence over delayed history. Scope changes
clear the live scope cache and invalidate old in-flight work. Notes, addressed state, canonical IDs,
and relationships remain unchanged. Problems leaving scope are hidden, not deleted. Normal retention
removes resolved problems older than 365 days and scope-excluded records after the same grace period,
with their related notes and dispositions, only when backup health permits retention.

While SDP queue monitoring is active, Relay uses the recorded workflow subject or a whole problem
display ID to select candidate tickets. It verifies at most five candidates per scan through the
signed-in account's request detail endpoint. Automatic linking requires an exact canonical problem ID
in a Dynatrace problem URL for the same environment, in the ticket description. SaaS Classic and
Platform hostnames for the same tenant are equivalent; Managed environment paths remain distinct.
Ambiguous candidates, missing URLs, inaccessible tickets, and tickets predating the problem remain
unlinked. Failed/no-match checks retry after five minutes; the normal queue limits still apply.
No workflow edits, workflow executions, SDP writes, or new OAuth scopes are needed. This runs while
Relay and monitoring are active; it is not an unattended server integration.

Shared links retain identifiers plus a suppression flag. Unlink sets that flag so every current
client skips automatic recreation; explicitly linking again clears it. Existing links default to
unsuppressed. Deploy updated clients together: older clients do not understand suppression.

Email naming is independent background work, at most once a minute with one bounded attempt per
interval. Canonical records are saved before naming starts. A configured workflow supplies execution
references directly; otherwise Relay reads the existing `noc.notification` business events from
`noc-workflow`, requiring `storage:bizevents:read` and relevant bucket access. Relay then reads a
successful `dynatrace.email:send-email` task, preferring `email_noc`, after email routes reach terminal
state. It does not change templates or execute email actions. Direct workflow discovery catches up
within the execution window; previously saved historical names remain intact.

One ten-second background deadline covers name discovery and task-input reads. Up to four reads run
concurrently, with at most 25 uncached executions per attempt. Missing names retry on a later interval,
not with repeated one-second Grail scans. Partial completed subjects survive the deadline; late
responses cannot write. Completed subjects are cached per environment and credentials. Only the
validated trimmed subject (at most 1,000 characters) is retained from task inputs; recipients and
bodies are never persisted or logged. Newer names update existing in-scope rows only. The renderer
uses a recorded subject only while its recorded status matches the API status, otherwise falling back
to the workflow-event name or canonical title. Title updates cannot change lifecycle or scope.

Owner and Administrator sessions manage scope through the existing protected commands. Testing a
custom scope verifies the configured workflow and validates the expression with Dynatrace; the
historical count preview may lag live events. A valid zero-match result is allowed with a warning.
The matcher and workflow ID are exposed only in protected administration snapshots. Existing
profile-only clients remain compatible. Saving queues historical reconciliation without holding the
administration request open for the backfill. Validate a rollout against actual problem IDs in the
tenant: neither API polling nor workflow execution bypasses Dynatrace detection, alerting-rule delays,
source throttling, or API availability.

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
server uses another port. These scoped modes authenticate with the configured account and do
not create a temporary superuser.

Full fixture seeding requires `node scripts/seed.mjs --full --disposable`, an explicit loopback
`RELAY_SEED_PB_URL`, and `RELAY_SEED_PB_DATA_DIR` pointing to an existing directory beneath the OS
temporary directory after resolving symlinks. Start that disposable Relay server and initialize
its schema first. Full seeding creates a random temporary principal in that exact data directory
and authenticates it against the selected endpoint; it does not reuse configured live-server
credentials. Cleanup runs through the local PocketBase CLI even if API authentication fails,
and cleanup failure makes the command fail. Bare invocation, unknown flags, and ambiguous modes
fail before authentication or mutation; `--help` only prints usage.

The demo seed intentionally writes historical `author` and `addressedBy` snapshots but does not create a current operator identity. New ordinary Problem notes and addressed-state changes are unattributed. Keep the historical strings non-empty in fixtures so migration and rendering regressions remain visible.

### Test Suites

Relay uses three Vitest configurations:

Vitest 5 retains the existing explicit mock cleanup through `clearMocks: false`. The renderer
registers jest-dom's standalone matchers and declares their Vitest 5 types in
`src/renderer/src/vitest.d.ts`. Sharded renderer coverage uses `.vitest/blob` for both CI artifact
upload and report merging.

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
npm run test:pocketbase -- verification/offline-replay-real-pb.test.ts
npm run test:pocketbase -- verification/dynatrace-pipeline.test.ts
npm run test:electron
npm run test:web
npm run test:knowledge-upload-soak
```

`npm test` runs the main/shared, cache, and renderer suites in sequence. `test:knowledge-upload-soak` is a standalone stress harness rather than a Vitest suite.

Change correlation fixtures cover the SDP Changes projection, per-account broker read and scope,
Classic/Grail host types, ambiguous names, scheduled windows, paginated coverage and stale-account
response rejection. `npm run test:electron -- sdp-changes.spec.ts` opens an isolated problem and
exercises automatic/suggested matches plus local confirm/dismiss controls. It never contacts SDP
or Dynatrace. Production grants need renewed consent for `SDPOnDemand.changes.READ`; sandbox GET verification confirmed the scheduled-window filter, pagination flag and
detail-only affected assets/services. Change links use the observed `ChangeDetails.cc?CHANGEID=`
route. Production field population and OAuth consent remain untested.

The focused PocketBase replay test starts the downloaded binary with disposable data and verifies
concurrent update/delete rejection, normal API rules and field validation, and unchanged ordinary
CRUD for older clients. Use its explicit filename to avoid invoking unrelated verification harnesses.

The Dynatrace pipeline test uses deterministic upstream responses and a real disposable PocketBase
to check automatic polling, exact profile and workflow-DQL selection, long-ID database lookups,
realtime delivery, canonical closures, and recovery after an upstream outage. Native DQL semantics
and tenant availability require separate read-only checks against Dynatrace; this suite never uses
live credentials or live Relay data.

When upgrading the bundled PocketBase executable, run
`RELAY_VERIFY_PREVIOUS_POCKETBASE=/absolute/path/to/previous/pocketbase npm run test:pocketbase -- verification/pocketbase-upgrade.test.ts`.
This opt-in creates disposable data using the previous executable, then checks authentication,
record IDs, JSON, relations, protected attachments, unknown collections, repeated startup, and
backup/restore with the current executable. It also restores the complete stopped pre-upgrade
snapshot with the previous executable, and verifies that a server without the atomic replay hook
keeps offline edits pending while ordinary online CRUD continues to work. Deploy the Relay server
before new desktop clients so their queued edits can synchronize.
The suite accepts an executable path only and never uses an existing data directory. The PocketBase
backup API case is unavailable on Windows; the suite skips when the previous executable is not
supplied. These disposable rehearsals do not replace the native Windows updater/recovery checks
or a rehearsal against a verified production backup.

`npm run test:electron` builds the current source before launching Playwright so it cannot test a
stale `dist` tree. Test-mode Electron windows remain native-hidden and unfocused; on macOS the test
process also uses accessory activation policy so the suite does not take over the interactive
desktop. Linux critical-path tests require an unlocked GNOME keyring in a D-Bus session. Their
isolated entry point selects `gnome-libsecret` before loading Relay because Playwright otherwise
forces the `basic` password store, which cannot support privileged device pairing. CI provisions a
disposable keyring, verifies that encryption is available, and retains failed workflow diagnostics
for one day. Run the command through npm so its native-module ABI restoration always executes.
The Electron and web wrappers restore SQLite through its normal installer rather than forcing source
compilation, and require the fresh-process host SQLite query to pass even when the test suite fails.

Changes to the Windows bootstrap, stable launcher, retained-runtime metadata, rollback, or repair
path also require `npm run build:win`. The local package script compiles both NSIS executables,
produces the Windows package for target-binary inspection, and restores the host `better-sqlite3`
module afterward. The Windows CI package job additionally exercises the persistent-bootstrap
boundary harness. Unit and source-contract tests are valuable on macOS, but only that Windows job
and its packaged smoke and updater-manager integration tests exercise the actual native bootstrap,
stable process supervisor, Job Object, shortcut, retained build, snapshot swap, restart, and
probation lifecycle.

`npm run test:web` builds Relay, starts a real Relay Web server in an isolated temporary data directory, and runs browser workflows in Chromium profiles for Chrome and Edge plus WebKit for Safari. Coverage includes the 1,024-pixel shell and Web status page, connection recovery and sign-out, Compose and On-Call actions, image insertion and PNG/EML/ICS downloads, protected Dynatrace actions, and repeated PDF transfer interruptions followed by reselection, Wiki publication, and reading. Failed reselection refreshes the latest pending batch so retry and discard operate on the current transfer. Upstream Radar data is a controlled fixture; this suite does not verify live tenant access or delivery in Outlook or a calendar application. Run the command through npm so the native `better-sqlite3` module is restored to the correct ABI after Electron exits.

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

Install the official [SonarScanner CLI](https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/ci-based-analysis/sonarscanner-cli/)
8.1.0.6389 for your platform and add its `bin` directory to `PATH` before running Sonar locally.
CI installs the pinned Linux x64 distribution after checking its SHA-256 digest. The standalone
scanner replaces the npm wrapper without changing report collection or finding gates.
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
Configuration block. Unavailable is limited to documented transient scanner/network failures and
produces no security decision. Snyk therefore reports the outage and fails closed so only a clean
finding result can support exact-tree reuse; Sonar retains its warning outcome and must be retried
before release. Missing credentials, invalid scope, authorization failures, malformed responses,
and unknown failures are Configuration errors.

`test:coverage:sonar` generates the LCOV inputs used by Sonar without enforcing the repository's
aggregate local thresholds. Use `npm run test:coverage` when you need the local aggregate-threshold
decision.

`.github/workflows/build.yml` owns the exact pull-request and `main`-branch quality and security gate
sequence; `.github/workflows/pr-title.yml` owns the lightweight squash-title check. Publishing
requires successful title, Build, SonarQube, and Snyk checks plus resolved review findings. Request
CodeRabbit manually with `@coderabbitai review`, then wait for its Request Changes state and review
conversations to clear.
See `docs/SECURITY.md` for security policy and gate interpretation. The reviewed-finding reconciler
is a restricted `main`-branch write operation and is not part of normal local development.

### Screenshot Refresh

The README screenshot set is produced by an explicit Electron Playwright harness:

```bash
npm run build
RELAY_CAPTURE_SCREENSHOTS=1 npm run test:electron -- tests/e2e/redesign-screenshots.spec.ts
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

### SDP request-workspace verification

The visible Tickets workspace refreshes its current queue (including filters and pagination)
and open conversation page every 30 seconds. It pauses while account, edit, or bulk dialogs
are open. The broker coalesces and throttles background reads, preserves the current projection
until a read succeeds, and discards results superseded by foreground actions. Refresh failures
back off without extending snapshot expiry; access denial clears the account and saved copies.
Background detail reads do not mark replies read or submit changes.

The ticket backend tests under `src/main/sdp` and renderer tests under
`src/renderer/src/features/tickets` cover reviewed forwarding, request-history projection,
checklists, reminders and bounded bulk updates. Run them with the Node version from `.node-version`;
the native SQLite module must match that Node ABI. Desktop/browser suites must still run through
their npm scripts, which rebuild and restore the native module.

Cloud checklist contracts are documented at
[Checklist](https://www.manageengine.com/products/service-desk/sdpod-v3-api/checklist/checklist.html)
and [Checklist item](https://www.manageengine.com/products/service-desk/sdpod-v3-api/checklist/checklist_item.html).
Sandbox read-only inspection confirmed `requests/{id}/_history` and the notification metadata;
the sandbox's loaded Cloud request client defines `REQFORWARD` and request-scoped reminder
summary/date/lead-time/status payloads. Fixtures verify Relay's behavior without external writes.
Do not treat browser-cookie access as proof of OAuth authorization or mock confirmation as a
successful live change. Any necessary live verification for this work is restricted to the
previously identified SDP sandbox, never production; tenant-specific workflows are excluded.
