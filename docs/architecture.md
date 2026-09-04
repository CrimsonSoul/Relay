# Relay Architecture

Relay is a Windows-distributed Electron application with a shared React interface, an embedded or
remote PocketBase data plane, and an optional browser gateway for trusted networks. This guide owns
the high-level runtime, data authority, and subsystem boundaries. Current code, configuration, and
tests remain authoritative when details change.

## Stack

| Layer         | Technology                                              |
| ------------- | ------------------------------------------------------- |
| Desktop shell | Electron 42.4.0                                         |
| Renderer      | React 19.2.8                                            |
| Language      | TypeScript 6.0.3                                        |
| Build         | Vite 7.3.6 and electron-vite 5.0.0                      |
| Data store    | PocketBase 0.39.9 with SQLite; PocketBase JS SDK 0.27.0 |
| Validation    | Zod 4.4.3                                               |
| Testing       | Vitest 4.1.11 and Playwright 1.62.0                     |

Dependency and runtime declarations live in `package.json`, `package-lock.json`, and
`.node-version`. Release versions are derived from conventional commits on `main` and injected into
the packaged application by the gated GitHub release workflow.

## Delivery and CI Trust Boundaries

Release version resolution and Windows packaging may run in parallel with the exact-commit gate
wait, but versioned assets, tags, drafts, and publication remain blocked until the exact required
Build, SonarQube, and Snyk gates and the Windows package have succeeded. A single Build workflow
runs static checks and the production build, unit coverage plus cache integration tests, four
renderer-coverage shards, SonarQube, and Snyk. Sonar merges those canonical coverage reports, so
the test suites do not run a second time. A separate lightweight workflow validates pull-request
titles, and only the Release workflow packages Windows automatically after a `main` merge. Passing
Vitest output is suppressed while failure output remains visible.

Content-addressed ESLint, Prettier, and Sonar caches are advisory and cannot establish correctness.
Exact-tree reuse requires `RELAY_CI_TREE_REUSE_MODE=enabled` exactly; the production repository
enables it. Full merged-internal-PR/base/head/parent/tree/check/shared-workflow-run/artifact
provenance must validate, otherwise Relay falls back to full Build, Snyk, and coverage work.
Required Build and Snyk aggregates stay fail closed. Sonar runs on the exact final `main` commit and
performs reviewed-issue reconciliation. One-day PR attestations and merged LCOV artifacts are
optimization evidence, not release authority.

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
failure remains a retryable download failure.

Immediately before execution, the manager revalidates the private staging path and re-hashes the
extracted executable. Installation launches that exact file with `/relay-prepare-only` and a generated,
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

Cloud notifications consume the display aggregation rather than the raw regional buckets, so a Mist
incident produces one stable notification regardless of how many regions it affects. Dynatrace and
Proofpoint public-status incidents and Dropbox status incidents use normal cloud-notification
priority. A CrowdStrike outage uses that same queue but retains its StatusGator attribution;
CrowdStrike warnings are visible as degraded without generating a toast. The separate Dynatrace
Problems notification manager remains authoritative for tenant problems and keeps priority over
cloud notifications.

### Dynatrace Problems

`src/main/dynatrace/DynatraceProblemsManager.ts` owns the server-wide problem feed, incremental
polling, daily full reconciliation, scope transitions, retry state, and one-year retention.
`DynatraceProblemsClient.ts` owns the bounded Grail requests and composes every query from Relay's
fixed fetch, deduplication, projection, ordering, and result-boundary stages.

Problem scope is an exclusive choice between no filter, exact alerting-profile names, and one custom
DQL matcher expression. The administration service exposes the server's cached profile catalog for
selection and atomically clears the inactive scope mechanism. Config loading, command handling, the
manager, and the query builder all enforce custom-DQL precedence for legacy values that contain both,
so they can never regain the former combined behavior.

Incremental problem polling checks profile-catalog freshness independently from the daily full
problem reconciliation. A successful or failed ordinary catalog attempt is throttled for one hour;
forced reconciliation bypasses that cache. Failure leaves the last known catalog available and does
not fail the problem sync, while profile-scoped full reconciliation still requires fresh metadata
before applying destructive exclusions.

Shared validation permits a complete boolean expression that can be embedded inside Relay's owned
`filter (...)` stage. Internal `or` and `and` clauses—including checks against
`event.status_transition`—are preserved. For custom scope, `dt.davis.problems` remains authoritative
for lifecycle and technical state while an `event.id in [...]` subquery evaluates the matcher against
raw `DAVIS_PROBLEM` events. Relay separately projects a bounded set of workflow-event fields keyed by
the same problem ID: operator-facing name, description, entity tags, and affected entity types. The
renderer prefers that workflow name and context but falls back to the canonical problem title when
enrichment is absent. Text and list bounds are applied before persistence. Relay does not depend on
workflow execution or email delivery. Pipelines, comments, and control characters are rejected.
Dynatrace remains the final grammar authority through a canonical count query that runs before the
configuration is saved. A zero count is valid.

Scope management travels through the protected command boundary and requires `settings.manage`.
The matcher is included in the protected administration summary but omitted from ordinary public
settings. Existing profile-only clients remain compatible: their profile update selects profile
mode and clears any stored matcher, while an updated client submits the active value and an explicit
empty value for the inactive mode atomically.

The scope preview counts currently active matches. Full custom-scope reconciliation follows stable
problem-ID cursors through the complete one-year match set, so crossing a single Grail query's record
limit does not truncate the stored scope. The saved setting returns immediately while that forced
reconciliation continues under the normal sync-state and retry path. A genuinely incomplete page
still fails closed without applying exclusions. Incremental custom-scope polling fetches new matching
problems and a bounded unfiltered set of current problem changes. Existing eligible IDs receive the
latest authoritative status and technical details even when an update does not independently match
the workflow expression or an incremental metadata page omits the problem; their last matching
workflow metadata is preserved until full reconciliation. Unrelated changed IDs are ignored. Full
reconciliation owns enrichment replacement and exclusions. Exclusion hides the record from active
views without deleting its notes or local disposition; normal retention owns eventual deletion.

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

### Offline resilience

`src/main/cache/OfflineCache.ts`, `src/main/cache/PendingChanges.ts`, and
`src/main/cache/SyncManager.ts` own desktop offline snapshots and replay. Allowed collection/action
lists constrain the boundary. Replay rechecks server state and records conflicts instead of
treating queued local state as authoritative.

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

## Storage Model

`src/main/pocketbase/CollectionBootstrap.ts` and its schema modules are the exhaustive source of
truth. Representative boundaries include:

| Collection                            | Authority and purpose                                  |
| ------------------------------------- | ------------------------------------------------------ |
| `contacts`, `servers`                 | Shared Knowledge directory records                     |
| `oncall`, `oncall_board_settings`     | Coverage rows and board configuration                  |
| `bridge_groups`, `bridge_history`     | Compose groups and prior assemblies                    |
| `alert_history`, `alert_reminders`    | Saved alert cards and reminders                        |
| `notes`                               | Context attached to contacts and servers               |
| `client_presence`                     | Expiring desktop/browser heartbeat records             |
| `conflict_log`                        | Offline replay conflict evidence                       |
| `cloud_status_snapshot`               | Original ten-provider compatibility snapshot           |
| `cloud_status_mist_snapshot`          | Four-region Mist compatibility snapshot                |
| `cloud_status_extension_snapshot`     | Post-compatibility provider snapshot                   |
| `knowledge_documents`                 | Server-owned Wiki metadata and protected files         |
| `knowledge_categories`                | Ordered Wiki category records                          |
| `knowledge_search_chunks`             | Rebuildable, server-owned derived passages             |
| `relay_privileged_accounts`           | Main-only protected role accounts                      |
| `relay_privileged_state`              | Singleton Owner and Publisher pointers                 |
| `relay_privileged_devices`            | Paired public keys, fingerprints, state, and revisions |
| `relay_privileged_commands`           | Signed request IDs and bounded safe results            |
| `relay_privileged_pairing_challenges` | Server-created, short-lived pairing challenges         |
| `relay_privileged_pairing_requests`   | Account-scoped client pairing submissions              |

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
