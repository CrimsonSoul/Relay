# Relay Architecture

Relay is a Windows-distributed Electron application with a shared React interface, an embedded or
remote PocketBase data plane, and an optional browser gateway for trusted networks. This guide owns
the high-level runtime, data authority, and subsystem boundaries. Current code, configuration, and
tests remain authoritative when details change.

## Stack

| Layer         | Technology                                              |
| ------------- | ------------------------------------------------------- |
| Desktop shell | Electron 42.11.2                                        |
| Renderer      | React 19.2.8                                            |
| Language      | TypeScript 6.0.3                                        |
| Build         | Vite 7.3.6 and electron-vite 5.0.0                      |
| Data store    | PocketBase 0.40.3 with SQLite; PocketBase JS SDK 0.28.1 |
| Validation    | Zod 4.5.4                                               |
| Testing       | Vitest 5.0.0 and Playwright 1.63.0                      |

Dependency and runtime declarations live in `package.json`, `package-lock.json`, and
`.node-version`. Release versions are derived from conventional commits on `main` and injected into
the packaged application by the gated GitHub release workflow.

## Delivery and CI Trust Boundaries

Release version resolution and Windows packaging may run in parallel with the exact-commit gate
wait, but versioned assets, tags, drafts, and publication remain blocked until the exact required
Build, SonarQube, and Snyk gates and the Windows package have succeeded. A single Build workflow
runs static checks and the production build, unit coverage plus cache integration tests, four
renderer-coverage shards, focused real-PocketBase replay verification, Electron and browser
workflows, SonarQube, and Snyk. The unconditional `workflow-tests` job runs
`npm run test:pocketbase -- verification/offline-replay-real-pb.test.ts` against disposable storage,
then `npm run test:electron` and `npm run test:web` sequentially through their ABI-restoring wrappers.
Sonar merges the canonical coverage reports, so
the test suites do not run a second time. A separate lightweight workflow validates pull-request
titles, and only the Release workflow packages Windows automatically after a `main` merge. Passing
Vitest output is suppressed while failure output remains visible.

Content-addressed ESLint, Prettier, and Sonar caches are advisory and cannot establish correctness.
Exact-tree reuse requires `RELAY_CI_TREE_REUSE_MODE=enabled` exactly; the production repository
enables it. Full merged-internal-PR/base/head/parent/tree/check/title-workflow-run/shared-Build-run/
artifact provenance must validate, otherwise Relay falls back to full Build, Snyk, and coverage
work. The real-PocketBase, Electron, and browser workflow job always runs, including on reused
trees, and must succeed before the Build aggregate can accept reuse. Required Build and Snyk
aggregates stay fail closed. Sonar runs on the exact final `main`
commit and performs reviewed-issue reconciliation. One-day PR attestations and merged LCOV
artifacts are optimization evidence, not release authority. Reused Snyk finding evidence still
triggers a main-only monitor upload so the canonical project snapshot follows every merge.

Credentialed Sonar and Snyk scans accept only same-repository pull requests. This makes repository
write access a privileged CI scanner-secret boundary; fork pull requests are excluded and receive
no scanner credentials.

## Runtime Model

Relay has four application layers:

1. `src/main/` owns Electron lifecycle, local services, PocketBase startup, privileged work, IPC,
   windows, logging, backups, and offline storage.
2. `src/preload/` exposes the typed `window.api` bridge to trusted Electron renderer frames.
3. `src/renderer/` owns the React interface, feature hooks, PocketBase services, runtime adapters,
   and styles.
4. `src/main/web/` optionally serves the built renderer and a narrow same-origin API to supported
   desktop browsers on a trusted LAN or private VPN.

`src/shared/` contains contracts, validation schemas, and utilities shared across those layers.

### Operating modes

- **Server mode:** Relay starts PocketBase locally, bootstraps required collections, and can expose
  approved LAN services when configured.
- **Client mode:** Relay connects to another Relay server. The client keeps its own offline snapshot
  and queued desktop mutations but does not own the server database.
- **Relay Web:** The Relay server hosts the shared renderer through a capability-limited browser
  adapter. It is an online backup path, not a separate product or public internet service.

## Data Flow

### Ordinary collection data

Renderer services under `src/renderer/src/services/` perform normal PocketBase reads and online
writes. `src/renderer/src/stores/collectionStore.ts` owns list fetches, realtime subscriptions,
reconnect reconciliation, and offline snapshot fallback; `useCollection()` is its React adapter.

Standard writes pass through `src/renderer/src/services/mutationGateway.ts`:

```text
online desktop or web -> PocketBase SDK -> Relay server
offline desktop       -> validated preload IPC -> pending queue -> replay on reconnect
offline Relay Web      -> rejected
```

The server remains authoritative. Optimistic renderer state may improve responsiveness but cannot
replace server revisions or realtime reconciliation.

### System and privileged operations

IPC is reserved for operations that require Electron, Node.js, secrets, local files, windows, or
main-process authority. Canonical bridge and channel definitions live in `src/shared/ipc.ts`, with
payload validation in `src/shared/ipcValidation.ts`.

Protected actions use a separate role-account session and the privileged command system. They do
not reuse the ordinary app-user identity, renderer storage, or offline mutation queue.

### Server-owned operational data

The Relay server owns data that must be consistent across clients:

- Service-status snapshots
- Dynatrace Problems and Relay-local dispositions
- Dispatcher Radar snapshots sourced from the server PC's CW session
- Managed Wiki metadata, protected PDFs, categories, and derived search passages
- Role-account authority, paired devices, and privileged command results

Relay Web receives bounded representations through authenticated same-origin routes. It never
receives Electron session cookies, desktop signing keys, local paths, or unrestricted system APIs.

## Main-Process Subsystems

### Application bootstrap

`src/main/index.ts` composes startup. Required workspace and PocketBase initialization complete
before Relay opens data-dependent work, while optional indexing, retention, and cleanup work starts
after the required workspace is ready. Startup behavior is split across `src/main/app/` so window
presentation, PocketBase readiness, maintenance, error handling, and shutdown have testable owners.
Renderer and GPU recovery and controlled process relaunches remain bounded by restart-loop protection.
An abrupt main-process termination leaves Relay closed until it is opened again. Update candidates
remain supervised by the stable launcher, which performs health checks and rollback independently.

For packaged Windows startup benchmarks, the stable launcher emits a bounded numeric timing marker
only under the explicit benchmark flag and a valid run UUID. Stable samples attribute the measured
launcher interval, runtime validation, content hashing, process creation, validation count, and
the remaining outer process lifetime. The latter includes Windows setup, the NSIS prologue, marker
writing, and exit. Missing markers and preparation or portable scenarios report `launcherTiming`
as `null`. Field definitions and packaged measurement requirements are in `docs/DEVELOPMENT.md`.

### PocketBase lifecycle

`src/main/app/pocketbaseBootstrap.ts`, `src/main/pocketbase/PocketBaseProcess.ts`, and
`src/main/pocketbase/CollectionBootstrap.ts` own embedded-server startup and schema readiness.
Relay bootstraps its schema in code rather than from a persistent checked-in migration directory.

The server creates or verifies its internal superuser and ordinary app user, loads checked-in
PocketBase hooks, then starts backup and retention scheduling. Authentication repair and legacy
role-account conversion are fail-closed: they preserve existing IDs, paired-device bindings, and
non-empty historical attribution. Detailed migration safety rules live in `docs/SECURITY.md`.

### App-user authentication coordination

`src/main/pocketbase/RelayAppUserAuthCoordinator.ts` single-flights matching authentication work
for main-process consumers. It distributes only validated in-memory app-user auth state and clears
short-lived completed snapshots after use. This prevents the renderer, Wiki services, search, and
reconnect paths from independently exhausting server authentication limits.

### Server/client presence

Desktop clients and Relay Web sessions write bounded heartbeat records. Server mode subscribes to
active client records and presents their sanitized host/browser labels; the server itself is not
counted. Presence is operational status, not an authorization mechanism.

### Release discovery and updates

The packaged Electron version is the installed version shown in Settings and the comparison source
for update discovery. The main process owns a bounded, credential-free request to GitHub's fixed
latest-release endpoint. It accepts only a published, non-prerelease `vX.Y.Z` release, limits the
response size and request duration, rejects redirects and malformed data, and single-flights
concurrent checks without caching a completed result. `ReleaseUpdateService` keeps ordinary
notification discovery separate from installability: installation additionally requires GitHub's
immutable flag, the exact versioned ZIP and checksum assets, uploaded state, bounded sizes, GitHub
SHA-256 digests, fixed asset API URLs, and a 40-character target commit.

The same validated response retains the release title, Markdown body, publication time, version,
and immutable state for the in-app release-notes reader. Settings reads a schema-validated,
atomically written `release-notes.json` cache from the Electron user-data directory before starting
a background refresh of GitHub's fixed release-history endpoint. The cache holds at most ten stable
releases, bounds every field and the complete response, and keeps its serialized file at or below
512 KiB by retaining the newest entries that fit. It preserves immutable entries by version and
persists GitHub's ETag so an unchanged history returns `304` without downloading the notes again. An
offline or malformed refresh leaves the last valid cache readable and cannot affect update discovery
or installation. Updater notes are accepted only when their version matches the manager-authoritative
active update. If discovery advances while an older update is installing or restart-ready, the
renderer retains only the older version's matching notes rather than attaching the newer release body.

The desktop renderer checks on startup and every 15 minutes while running. A newer normal release
produces one advisory toast per version, persisted in local renderer storage, with a **Review update**
action. The validated latest version also drives a non-dismissible header indicator that remains
visible until the installed version is current and changes to Downloading, Install, or Restart as the
operator progresses. A failed refresh does not clear a previously confirmed update, and a same-version
check cannot overwrite download or restart-ready state.

The **Update Relay** dialog is the only renderer workflow. Its fixed preload actions carry no URL,
path, filename, or command argument from the renderer. Its release-review action may carry only a
validated normal version, which the main process expands beneath Relay's fixed Releases URL.
`ReleaseUpdateManager` owns a three-stage **Download update**, **Install update**, and **Restart Relay**
state machine.
Unsupported or unpackaged desktop runtimes retain notification-only GitHub review and do not expose an
enabled download action. The downloader re-fetches the release before use, follows at most three HTTPS
redirects across the fixed GitHub asset host set, streams to an exclusive `.part` file in a protected
per-version directory under `%LOCALAPPDATA%\Relay\Updates`, atomically renames the verified file,
and requires the byte count and GitHub digest to match. The checksum file must independently name the
exact ZIP and declare that same digest. The ZIP reader accepts one regular, non-encrypted top-level
member named `Relay.exe`, bounds expansion, validates CRC and the Windows executable marker, and
rejects traversal, links, directories, and unsupported compression. The immutable-release re-fetch
shares the operator download's abort signal, and its request deadline remains active until the bounded
response body has been consumed and validated. Cancelling during that metadata step drains the
single-flight operation, restores the available state, and permits an immediate retry; a deadline
failure remains a retryable download failure. Metadata verification is included in the downloading
phase, so progress and cancellation are available before the archive starts. HTTP and connection
failures during discovery verification are reported as retryable download failures, not corrupt files.

Immediately before execution, the manager revalidates the private staging path and re-hashes the
extracted executable. Current and retained runtime integrity checks use Electron's `original-fs`
to inspect and hash the physical `app.asar`; Electron's regular filesystem API presents that archive
as a virtual directory. Installation launches that exact file with `/relay-prepare-only` and a generated,
fixed-format recovery transaction ID. The native bootstrap prepares the new runtime while the current
Relay process stays open. A successful preparation changes the state to restart-ready; only the final
explicit action checkpoints the current mode, validates the stable launcher, and relaunches through
`%LOCALAPPDATA%\Relay\Relay.exe`. If Relay exits between preparation and restart, a later launch
revalidates the request, receipt, catalog, and prepared runtime before restoring **Restart Relay**.

The normal path binds preparation to a protocol-2 recovery transaction. If protected preparation fails
on a verified protocol-1 runtime, the manager removes its request, revalidates the installer and legacy
state, and retries once with direct prepare-only activation. Protocol-2, malformed, redirected, changed,
or mismatched state cannot use this compatibility path. Fixed, bounded bootstrap diagnostics record the
preparation stage and error code without exposing the installer path, arguments, or transaction ID.
The update dialog includes these bounded failure details, including a known native bootstrap reason
when available. Setup failures distinguish current-runtime verification from recovery-request creation;
retrying clears the previous detail. A generic preparation failure alone does not identify its cause.
Unattended preparation and repair wait up to ten seconds for the native bootstrap lock, which is
also held by background runtime cleanup. Persistent contention returns a fixed retryable diagnostic;
lock failures in these modes never open a blocking native dialog.

On a healthy current-runtime startup with no candidate or recovery transaction, updater cleanup
removes recognized staging directories for the current version and older versions while preserving
a newer download. It retries after 90 seconds so the first session promoted from probation can clean
the installer after the native bootstrap releases it. The existing 24-hour startup rule remains a
fallback for abandoned recognized staging; unrelated paths remain untouched. Successful preparation
also removes its staging directory immediately. Recovery catalog access rejects a quarantined immutable
release fingerprint, while retained-build rollback remains a separate operator-controlled recovery
action.

Discovery failures remain silent and do not affect startup or normal Relay work. Explicit action
failures appear inside the dialog or as a recovery toast. Relay Web has none of the release-check,
download, reveal, notification, or indicator capabilities. The GitHub immutable release and protected
release workflow are the update trust root; the downloaded bootstrap does not have an independent
publisher signature.

### Windows retained-build recovery

Packaged Windows x64 installations use the stable `%LOCALAPPDATA%\Relay\Relay.exe` launcher as a
native recovery supervisor. Recovery protocol 2 stores one current runtime, one temporary update
candidate, and the two most recently healthy runtimes under `%LOCALAPPDATA%\Relay\Runtime`. The
catalog still accepts and serializes the legacy `previous2` slot for compatibility, but candidate
promotion and manual rollback leave it empty and discard older unreferenced builds.
`state.ini` binds every retained build to its version, immutable release tag and commit, runtime
marker SHA-512, installer SHA-256 when known, data-compatibility epochs, install time, health, and
server snapshot. A protocol-2 marker independently binds SHA-512 hashes for `Relay.exe`, `app.asar`,
every shipped Electron DLL, the PocketBase executable and privileged hook, `better-sqlite3`, and
Koffi. The launcher starts a runtime only when the marker hash, every launch-critical file, and the
catalog identity agree and the path remains inside the managed runtime root.

An update becomes a recovery transaction before Relay restarts. Server mode first stops
PocketBase and server-owned services, then copies the stopped `data` directory into a complete,
privately permissioned snapshot under the Electron user-data `RecoverySnapshots` directory. Client
mode checkpoints both local SQLite stores so the cache and pending mutation queue remain intact.
The launcher then starts the candidate in a restricted probation run: Relay must finish local
startup, mount the renderer, keep the relevant local data plane healthy for at least 60 seconds,
and write a transaction-bound receipt. The application and native launcher share a 120-second
startup deadline, 60-second probation duration, and 195-second supervisor timeout. PocketBase is
placed in a Windows kill-on-close Job Object and automatic app/process recovery is disabled during
probation so a crash reaches the supervisor.

A healthy candidate is promoted atomically and the former current build becomes the newest retained
rollback target. A failed, exited, or wedged candidate gets at most two probation attempts. The
launcher restores the stopped pre-update server snapshot when applicable, removes the candidate
from the catalog, resumes the prior current runtime, and quarantines that exact `tag@commit`
fingerprint in a bounded history so a different commit remains eligible. A restored server's
displaced data is removed only after the journal is complete and the activated catalog proves the
intended build is current; an interrupted cleanup is retried at launcher startup. Old runtime and
snapshot directories are removed only when they are not referenced by the strict catalog and no
update or recovery request is active.

Before either promotion or automatic rollback commits its terminal catalog, the launcher atomically
writes a transaction-bound settlement intent. A startup interrupted immediately after that commit
reconciles the intent with the request and committed outcome, removes the now-stale request, and only
then performs any journaled displaced-data cleanup.

**Settings > About > Recovery** shows retained health and offers Owner-only repair or rollback after
a fresh password check. A manual server rollback first snapshots the build being left, then swaps
in the selected build's saved server data; a later rollback can therefore move in either direction.
Client rollback changes the runtime only and preserves its checkpointed cache and pending changes.
Rollbacks are allowed only when both server and client data epochs match. If a retained runtime is
missing, repair resolves that exact immutable GitHub tag and 40-character commit, repeats the normal
archive and checksum verification, and lets the matching historical bootstrap restore only that
runtime; it does not change active data or the recovery catalog.

The Start-menu **Relay Recovery** shortcut tries retained healthy builds before the catalog's
current build and opens the Recovery screen. Normal launcher startup also falls back to a retained
build with that screen when the current runtime cannot be started. If no catalog-bound runtime can
run, the native launcher opens Relay's fixed published Releases page, so recovery does not depend on
the Electron renderer being healthy.

### Windows workstation keep-awake

Packaged Windows Relay enables workstation inactivity protection by default. The main process owns
an Electron `prevent-display-sleep` blocker and sends an F15 press/release pair through the Windows
`SendInput` API every 30 seconds. The native call is bound directly through the pinned `koffi`
dependency; Relay does not spawn PowerShell, install a service, or request administrator access.
The renderer can only read the public state or submit a boolean preference through validated,
trusted-sender IPC.

The preference is local to the Electron profile in `workstation-preferences.json`, separate from
PocketBase and shared Relay data. A missing preference defaults to enabled; unreadable or malformed
state fails closed. Relay releases the timer and display blocker during normal shutdown. Native
input or display-blocker failures produce a degraded state in Settings rather than claiming full
protection. The feature does not override a manual lock, sign-out, shutdown, lid-close sleep, or an
organization policy that rejects synthetic input. Relay Web has no workstation capability.

### Service Status

`src/main/handlers/cloudStatus/CloudStatusManager.ts` polls approved public status sources and owns
one combined in-memory view. Provider groups run concurrently with bounded ten-second requests.
Persistence remains split for compatibility:

- `cloud_status_snapshot` keeps the original ten-provider contract.
- `cloud_status_mist_snapshot` contains four Juniper Mist region rows.
- `cloud_status_extension_snapshot` contains post-compatibility providers: Dynatrace, Proofpoint,
  CrowdStrike, Dropbox, and Equinix.

Updated clients merge all three records. Older clients retain the original or original-plus-Mist
shapes, and updated clients connected to an older server keep missing Mist or extension providers
visible as Unknown without creating false outage alerts.

#### Provider roll-up and dedicated adapters

The extension partition is reusable for later providers. Updated clients merge every available
partition; older clients retain the original and Mist shapes, while an updated client connected to
an older server defaults missing extension providers to Unknown rather than failing or generating a
false outage.

The public API and persisted snapshots retain the raw provider buckets, while a display aggregation
layer owns the operator-facing provider list. It deduplicates the same Mist incident across regional
buckets, unions its affected regions, and presents one `Juniper Mist` row. Dynatrace is a single
display provider; its dedicated Status.io adapter maps affected cloud and region containers into the
same bounded affected-scope metadata. Proofpoint is also one display provider. Its dedicated adapter
uses Proofpoint's public enterprise current-incidents flow, validates the Salesforce response and
official article URLs, and maps products marked `Currently Impacted` into affected scopes. Service
Status presents sixteen rows: the original ten providers, Juniper Mist, Dynatrace, Proofpoint,
CrowdStrike, Dropbox, and Equinix. Mist details expose All, Global, EMEA, APAC, and Federal filters
while preserving the single overview row and deduplicated All view.

Equinix uses its credential-free official Atlassian Statuspage summary endpoint. Unresolved
incidents follow the shared impact mapping, while a non-operational aggregate with no incident is
kept as a synthetic current issue so a provider-wide partial or major outage remains visible.
Synthetic aggregate issues use the observation time, not the status page's metadata timestamp,
and keep a stable provider-and-status identity across polls. An old page timestamp cannot hide a
currently reported outage, and unrelated page edits cannot generate repeated outage notifications.
Statuspage-compatible summaries may omit the incidents array when a validated components array
is present, as OpenAI does for healthy responses; incomplete status-only payloads remain errors.
Equinix is polled and persisted in the extension snapshot, participates in refresh cadence, provider
posture, feed errors, counts, and cloud notifications, and retains its last-known bucket if the feed
temporarily fails. The desktop external-link handler derives the exact public status hostname from
the monitored-provider registry.

Dropbox uses its credential-free official Atlassian Statuspage summary endpoint for the primary
Dropbox service, not the separate Dropbox Sign page. Unresolved incidents follow the shared impact
mapping, while a non-operational aggregate with no incident remains visible as a degradation rather
than being treated as an outage.

CrowdStrike has no unauthenticated official status feed in this integration. Its dedicated adapter
reads the bounded public StatusGator service page and anchors parsing to the CrowdStrike status
heading rather than unrelated page copy. Operational and maintenance states produce no active
record, warning produces a third-party degradation, and down produces a third-party outage. The UI
labels StatusGator as the source and keeps CrowdStrike's official support portal as a separate
action. Downdetector remains a manual outbound link and never enters automated posture.

Roll-up posture uses the worst current availability state: outage, unknown, degraded, then
operational. A confirmed outage remains visible through a feed failure, but feed uncertainty
outranks a retained degradation so stale warning data cannot look current. Status.io degraded
performance maps to degraded, while partial and full service
disruptions map to outage. Planned maintenance, closed incidents, security-only notices, stale
records, and operational monitoring updates do not enter the active issue list. A failed feed keeps
the last good snapshot and marks only its display provider Unknown; a partial Mist component
failure cannot manufacture an outage. An authoritative empty Proofpoint current-incidents table or
its exact public no-incidents display clears the prior outage state; malformed, oversized, unknown,
or failed responses retain the last confirmed state and add a provider feed error.

AWS RSS entries older than seven days are discarded before persistence and cannot accelerate the
polling cadence. Cloudflare requires an active incident before component-only aggregate status can
create an issue, preventing partial or maintenance component metadata from contradicting an
otherwise operational public page.

Displayed update and incident ages advance each minute even without a new snapshot. Failed manual
refresh requests retain the last available snapshot and show a retryable error notification.

Cloud notifications consume the display aggregation rather than the raw regional buckets, so a Mist
incident produces one stable notification regardless of how many regions it affects. Dynatrace and
Proofpoint public-status incidents and Dropbox status incidents use normal cloud-notification
priority. A CrowdStrike outage uses that same queue but retains its StatusGator attribution;
CrowdStrike warnings are visible as degraded without generating a toast. The separate Dynatrace
Problems notification manager remains authoritative for tenant problems and keeps priority over
cloud notifications.

### Dynatrace Problems

`DynatraceProblemsManager.ts` owns two independent read paths: a 15-second live loop and daily or
forced historical reconciliation. `DynatraceClassicProblemsClient.ts` reads Problems API v2 through
`/platform/classic/environment-api/v2/problems` using a shared OAuth access token. It pages all open
problems, recent closures with at least two hours of overlap, and missing previously open local IDs.
The API's start/end-time semantics require this explicit treatment of long-running problems; open
and ID reads start at epoch millisecond 1 because the API rejects 0.
Requests have total deadlines, bounded responses and pagination, same-environment URLs, no redirects,
and Retry-After handling. Clients continue reading the shared PocketBase feed; no inbound gateway,
public endpoint, queue, or new IPC channel is introduced.

`DynatraceAuthentication.ts` exchanges encrypted client credentials at the fixed Dynatrace SSO token
endpoint. One in-memory token cache per transport and credential identity shares concurrent exchanges,
renews before expiry, and invalidates unauthorized tokens so the next read obtains a fresh one. Failures use bounded
backoff and sanitized errors. New credentials are tested before replacing the saved connection.
Legacy platform-token configurations require OAuth setup while preserving existing scope and data.

Problem scope is an exclusive choice between all problems, exact selected profile names, and a DQL
filter expression. Inactive profile selections are persisted separately for restoration after DQL
mode. Profile scope is enforced by the Problems API selector and the existing local
exact-name check. `DynatraceWorkflowEventsClient.ts` supplies live custom-scope candidates directly
from a configured standard workflow's execution `params.event`, including RUNNING executions.
The source must have an active event trigger covering the desired scope. Availability and throttling
checks are cached for a minute. It is an operator-owned workflow: Relay reads but never modifies or
runs it. `automation:workflows:read` is sufficient; no workflow write/run permission is requested.

Custom matchers run in Dynatrace against bounded `data json:` batches of the actual trigger payloads.
Events enter `data json:` as nested records and are flattened one level before filtering so reserved
`dt.system.*` fields remain usable. The matcher is unchanged. This bypasses persisted Grail data
availability while retaining native DQL evaluation. A source
workflow cannot supply events excluded by its own trigger. Expressions operate on that payload's
fields and types; no local approximation of DQL or synthetic event reconstruction is used. Pipeline
commands, subqueries, comments, and control characters are rejected. Execution reads have a fixed
upper time bound, two-minute overlap, replay-decision caching, and a cursor advanced only after
successful evaluation. During catch-up, a recent page prevents new events from waiting behind old
pages. Bounded matched metadata and references are retained in memory; raw payloads are not persisted.

`DynatraceProblemsClient.ts` composes the live sources and retains the bounded Grail history queries.
Live API reads and event matching run concurrently. Canonical IDs join the sources; API lifecycle
state always wins over workflow snapshots. Failed admission leaves new problems unadmitted and is
reported, while already admitted problems continue receiving API state. An old custom configuration
without a workflow ID still has historical reconciliation but reports that live admission needs a
source. Newly saved custom scopes require a configured source.

Daily history reconciliation queries the rolling year of `dt.davis.problems`; custom eligibility is
matched against raw `DAVIS_PROBLEM` events with stable problem-ID pagination. A truncated or malformed
full result never applies scope exclusions. Live reads continue while history queries wait. Commits
are serialized; recent live records and qualifying IDs override late historical responses, preventing
stale history from reopening a problem or hiding a match not yet persisted in Grail. Scope or
credential changes invalidate in-flight work and clear live scope caches. Restore pauses and drains
live, historical, and metadata writes. The daily path also refreshes the alerting-profile catalog and
performs backup-gated retention. Scope exclusion preserves records and local notes/dispositions until
the existing one-year grace period expires.

Incremental problem and email-subject database lookups batch IDs by the escaped filter's UTF-8
length (at most 3,500 bytes) as well as a 100-ID cap. Long Dynatrace IDs must not overflow PocketBase's
filter limit and repeatedly fail automatic polling while the separate history sync still succeeds.

Canonical records are persisted before email enrichment. A separate, at-most-once-per-minute job
reads execution references directly from the configured workflow, or uses existing `noc.notification`
business events when no workflow ID is configured. It reads successful email-task inputs through the
Automation API and retains only the validated subject. One ten-second background deadline, four
concurrent reads, and 25 uncached execution attempts bound each job. There are no one-second discovery
retries. Partial completed subjects survive the deadline; aborted or stale results cannot write.
Subjects are cached by execution within the environment/credential context. Newer names update only
existing in-scope rows, and are rendered only when their recorded status matches canonical status.
Displayed subjects omit leading red and green square status emojis, including for already stored
subjects; the remaining wording and stored subject stay intact. An empty cleaned subject falls back.
The workflow-event name and canonical title remain fallbacks. Metadata cannot change lifecycle,
expand scope, or create a problem. Problem details show a distinct canonical Dynatrace title and useful
workflow description, omitting descriptions that repeat either title. Workflow tags and affected-type
metadata remain stored for compatibility but are not repeated in the operator detail panel.

Scope administration continues through protected `settings.manage` commands. DQL and workflow ID
appear only in protected summaries; ordinary public settings remain compatible with profile-only
clients. Preview validates source configuration and DQL, and counts historical active matches; that
count can lag live event delivery. Saving returns before historical backfill completes. See
`docs/DEVELOPMENT.md` for token scopes and rollout requirements, and `docs/SECURITY.md` for payload,
credential, and network boundaries.

### Dispatcher Radar

`src/main/handlers/radar/RadarManager.ts` owns polling, coalescing, stale-data behavior, and the CW
Dashboard session on the Relay server PC. `src/main/services/operationalServices.ts` exposes a
bounded Radar service to Electron handlers and `src/main/web/RelayWebGateway.ts`.

```text
CW Dashboard session on server PC
  -> RadarManager
  -> validated RadarSnapshot
  -> Electron renderer and authenticated Relay Web sessions
```

Clients never receive CW cookies or choose an alternate Radar target.
Polling and the sign-in window share the hardened `persist:relay-radar` session,
which permits an untrusted certificate authority only for `cw-intra-web`.
Other TLS failures and hosts retain Chromium's normal verification.

### Offline resilience

`src/main/cache/OfflineCache.ts`, `src/main/cache/PendingChanges.ts`, and
`src/main/cache/SyncManager.ts` own desktop offline snapshots and replay. Allowed collection/action
lists constrain the boundary. Queued updates and deletes read the current server revision, then
send it to `POST /api/relay/offline/replay`. The existing integrity-verified
`resources/pocketbase/hooks/relay_privileged_reauth.pb.js` hook enforces the base-collection
allowlist, ordinary PocketBase API rules, and update field validation. It resolves field modifiers
before evaluating rules. Comparison of the timestamp and a canonical SHA-256 fingerprint of the
observed public record shares one transaction with the mutation. Even a concurrent edit in the same
millisecond becomes a conflict and leaves the
queued change pending. Creates and ordinary online CRUD retain the built-in routes, preserving
older-client connectivity. A new client receiving 404 from an older server's missing replay route
retains the pending update or delete and asks the operator to update the server before syncing it.

A non-secret `offline-store-owner.json` records queue/cache provenance before configuration is
cleared or replaced. Same-target reconfiguration preserves pending work, including across a
restart. Before opening stores for another target, Relay moves unopened old or explicitly unknown
stores and SQLite sidecars into a resumable private quarantine directory. Ownership/close failures
block rebinding, and replay checks the current configured target before sending a write.

Full desktop directory snapshots use acknowledged `cache:snapshotBegin`, `cache:snapshotAppend`,
and `cache:snapshotCommit` IPC. The main process stages one generation per collection in SQLite,
separate from the visible cache; only a verified final transaction replaces the collection and
its explicit completeness marker. Generations bind the trusted renderer frame, cache instance,
and server identity. A new generation, another full collection writer, reconfiguration, or close
invalidates the previous transfer; restart removes abandoned staging. Unfinished transfers expire
after ten minutes and are cleaned on the next begin or restart. Rejection, interruption, or commit
failure preserves the last committed snapshot.

Each record is limited to 256 KiB of serialized UTF-8, each IPC chunk to 512 records and 2 MiB
including array punctuation, and each full collection to 100,000 records and 256 MiB. The staging
mutation journal also shares that byte ceiling; overflow invalidates the transfer while keeping
ordinary cache mutations usable. Sequence, unique IDs, counts, byte totals, and revision signature
are checked before promotion. Realtime mutations and reviewed/queued cache changes during staging
are journaled, then durable pending overlays are reapplied inside the final transaction, preserving
saved revisions and separate `queuedAt` markers. Empty complete snapshots remove previous rows.
Legacy one-shot IPC retains its 10,000-record/10 MiB guard and now acknowledges success or failure;
legacy full writers supersede staging and do not manufacture chunk-protocol completeness.

The renderer keeps complete online data visible while it saves. A same-server disconnect or failed
refresh retains this newer in-memory snapshot even if persistence failed; changing servers clears
it, including when a disposed store is revived. Revision signatures suppress writes only after a
current durable acknowledgement. Filtered and paged views acknowledge record writes before saving
exact persisted query membership; a newer realtime or queued mutation interrupts a captured query
save before it can overwrite that mutation, and retry saves the current view. Offline filter or
page expansion merges saved records with newer retained rows and deletion markers. Batched-query
membership records its saved equality values, so an expanded unsaved scope cannot inherit a ready
status. Storage retry uses the scope covered by a successful fetch or complete saved membership;
it cannot certify newly requested values without fetching them. Query retry also saves retained
deletions before current rows. Paged completeness requires a server response covering its reported
total before local/realtime overlays, or complete saved membership. Both persisted membership and
the final ready acknowledgement require that coverage plus all expected rows; inserted local rows
cannot fill an unfetched page by count. Incomplete pages do not claim full-directory completeness.
The status bar aggregates active Contacts, Servers, On-call, and bridge-group directory stores,
showing “Saving for offline use”, “Offline copy ready”, or an incomplete reason with “Retry offline
save”. Pending-change controls remain available. Readiness is independent of current-connection
`isAuthoritative` server data and is shown only for supported desktop client storage; server mode
and Relay Web do not claim an offline copy.

The desktop status bar opens a bounded pending-change list with record identity, failure reason,
and field-level local/server comparison. `offline:pendingChanges` is a trusted-sender-only durable
queue facility, not an ordinary CRUD route; it is intentionally absent from Relay Web. List pages
contain at most 25 summaries. Reviews hold at most 32 ten-minute tokens, bound to the queue entry's
durable version and the current cache, queue, and authenticated SyncManager identities. Only an
actual record 404 means deleted; other reads remain unavailable and cannot authorize resolution.

“Use server version” requires an in-dialog discard confirmation, reads the latest server record,
and atomically removes only the reviewed queue version while replacing the cache. “Review and
retry” supports existing scalar fields; structured values remain read-only and are preserved.
It durably stages the edited data, reviewed server timestamp, and exact fingerprint before replay.
Later retries and coalesced local edits retain that fingerprint rather than promoting a newer
server revision. A colliding create becomes an update only after explicit review; deleted server
records can be discarded, not silently recreated by the reviewed retry. Both resolution actions
return the remaining queue overlays and refresh renderer collection stores even if the dialog
closes. Coverage stays unverified until fresh server reads succeed without pending on-call
overlays; remaining local intent is reapplied to those reads.

Coverage review reads are advisory to ordinary Relay Web writes: their first load or a missing
review collection does not block on-call rows or board-settings persistence. They retain the Web
disconnect/refetch lifecycle and their own authority requirement for confirming coverage. Other
collection reads still participate in the global Web mutation gate with its existing grace period.

Before sending a create, replay durably marks it as attempted. A never-sent create followed by a
delete still cancels locally; both queue writers retain the delete once that create may have been
sent. A confirmed create response binds newer intent to that exact server fingerprint, allowing
its subsequent guarded delete. A failed, ambiguous, or restarted create without confirmation
requires explicit review before a later write, even when a server read currently reports missing;
it cannot become a blind deletion of a colliding record.

Both queue-writing connections increment the durable entry version, including identical edits.
Successful replay removes only that version and reconciles the authoritative server result into
cache and renderer stores, retaining other pending overlays. Failed or stale resolution retains
local intent. Reconciliation replaces same-id/same-updated content and queued markers, revokes
renderer authority, and invalidates older fetch completions. Manual retry uses the same sync result
and remaining-overlay flow as reconnect; it does not require disconnecting first. Unresolved
overlays survive ordinary refetches and retain locally edited rows even when the server deleted
them. Only explicit reconciliation or a server-identity change replaces those overlays. A rejected
pending-sync request preserves the non-authoritative snapshot, exposes its error, and retries
after one, two, and four seconds; a later manual refetch can retry again.

Relay Web is online-only. Connection-generation guards prevent stale browser requests from
reopening writes after a disconnect or client replacement.

### Protected identity and commands

Ordinary Relay use is passwordless and does not select a role identity. Owner, Administrator, and
Publisher accounts exist only for protected workflows. Effective authority is derived from current
account records plus the singleton Owner and Publisher pointers.

Paired desktop clients sign canonical, short-lived commands with a locally protected P-256 key.
`src/main/privileged/PrivilegedCommandProcessor.ts` revalidates the account, role, device,
capability, revision, signature, and request ID before invoking an allowlisted handler. The Relay
server PC is the local recovery boundary and uses the same typed authorization handlers without a
remote device signature.

`src/main/privileged/RoleAccountMigration.ts` owns legacy conversion. Its durable compatibility
rule is to preserve account IDs, device bindings, and non-empty attribution while retiring only
validated obsolete identity structures.

### Managed Wiki

PocketBase on the Relay server is the sole authority for Wiki documents. Ordinary sessions may
read published metadata and protected files; Owner, Administrator, and assigned Publisher sessions
manage them through `knowledge.manage` commands.

```text
selected local PDF
  -> main-process validation and resumable upload
  -> server-owned staging records
  -> checksum validation and bounded extraction
  -> protected managed document
  -> metadata realtime + on-demand verified PDF/cover reads
  -> explicit single-document download through the same verified bytes
```

Upload coordination lives under `src/main/knowledge/`, with
`KnowledgeUploadCoordinator.ts` and `ManagedKnowledgeService.ts` separating client transfer from
server authority. Source paths and PDF bytes never enter renderer state.

Full-text search is optional derived data. `src/main/knowledge/knowledgeSearchRuntime.ts` builds
and serves bounded passages from managed PDFs. Search failure disables search without weakening
the authoritative library or document reader.

Desktop PDF and cover caches are checksum-addressed, bounded, and disposable. They improve offline
reading and can supply an explicit offline Desktop download, but they never become a second document
authority. Desktop download requests cross a validated IPC channel and write only after a native
**Save As** choice. Relay Web reuses the authenticated PDF route, verifies its checksum header, and
creates a browser download without exposing storage URLs or credentials. Operator procedures and
current limits live in `docs/knowledge-base.md`; file and trust controls live in `docs/SECURITY.md`.

## Relay Web Boundary

`src/main/web/RelayWebServerManager.ts` controls whether the optional server exists.
`src/main/web/RelayWebServer.ts`, `src/main/web/WebRouter.ts`, and the route modules own
authenticated same-origin HTTP handling. `src/renderer/src/runtime/WebBridge.ts` adapts browser
capabilities to the same feature components used by Electron.

Relay Web intentionally excludes offline replay, native windows, connection reconfiguration,
backup/restore file selection, native alarms, and unrestricted clipboard or filesystem access.
Desktop-only actions must remain behind runtime capabilities rather than user-agent checks inside
features. Deployment requirements and operator-visible limitations live in `docs/relay-web.md`.

The Web notice participates in normal shell layout. Its alarm status observes the shared reminder
collection and browser audio results. Read-only session status exposes bounded server identity,
version, running time, and the absolute session deadline without credentials. The sign-in identity
route exposes only the server name within the same network boundary. Event-stream connection state
is reported separately from PocketBase connectivity.

Web PDF staging retains pending declarations after interrupted transport until the browser session
ends. Reselection restarts the entire staged transfer. A failed retry refreshes the newest pending
batch before showing recovery controls, so subsequent retry or discard targets the current
transfer even after repeated interruptions. Queued-source recovery runs the existing
upload service's filename, size, checksum, and session checks against a server-staged path. No
browser-supplied filesystem path or persistent browser file cache is accepted.

## Renderer Structure

### App shell and navigation

`src/renderer/src/App.tsx` owns mount-once workspace state, the shared header, modal/toast
infrastructure, and lazy feature loading. `src/renderer/src/components/Sidebar.tsx` defines seven
primary destinations in this order:

1. Compose
2. Alerts
3. On-Call
4. Knowledge
5. Status
6. Problems
7. Radar

Compose loads eagerly. Other workspaces load on first use and remain mounted so local selection,
scroll, and form state survives navigation.

### Knowledge workspace

Knowledge contains a home launcher plus Wiki, Contacts, and Servers. Those destinations are not
separate sidebar tabs. Compatibility requests for former People and Servers routes open the
corresponding Knowledge destination; legacy standalone Notes requests open Compose. Contextual
contact/server notes and Dynatrace Problem notes remain in their owning records.

### Hooks, services, and shared components

- Hooks under `src/renderer/src/hooks/` own feature state, effects, and orchestration.
- Services under `src/renderer/src/services/` own PocketBase operations.
- Shared components under `src/renderer/src/components/` own reusable interaction patterns.
- Feature and tab directories own domain-specific views and styles.

### On-call edit time and coverage confirmation

On-call Last edited is the latest valid server `updated` timestamp in the displayed rows,
preserved as `OnCallRow.updatedAt`. Missing timestamps remain Unknown. The current week label
is only a calendar reference. Local desktop edits retain their previous server timestamp and
carry a separate `queuedAt` marker; replay strips this marker before sending data to PocketBase.
Automatic update-reminder dismissal occurs only after every write in a team save succeeds on
the server. Queued or failed partial saves leave the reminder active.

The On-Call board omits the coverage-confirmation section and its confirmation action.
The existing review storage and service remain compatible with older clients. The retained
renderer service compares visible rows with a fresh server read, checks online state
and the pending queue again immediately before saving, and reads back the saved review and
current rows. `oncall_coverage_reviews` stores teamId, validThrough, and a canonical ordered
content fingerprint with a unique teamId index. Changed, added, deleted, or reordered covered
rows and expired dates require review; bookkeeping timestamps do not invalidate coverage.
Shared app authentication does not establish who confirmed, so no operator identity is shown.

Legacy confirmation is online-only, including Relay Web, and never enters the offline write queue.
Any pending desktop mutation conservatively blocks confirmation with “Sync pending changes
before confirming coverage,” including queued deletions absent from visible rows. This may
require syncing unrelated work before confirming a team. Offline coverage is unverified.
Both row and review stores must report `isAuthoritative` for the current connection/fetch cycle
before a legacy client shows confirmed coverage; its displayed rows must also match that authoritative
row snapshot. Disconnect, refetch, local overlays, or disposal revoke authority immediately.
Cached fallback and failed or stale-generation reads never restore it. Until both fresh reads
succeed the label stays Checking coverage, or Coverage unverified after a row-read failure.

An older server without the collection keeps normal on-call reads and edits working and shows
an upgrade/reconnect message for confirmation. Reviews use shared collection subscriptions
and read-only desktop snapshots; refreshes replace local queue markers with authoritative data.

## Storage Model

`src/main/pocketbase/CollectionBootstrap.ts` and its schema modules are the exhaustive source of
truth. Representative boundaries include:

| Collection                            | Authority and purpose                                    |
| ------------------------------------- | -------------------------------------------------------- |
| `contacts`, `servers`                 | Shared Knowledge directory records                       |
| `oncall`, `oncall_board_settings`     | Coverage rows and board configuration                    |
| `oncall_coverage_reviews`             | One explicit date-bounded coverage confirmation per team |
| `bridge_groups`, `bridge_history`     | Compose groups and prior assemblies                      |
| `alert_history`, `alert_reminders`    | Saved alert cards and reminders                          |
| `notes`                               | Context attached to contacts and servers                 |
| `client_presence`                     | Expiring desktop/browser heartbeat records               |
| `conflict_log`                        | Offline replay conflict evidence                         |
| `cloud_status_snapshot`               | Original ten-provider compatibility snapshot             |
| `cloud_status_mist_snapshot`          | Four-region Mist compatibility snapshot                  |
| `cloud_status_extension_snapshot`     | Post-compatibility provider snapshot                     |
| `knowledge_documents`                 | Server-owned Wiki metadata and protected files           |
| `knowledge_categories`                | Ordered Wiki category records                            |
| `knowledge_search_chunks`             | Rebuildable, server-owned derived passages               |
| `relay_privileged_accounts`           | Main-only protected role accounts                        |
| `relay_privileged_state`              | Singleton Owner and Publisher pointers                   |
| `relay_privileged_devices`            | Paired public keys, fingerprints, state, and revisions   |
| `relay_privileged_commands`           | Signed request IDs and bounded safe results              |
| `relay_privileged_pairing_challenges` | Server-created, short-lived pairing challenges           |
| `relay_privileged_pairing_requests`   | Account-scoped client pairing submissions                |

`standalone_notes` and `relay_operators` are not active runtime collections. Existing inert rows
may remain only for rollback/export or validated migration input; current code does not repurpose
them as ordinary application data.

Dynatrace dashboard definitions are workstation-local configuration in
`dynatrace-dashboards.json`, not PocketBase records.

## Windowing

Relay supports the main window, route-limited auxiliary windows, On-Call popouts, and Relay-framed
Dynatrace dashboard windows. App windows deny unexpected navigation and `window.open()` calls.
Dynatrace content runs in a separate `WebContentsView` and isolated session partition, with
navigation limited to approved Dynatrace and Microsoft authentication hosts. Relay reapplies a
100% page scale after navigation settles so Chromium's persisted host zoom cannot offset
coordinate-sensitive dashboard interactions such as map location selection.

Window creation and navigation policy live in `src/main/app/windowFactory.ts` and
`src/main/dynatrace/DynatraceWindowManager.ts`.

## Security Touchpoints

Architecture-level protections include:

- Context isolation, renderer sandboxing, and no direct renderer Node.js access
- A narrow typed preload bridge with trusted-sender and payload validation
- Main-process ownership of secrets, files, windows, and privileged authentication
- Explicit PocketBase read/write and offline-mutation allowlists
- Session-level CSP and restrictive external-navigation policy
- Capability-limited, same-origin Relay Web routes for trusted LAN/VPN use
- Checksummed and bounded managed-document transfer, extraction, and caching

See `docs/SECURITY.md` for enforced controls and `docs/DEVELOPMENT.md` for implementation patterns.
