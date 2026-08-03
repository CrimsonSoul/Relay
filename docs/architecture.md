# Relay Architecture

High-level structure of the Relay Electron application.

## Stack

| Layer         | Technology                                              |
| ------------- | ------------------------------------------------------- |
| Desktop shell | Electron 42                                             |
| Renderer      | React 19                                                |
| Language      | TypeScript 6                                            |
| Build         | Vite 7 + electron-vite 5                                |
| Data store    | PocketBase 0.39.9 with SQLite, PocketBase JS SDK 0.27.0 |
| Validation    | Zod 4                                                   |
| Testing       | Vitest 4 + Playwright                                   |

## Runtime Model

Relay has three main application layers and one optional browser gateway:

1. `src/main/`
   Manages Electron windows, app lifecycle, PocketBase bootstrap, IPC handlers, logging, backup/restore, and the offline cache.
2. `src/preload/`
   Exposes the typed `window.api` bridge through Electron context isolation.
3. `src/renderer/`
   Hosts the React UI, feature hooks, service modules, and tab components.
4. `src/main/web/`
   Hosts the optional server-mode Relay Web gateway, browser sessions, same-origin API routes, and static renderer delivery for trusted LAN/VPN access.

`src/shared/` contains types, IPC channel definitions, validation schemas, and shared helpers used across those layers.

## Data Flow

### PocketBase-Backed CRUD

Relay uses PocketBase as the application data store.

- The renderer initializes a PocketBase client in `src/renderer/src/services/pocketbase.ts`
- Feature services such as `contactService.ts`, `serverService.ts`, and `oncallService.ts` read from PocketBase directly
- `CollectionStore` in `src/renderer/src/stores/collectionStore.ts` owns collection fetches, realtime subscriptions, reconnect reconciliation, and offline snapshot fallback; `useCollection` is its React adapter
- Standard writes pass through `mutationGateway.ts`: online writes use the PocketBase SDK directly, while offline-capable desktop writes use validated IPC to enter the main-process queue

Ordinary online collection CRUD therefore stays on the renderer-to-PocketBase path. Electron IPC is still part of the desktop offline-write path; Relay Web rejects writes while offline instead of exposing that queue.

### IPC Surface

IPC is reserved for operations the renderer should not perform directly, including:

- Window management
- Setup and connection bootstrap
- Dynatrace dashboard popout management
- Cloud status aggregation
- Clipboard and file-system actions
- Backup and restore
- Offline mutation enqueueing, cache reads, and sync triggers
- Wiki PDF/status/search actions inside the Knowledge workspace
- Privileged sign-in, pairing, session, and typed-command actions
- Logging bridge events

The canonical channel and bridge definitions live in `src/shared/ipc.ts`.

## Main Process Subsystems

### App Bootstrap

`src/main/index.ts` is the main entry point.

It wires together:

- Global error handlers
- Security headers
- Main window creation
- IPC registration
- PocketBase startup and connection bootstrap

### PocketBase Lifecycle

PocketBase is managed by:

- `src/main/app/pocketbaseBootstrap.ts`
- `src/main/pocketbase/PocketBaseProcess.ts`
- `src/main/pocketbase/CollectionBootstrap.ts`

Current behavior:

- Start the embedded PocketBase process when Relay is acting as the server
- Load Relay's checked-in PocketBase hooks from the packaged `pocketbase/hooks` resource
- Bootstrap required authentication rate limits on loopback before opening a configured LAN listener
- Expose connection URL and passphrase details to Settings for client setup
- Ensure the superuser and app user exist
- Bootstrap required collections on startup
- Start backup and retention on a shared 24-hour schedule after PocketBase is healthy

The backup/retention schedule first runs about 30 seconds after startup and then every 24 hours. Each cycle re-authenticates the superuser and attempts a regular backup if one is due before running retention cleanup. A failed authentication or backup is logged, but cleanup still proceeds; the schedule does not guarantee that every retained record was captured by that cycle's backup. An overlap guard skips a cycle if the previous one is still running. Regular backups (keep 10) and pre-restore safety backups (keep 3) are pruned on separate budgets so a burst of restores cannot evict scheduled backups.

Relay currently bootstraps required collections in code. It does not rely on persistent checked-in
migration files. If the configured superuser credential is authoritatively rejected, bootstrap stops
PocketBase and runs a one-use repair migration from an owner-only directory in the operating system's
per-user temporary area. On Windows, that directory is created atomically with a protected DACL for
the current user and LocalSystem; repair fails before writing the secret if the DACL cannot be
created and verified. The passphrase is never placed in process arguments, environment variables,
logs, or migration source. The migration consumes the owner-only secret file before changing the
record and writes a nonsecret, run-specific completion marker only after the save succeeds. Relay
requires that marker, removes the entire repair directory, restarts PocketBase, and proves the new
credential through normal authentication before continuing.

### Server/Client Presence

Relay supports embedded server mode and client mode against another Relay server.

Server mode responsibilities:

- Start PocketBase locally and optionally bind it to the LAN when direct client access is enabled
- Advertise LAN-bound servers over mDNS for client setup
- Show the server URL in `http://host:port` format and expose the local connection passphrase in Settings
- Subscribe to `client_presence` and show connected client hostnames in the sidebar footer

Client mode responsibilities:

- Connect to an existing Relay server URL
- Coordinate ordinary app-user authentication in the main process so the renderer connection,
  enhanced Wiki search, PDF and cover clients, and reconnect sync do not independently spend the
  server's authentication rate-limit budget
- Write a `client_presence` heartbeat every 30 seconds with the client hostname
- Hide the client-count sidebar block because it is server-only operator context

The authentication coordinator uses a detached, in-memory PocketBase client and single-flights
matching server-and-passphrase requests. It copies only the validated app-user token and record into
each main-process consumer, actively removes its bounded completed snapshot after four seconds, and
clears all cached or in-flight state when Relay is reconfigured or the embedded server restarts.
The passphrase is represented in coordinator keys only by a process-randomized digest. Server
bootstrap primes the same short-lived session from its successful app-user proof so the renderer
does not immediately repeat that password request.

Relay Web responsibilities:

- Serve the shared renderer from the Relay server on an independently configured port
- Authenticate ordinary browser sessions with the Relay connection passphrase
- Write browser heartbeats with a sanitized browser/address label
- Adapt system actions through a bounded same-origin API while capability-gating desktop-only operations
- Serve the server PC's validated Dispatcher Radar snapshot and refresh action to authenticated Web sessions
- Require a desktop viewport at least 1,024 pixels wide

Presence records expire from the UI after 90 seconds without a heartbeat. The collection stores desktop clients and browser sessions, so the Relay server itself is not counted.

Relay Web is a backup access path, not an independent frontend. The same React components, PocketBase services, realtime subscriptions, and feature state are used in both runtimes. The Electron preload adapter and browser session adapter implement the runtime boundary. Native window management, connection reconfiguration, backup/restore, offline cache/replay, native alarm selection, and image clipboard capture remain desktop-only.

Dispatcher Radar follows a server-owned operational path:

```text
RadarManager
  -> OperationalServices
  -> authenticated Radar snapshot/refresh routes and session event
  -> WebBridge
  -> shared Radar renderer, sidebar status, and queue notifications
```

`RadarManager` remains the polling, coalescing, stale-data, and CW-session authority on the Relay server PC. The Web gateway owns one Radar subscription and fans each validated snapshot out to active browser sessions. Gateway disposal releases that subscription along with the other operational-service subscriptions. Relay Web does not create a second dashboard session or receive CW cookies.

### Cloud Status

`CloudStatusManager` polls the ten legacy provider feeds plus one Juniper Mist SorryApp request group. The Mist adapter routes active unplanned notices and component degradation to Global, EMEA, APAC, and Federal buckets before the manager exposes one combined 14-provider in-memory snapshot.

Persistence remains split for client compatibility. `cloud_status_snapshot` contains exactly the original ten providers, while `cloud_status_mist_snapshot` contains exactly the four Mist regions. Updated clients subscribe to both server-owned singletons and merge them before rendering or alerting. A client connected to an older server without the Mist collection keeps the four Mist regions visible as Unknown and does not alert from missing coverage.

### Offline Resilience

Offline behavior is handled by:

- `src/main/cache/OfflineCache.ts`
- `src/main/cache/PendingChanges.ts`
- `src/main/cache/SyncManager.ts`

Responsibilities:

- Keep a local cache of collection snapshots for offline reads
- Accept validated offline-capable desktop writes through IPC and queue them while disconnected
- Replay queued changes when the connection returns
- Record conflicts in the `conflict_log` collection

### Privileged Identity And Commands

Ordinary Relay activity is passwordless and accountless. There is no current-operator selector, and new ordinary mutations carry no role-account attribution. Historical records keep their stored display-name snapshots so old activity remains intelligible without a live identity roster.

Protected identity is account-centric. Role accounts authenticate by normalized `username`; `displayName` is presentation-only, and the auth collection's internal email field is not an accepted identity or recovery channel. `relay_privileged_state` contains the singleton `ownerAccountId` and optional singleton `publisherAccountId`. Effective role is derived on demand: the Owner is the Administrator record referenced by `ownerAccountId`, other Administrator records are Administrators, and only the Publisher record referenced by `publisherAccountId` is the effective Publisher.

Privileged authentication uses a dedicated main-process PocketBase client backed by its own in-memory `BaseAuthStore`. Its token does not replace the shared Relay app-user session and is never returned through preload, written to renderer state, placed in local storage, copied into the offline cache, or queued for offline replay. A privileged session locks after 15 minutes without a privileged action; ordinary Relay activity does not extend it.

Fresh reauthentication on a paired client uses the authenticated
`POST /api/relay/privileged/reauth` PocketBase hook. PocketBase validates the submitted password
against the current active role-account record, re-resolves the account's effective role and active
paired device, and creates the short-lived, account/device-bound proof itself. The hook is
body-limited and has a dedicated authoritative PocketBase rate limit. Internal
`privileged.reauth.confirm` commands are rejected from the signed remote-command surface; only the
server PC may create the equivalent proof through the trusted local processor path.

This proof protocol requires a coordinated rollout. New clients need the hook supplied by the new
server, while the new server intentionally rejects the legacy client-authored confirmation command.
Ordinary Relay connectivity remains compatible, but update the server and paired clients together
before testing sensitive actions that require fresh reauthentication.

Remote privileged actions use the existing PocketBase connection and port:

```text
role-account username + password
  -> trusted IPC -> main-only privileged auth store
  -> paired P-256 key in Electron safeStorage
  -> canonical command + 90-second expiry + unique request ID
  -> existing PocketBase command collection / realtime signal
  -> server validates current account ID, authority pointers, device, and signature
  -> allowlisted handler -> bounded safe result
```

The server PC is the local trust and recovery boundary. It does not need a paired-device record, but it still requires an active privileged login and sends local actions through the same typed authorization and command-result path. Client laptops must be paired with a server-issued, single-use challenge that expires after 10 minutes. Only the public P-256 key and fingerprint are stored on the server; the encrypted private key stays on its originating workstation.

Command request IDs are unique and results are idempotent. A repeated matching request returns its stored safe result, while conflicting reuse is rejected. The server derives capabilities from current records for every command rather than trusting the role claimed by the renderer or client. Privileged commands are online-only and are absent from both the cache allowlists and pending-mutation queue.

The public command catalog is an explicit allowlist rather than a general-purpose data bridge. Owner commands cover Administrator lifecycle and ownership transfer. Owner and Administrator commands cover the single Publisher assignment, paired devices, sanitized administration snapshots, and three typed Dynatrace settings. The server resolves current account, authority pointers, device, and revision records again for every command. Publisher sessions retain only `privileged.status.read` and `knowledge.manage`.

### Remote Relay Administration

An `Administration` area appears only during an Owner or Administrator session. The same signed command path works from the Relay server PC and a paired work laptop:

| Area                                       | Owner                                    | Administrator                            | Publisher | Ordinary use |
| ------------------------------------------ | ---------------------------------------- | ---------------------------------------- | --------- | ------------ |
| Read account/role administration snapshot  | Yes                                      | Yes                                      | No        | No           |
| Manage Administrator accounts              | Yes                                      | No                                       | No        | No           |
| Transfer ownership                         | Yes, fresh reauthentication              | No                                       | No        | No           |
| Manage/assign the single Publisher account | Yes                                      | Yes                                      | No        | No           |
| Rename or revoke paired devices            | Yes; revoke needs fresh reauthentication | Yes; revoke needs fresh reauthentication | No        | No           |
| Replace approved Dynatrace settings        | Yes; token needs fresh reauthentication  | Yes; token needs fresh reauthentication  | No        | No           |
| Manage Wiki PDF documents                  | Yes                                      | Yes                                      | Yes       | No           |

`administration.snapshot.read` returns only bounded public views: account IDs, usernames, display names, effective roles, account revisions, configured/not-configured credential state, device labels and fingerprint suffixes, and redacted setting summaries. Passwords, hashes, tokens, internal email values, public keys, private-key state, command envelopes, filesystem paths, and raw PocketBase errors are excluded.

Initial password setup and later protected-account recovery stay on the server PC. Fresh bootstrap creates pending `ryan` / Ryan Bledsoe and `charles` / Charles Gibbs Administrator records, points ownership to Ryan's account ID, and ships no usable default credential. There is no email or remote recovery. Publisher assignment is a singleton account-ID pointer; an incoming Publisher remains pending until its password is configured locally, and reassignment revokes the prior Publisher's sessions/devices.

The legacy roster migration is plan-before-commit and fail-closed. It preserves protected account IDs (and therefore paired-device `accountId` bindings), normalizes Ryan and Charles to usernames `ryan` and `charles`, copies a legacy display name only into an empty historical snapshot, and verifies the converted Owner/Administrator/Publisher invariants. Obsolete ordinary auth rows are retired only when no paired device references them. The exact legacy `relay_login_roster` view is validated and deleted before `relay_operators`; an unexpected view or device binding defers migration. Existing non-empty historical snapshots are immutable migration inputs. Operational preflight uses a PocketBase backup or SQLite online backup—not a raw copy of a potentially live WAL database—and rollback restores the complete pre-migration backup before an older build is started.

Remote settings are intentionally limited to the Dynatrace environment URL, platform-token replacement, and alerting-profile filter. Relay connection paths, backup/restore selection, folder pickers, executables, and other filesystem-dependent operations remain local to the server PC.

### Managed Wiki Documents

PocketBase on the Relay server is the sole authority for the Wiki destination's managed PDF library. The outer renderer destination is **Knowledge** and the document surface inside it is **Wiki**. There is no administrator-managed source folder, watcher, or filesystem reconciliation path. Ordinary use is read-only. An Owner, Administrator, or the single designated Publisher can choose PDFs on the server PC or a paired work laptop and manage them through capability-checked privileged commands. Source files are limited to 50 MiB and 1,000 pages; batches are limited to 100 files.

`knowledge_categories` gives every Wiki category a stable record ID, case-insensitive normalized name, explicit sort position, and optimistic revision. A single `uncategorized` system record is the non-deletable reassignment fallback. The additive version-1 bootstrap migration creates stable records from existing category strings, assigns every existing document to one of them, and classifies legacy documents as SOPs. It retains the denormalized category string and existing `sourceKey` so older clients and cross-document links remain readable. The migration marker makes a successful second bootstrap write-free; it never changes PDF bytes or checksums.

The client main process inspects each selected regular PDF without exposing its path or bytes to the renderer. It builds a persistent upload queue, hashes and reads the file in bounded 4 MiB chunks, and revalidates the canonical path, file identity, size, modification time, signature, and checksum before transfer. At most two chunks are in flight. Retryable network failures use bounded exponential backoff; after eight attempts the item pauses for network recovery. The encrypted queue survives restart when Electron `safeStorage` is available. Automatic session or shutdown interruption leaves work queued for recovery, while an explicit Publisher pause remains paused until resumed. A discard first persists a cancellation request, stops local transfer work, and then converges with the authoritative server state; an offline or interrupted cancellation remains visibly pending and resumes before any transfer after the same Publisher session returns. Every scheduled operation is eligible only for the active account and local source that owns the queue entry. Terminal server states and pending cancellation cannot be revived by late local work or an older status response. If the source moved or changed, the publisher must reselect the same unchanged PDF.

Upload manifests and chunks live in account- and device-bound PocketBase collections. The server reports missing chunk indexes so a client reconnecting over VPN sends only unacknowledged data. Once complete, a single-concurrency worker assembles and checksum-validates the file, extracts native PDF bookmarks or a bounded inferred outline, and renders page one into a bounded portrait PNG. Publishing or replacing copies both protected files into `knowledge_documents` and immediately clears the temporary staged files. Unpublished upload records expire after seven days.

Clients subscribe to `knowledge_documents` metadata through the same realtime and offline snapshot path as other read models. PDF bytes do not ride the metadata stream: the renderer requests one validated document/checksum pair through trusted IPC, and the main process authenticates to the Relay server's protected file endpoint.

Wiki full-text search is a derived, optional subsystem. After the required workspace is ready, the server indexer reads checksum-validated protected PDFs, extracts bounded passages in a worker, and writes them to the server-owned `knowledge_search_chunks` collection keyed by document, checksum, page, passage, and index version. The main-process search service reconciles document and chunk snapshots over authenticated PocketBase realtime, keeps a bounded desktop snapshot for cached search, and serves validated search/cancellation requests through the Electron IPC or Relay Web runtime adapters. Search bootstrap or indexing failure makes search unavailable without changing the authoritative PDF library; the index can be rebuilt from managed documents.

Wiki opens to its catalog instead of immediately opening a document. Its renderer model derives Recently Updated from timestamps, groups large SOP Manual cover cards by category order, keeps Quick Guides in compact scan rows, and applies search, category, type, and sort controls together. Covers are requested through Intersection Observer only as cards enter the viewport. Opening either document type transitions into the existing focused reader; returning to Wiki preserves catalog filters and search state.

Category creation, renaming, complete-set reordering, delete-with-reassignment, combined document title/category/type edits, and bulk category assignment are six explicit signed commands under `knowledge.manage`. Owner, Administrator, and Publisher sessions receive the same Wiki-management operations. The server revalidates capability, expected revisions, stable IDs, category uniqueness, and reassignment completeness before writing. Category metadata remains renderer-read-only and is not added to the offline mutation queue.

Opened client PDFs are stored content-addressed at `<config data>/knowledge-cache/<sha256>.pdf`. Downloads are size-, signature-, and checksum-verified before atomic promotion. The cache is on demand, has a 2 GiB LRU budget, and retains unreferenced entries for at most 30 days. Cached documents remain available while disconnected; unopened documents show an offline-unavailable state. Knowledge metadata and PDF bytes stay on the configured Relay LAN path.

Cover reads use the same validated document ID and PDF checksum as the PDF request. Stored covers are delivered through the protected PocketBase file path. Migrated documents without a stored cover render page one lazily from the already validated PDF, then promote the PNG atomically into `<config data>/knowledge-cover-cache/<sha256>.png`. Matching requests are deduplicated, at most two cover jobs run concurrently, and cleanup confines this cache to referenced checksums and a 100 MiB budget.

New Wiki upload, document, and audit records attribute protected actions with account IDs and bounded actor display-name snapshots. Legacy operator-named attribution fields remain optional, read-only compatibility data for historical rows and are left blank by all new writes. Readers prefer the account fields and fall back to legacy values only when opening older records; role-account migration never rewrites Wiki history.

The Wiki reader defaults to **Continuous** mode. It creates a stable shell for every page so the document has a real scroll range, but renders canvases only for the current page and a bounded overscan window. Intersection visibility updates the current-page indicator. **Single page** mode remains available from the reader toolbar. The mode preference is workstation-local, and switching modes or leaving the Wiki destination retains the open document, current page, zoom, and PDF lifetime rather than downloading or parsing the file again.

Link annotations branch through Relay-owned navigation rather than PDF action execution:

```text
PDF link annotation
  -> Relay overlay
     -> native destination -> current PDF.js document
     -> PDF filename/path -> indexed metadata -> selected Relay guide
     -> HTTP(S) -> dedicated preload IPC -> main validation -> system browser
```

PDF.js may recover URI, Launch/GoToR, or JavaScript actions into indistinguishable URL fields. The overlay treats those fields as origin-agnostic inert text, then reclassifies them through Relay's resolver. No branch executes the originating PDF action: local paths are metadata-only document identifiers, while browser navigation requires an explicit click and the dedicated trusted, rate-limited HTTP(S) IPC boundary.

Failed validation or extraction leaves an upload unpublished and preserves the last valid document. Move-to-trash is reversible; permanent deletion requires reauthentication and is recorded in the management audit history.

PocketBase backup/restore includes managed document metadata and protected PDF storage. Each workstation's local read cache and encrypted in-progress upload queue are outside the backup. After a restore, clients resubscribe to the authoritative managed library and repopulate read caches on demand; interrupted publisher uploads may require source reselection if the server no longer has their manifests or acknowledged chunks.

## Renderer Structure

### App Shell

The renderer entry point is `src/renderer/src/App.tsx`.

The shell consists of:

- Sidebar navigation
- Header search and utility actions
- Mount-once tab content area
- Modal and toast infrastructure
- Sidebar footer status for connected clients, configured dashboards, Settings, and connection health

Only the Compose tab is loaded eagerly. Other major tabs are lazy-loaded.

### Tabs

The current primary tabs are:

- Compose
- Alerts
- On-Call
- Knowledge
- Status
- Problems

### Knowledge Workspace

Knowledge is one retained top-level tab with four internal destinations: `home`, `wiki`, `contacts`, and `servers`. Its home is a full-size launcher ordered exactly **Wiki, Contacts, Servers**. Each destination is mounted on first use and then retained, so switching between them preserves document position, directory selection, filters, detail context, and other local UI state. The header breadcrumb remains `Relay / Knowledge`; an internal destination bar identifies Wiki, Contacts, or Servers and returns to the launcher.

Command search and compatibility routes activate Knowledge first, then request the appropriate internal destination. Legacy People requests map to Contacts, legacy Servers requests map to Servers, and legacy Notes requests map to Compose. They do not restore removed top-level tabs.

The standalone Notes feature has no renderer tab, route, service, cache/mutation path, import/export surface, or Data Manager entry. Contact and server notes remain contextual features inside their respective Knowledge destinations, backed by the managed `notes` collection. Dynatrace problem notes remain a separate operational record type.

### Hooks And Services

The renderer separates concerns between:

- Hooks in `src/renderer/src/hooks/` for UI state and effects
- Services in `src/renderer/src/services/` for PocketBase data access
- Shared components in `src/renderer/src/components/`

This keeps React views thin and moves data operations into testable modules.

## Storage Model

Relay bootstraps the PocketBase collections it needs at runtime. The representative collections below show the major data boundaries; `src/main/pocketbase/CollectionBootstrap.ts` is the complete source of truth.

| Collection                            | Purpose                                             |
| ------------------------------------- | --------------------------------------------------- |
| `contacts`                            | People directory                                    |
| `servers`                             | Server directory                                    |
| `oncall`                              | On-call rows and ordering                           |
| `bridge_groups`                       | Saved compose groups                                |
| `bridge_history`                      | Compose history                                     |
| `alert_history`                       | Saved alert cards                                   |
| `alert_reminders`                     | Follow-up reminders from alerts                     |
| `notes`                               | Context attached to contacts and servers            |
| `oncall_dismissals`                   | On-call alert dismissals                            |
| `oncall_board_settings`               | Board-level settings                                |
| `client_presence`                     | Active client heartbeat records                     |
| `conflict_log`                        | Offline sync conflict records                       |
| `cloud_status_snapshot`               | Server-owned legacy 10-provider status singleton    |
| `cloud_status_mist_snapshot`          | Server-owned four-region Mist status singleton      |
| `knowledge_documents`                 | Read-only PDF metadata and protected mirror         |
| `knowledge_categories`                | Ordered Wiki category metadata                      |
| `knowledge_search_chunks`             | Optional, server-owned derived PDF search passages  |
| `relay_privileged_accounts`           | Main-only username authentication for role accounts |
| `relay_privileged_state`              | Singleton Owner and Publisher account-ID pointers   |
| `relay_privileged_devices`            | Paired workstation public keys and revocation state |
| `relay_privileged_commands`           | Signed request IDs and bounded safe results         |
| `relay_privileged_pairing_challenges` | Server-only one-time pairing challenges             |
| `relay_privileged_pairing_requests`   | Account-scoped client pairing submissions           |

Dynatrace dashboard definitions are not stored in PocketBase. They are local app configuration in `dynatrace-dashboards.json` under Relay's app data directory because the dashboard list is a local workstation convenience and contains external URLs rather than shared operational data.

`knowledge_documents` and `knowledge_search_chunks` are server-owned: authenticated users can list/view records, but API create/update/delete rules are disabled. Document metadata is readable through Relay's metadata cache allowlist and deliberately excluded from writable-cache and offline-mutation allowlists. Search chunks are derived from managed PDFs and may be stored in the separate bounded desktop search snapshot; clients never write them directly.

`standalone_notes` is not a managed runtime collection. An existing installation may still contain archived rows from the removed Notes tab; Relay deliberately does not patch, synchronize, import, export, seed, clear, or delete that collection. Keeping those rows inert makes rollback or an explicit future archival export possible without confusing them with the contextual `notes` collection.

Privileged account, device, command, and pairing collections are not part of the ordinary Relay cache. The nonsecret authority singleton is readable by authenticated Relay clients for role labels, but only the server can mutate it. `relay_operators` is not a managed runtime collection; it may exist only as a legacy migration input and is deleted after successful account conversion.

## Windowing

Relay supports a main window, route-limited auxiliary app windows, on-call board popouts, and Dynatrace dashboard popouts.

Important rules:

- Auxiliary windows are route-limited
- Existing auxiliary windows are focused instead of duplicated when possible
- Navigation and `window.open()` are blocked for both main and auxiliary windows
- Dynatrace popouts load a Relay chrome shell in the host window and the external dashboard in a separate `WebContentsView`
- Dynatrace content uses the `persist:relay-dynatrace` session partition so Microsoft SSO cookies are isolated from the app shell and can be cleared from Settings
- Dynatrace navigation is limited to `dynatrace.com` hosts plus Microsoft authentication hosts

See `src/main/app/windowFactory.ts`, `src/main/dynatrace/DynatraceWindowManager.ts`, and `src/main/dynatrace/DynatraceDashboardStore.ts` for the implementation.

## Security Touchpoints

Architecture decisions that directly support security:

- Context-isolated preload bridge
- Renderer sandboxing with no direct Electron imports
- Path validation for file operations
- CSP installation at the session level
- Centralized IPC validation through shared schemas
- Dedicated external-dashboard navigation policy and permission denial

For full security guidance, see `docs/SECURITY.md`.
