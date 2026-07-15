# Relay Architecture

High-level structure of the Relay Electron application.

## Stack

| Layer         | Technology                                              |
| ------------- | ------------------------------------------------------- |
| Desktop shell | Electron 42                                             |
| Renderer      | React 19                                                |
| Language      | TypeScript 6                                            |
| Build         | Vite 7 + electron-vite 5                                |
| Data store    | PocketBase 0.25.9 with SQLite, PocketBase JS SDK 0.26.8 |
| Validation    | Zod 4                                                   |
| Testing       | Vitest 4 + Playwright                                   |

## Runtime Model

Relay has three main layers:

1. `src/main/`
   Manages Electron windows, app lifecycle, PocketBase bootstrap, IPC handlers, logging, backup/restore, and the offline cache.
2. `src/preload/`
   Exposes the typed `window.api` bridge through Electron context isolation.
3. `src/renderer/`
   Hosts the React UI, feature hooks, service modules, and tab components.

`src/shared/` contains types, IPC channel definitions, validation schemas, and shared helpers used across those layers.

## Data Flow

### PocketBase-Backed CRUD

Relay uses PocketBase as the application data store.

- The renderer initializes a PocketBase client in `src/renderer/src/services/pocketbase.ts`
- Feature services such as `contactService.ts`, `serverService.ts`, and `oncallService.ts` call PocketBase directly
- Realtime subscriptions are handled in the renderer through `useCollection`

This means day-to-day collection CRUD does not go through Electron IPC.

### IPC Surface

IPC is reserved for operations the renderer should not perform directly, including:

- Window management
- Setup and connection bootstrap
- Dynatrace dashboard popout management
- Cloud status aggregation
- Clipboard and file-system actions
- Backup and restore
- Offline cache reads and sync triggers
- Knowledge Base PDF/status reads
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
- Expose connection URL and passphrase details to Settings for client setup
- Ensure the superuser and app user exist
- Bootstrap required collections on startup
- Start backup and retention on a shared 24-hour schedule after PocketBase is healthy

The backup/retention schedule runs once at startup and then every 24 hours. Each cycle re-authenticates the superuser, creates a backup, then runs retention cleanup — backup always precedes pruning so retention can never delete data that has not been captured in a backup. An overlap guard skips a cycle if the previous one is still running. Regular backups (keep 10) and pre-restore safety backups (keep 3) are pruned on separate budgets so a burst of restores cannot evict scheduled backups.

Relay currently bootstraps required collections in code. It does not rely on checked-in migration files.

### Server/Client Presence

Relay supports embedded server mode and client mode against another Relay server.

Server mode responsibilities:

- Start PocketBase locally and optionally bind it to the LAN when direct client access is enabled
- Advertise LAN-bound servers over mDNS for client setup
- Show the server URL in `http://host:port` format and expose the local connection passphrase in Settings
- Subscribe to `client_presence` and show connected client hostnames in the sidebar footer

Client mode responsibilities:

- Connect to an existing Relay server URL
- Write a `client_presence` heartbeat every 15 seconds with the client hostname
- Hide the client-count sidebar block because it is server-only operator context

Presence records expire from the UI after 45 seconds without a heartbeat. The collection only stores clients, so the Relay server itself is not counted.

### Offline Resilience

Offline behavior is handled by:

- `src/main/cache/OfflineCache.ts`
- `src/main/cache/PendingChanges.ts`
- `src/main/cache/SyncManager.ts`

Responsibilities:

- Keep a local cache of collection snapshots for offline reads
- Queue writes that occur while disconnected
- Replay queued changes when the connection returns
- Record conflicts in the `conflict_log` collection

### Privileged Identity And Commands

Relay keeps ordinary operator attribution and privileged authorization as separate identities. Selecting a name in the sidebar remains passwordless and only controls attribution. It never signs that operator into an administrator or publisher account.

Privileged authentication uses a dedicated main-process PocketBase client backed by its own in-memory `BaseAuthStore`. Its token does not replace the shared Relay app-user session and is never returned through preload, written to renderer state, placed in local storage, copied into the offline cache, or queued for offline replay. A privileged session locks after 15 minutes without a privileged action; ordinary Relay activity does not extend it.

Remote privileged actions use the existing PocketBase connection and port:

```text
operator password
  -> trusted IPC -> main-only privileged auth store
  -> paired P-256 key in Electron safeStorage
  -> canonical command + 90-second expiry + unique request ID
  -> existing PocketBase command collection / realtime signal
  -> server validates current account, operator, assignment, device, and signature
  -> allowlisted handler -> bounded safe result
```

The server PC is the local trust and recovery boundary. It does not need a paired-device record, but it still requires an active privileged login and sends local actions through the same typed authorization and command-result path. Client laptops must be paired with a server-issued, single-use challenge that expires after 10 minutes. Only the public P-256 key and fingerprint are stored on the server; the encrypted private key stays on its originating workstation.

Command request IDs are unique and results are idempotent. A repeated matching request returns its stored safe result, while conflicting reuse is rejected. The server derives capabilities from current records for every command rather than trusting the role claimed by the renderer or client. Privileged commands are online-only and are absent from both the cache allowlists and pending-mutation queue.

The foundation intentionally exposes only a read-only status probe and the internal reauthentication proof command. Operator and Knowledge Base mutations are added as separate allowlisted handlers rather than a general-purpose data bridge.

### Read-Only Knowledge Base

The Relay server owns the Knowledge Base source library at `<config data>/knowledge-base`. A PDF at the root is categorized as `General`; an immediate child directory becomes a category; deeper directories are ignored. Source files are limited to 50 MiB and 1,000 pages. The renderer has no mutation path for the library.

`KnowledgeBaseManager` creates the source folder for a new empty library, performs a startup reconciliation, debounces filesystem changes, and repeats reconciliation every five minutes as a watcher fallback. If mirrored records already exist but the source root is absent, it preserves the mirror and waits for the source to be restored instead of creating an empty root that could look like a mass deletion. It hashes and reparses changed files only. A single-concurrency worker extracts native PDF bookmarks when present and otherwise infers a bounded, two-level heading outline. The persisted outline is limited to 500 nodes.

The server mirrors metadata and a protected PDF file into the server-owned `knowledge_documents` PocketBase collection. Clients subscribe to that metadata through the same realtime and offline snapshot path as other read models. PDF bytes do not ride the metadata stream: the renderer requests one validated document/checksum pair through trusted IPC, and the main process either reads the validated server source or authenticates to the Relay server's protected file endpoint.

Opened client PDFs are stored content-addressed at `<config data>/knowledge-cache/<sha256>.pdf`. Downloads are size-, signature-, and checksum-verified before atomic promotion. The cache is on demand, has a 2 GiB LRU budget, and retains unreferenced entries for at most 30 days. Cached documents remain available while disconnected; unopened documents show an offline-unavailable state. Knowledge metadata and PDF bytes stay on the configured Relay LAN path.

Link annotations branch through Relay-owned navigation rather than PDF action execution:

```text
PDF link annotation
  -> Relay overlay
     -> native destination -> current PDF.js document
     -> PDF filename/path -> indexed metadata -> selected Relay guide
     -> HTTP(S) -> dedicated preload IPC -> main validation -> system browser
```

PDF.js may recover URI, Launch/GoToR, or JavaScript actions into indistinguishable URL fields. The overlay treats those fields as origin-agnostic inert text, then reclassifies them through Relay's resolver. No branch executes the originating PDF action: local paths are metadata-only document identifiers, while browser navigation requires an explicit click and the dedicated trusted, rate-limited HTTP(S) IPC boundary.

Deletion reconciliation preserves the last healthy index when the folder is missing or unreadable. Any invalid or unreadable entry also blocks deletions for that scan, so a partial copy cannot turn the last healthy mirror into a deletion. If more than 25% of known documents disappear, Relay requires the identical missing set in two healthy scans at least five minutes apart before deleting records. Failed extraction or upload preserves the last valid record.

PocketBase backup/restore includes the mirrored collection and protected file storage. The administrator-managed source folder and each workstation's local PDF cache are outside that backup; preserve the source folder separately. After a restore, the server reconciles the mirror against the source library, while clients can repopulate caches on demand.

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
- Notes
- Knowledge
- Service Status
- People
- Servers

### Hooks And Services

The renderer separates concerns between:

- Hooks in `src/renderer/src/hooks/` for UI state and effects
- Services in `src/renderer/src/services/` for PocketBase data access
- Shared components in `src/renderer/src/components/`

This keeps React views thin and moves data operations into testable modules.

## Storage Model

Relay bootstraps the PocketBase collections it needs at runtime. The core collections include:

| Collection                            | Purpose                                             |
| ------------------------------------- | --------------------------------------------------- |
| `contacts`                            | People directory                                    |
| `servers`                             | Server directory                                    |
| `oncall`                              | On-call rows and ordering                           |
| `bridge_groups`                       | Saved compose groups                                |
| `bridge_history`                      | Compose history                                     |
| `alert_history`                       | Saved alert cards                                   |
| `alert_reminders`                     | Follow-up reminders from alerts                     |
| `notes`                               | Notes attached to contacts and servers              |
| `standalone_notes`                    | Freeform notes tab data                             |
| `oncall_dismissals`                   | On-call alert dismissals                            |
| `oncall_board_settings`               | Board-level settings                                |
| `client_presence`                     | Active client heartbeat records                     |
| `conflict_log`                        | Offline sync conflict records                       |
| `knowledge_documents`                 | Read-only PDF metadata and protected mirror         |
| `relay_operators`                     | Passwordless operator attribution profiles          |
| `relay_privileged_accounts`           | Main-only administrator/publisher authentication    |
| `relay_privileged_state`              | Current administrator/publisher assignments         |
| `relay_privileged_devices`            | Paired workstation public keys and revocation state |
| `relay_privileged_commands`           | Signed request IDs and bounded safe results         |
| `relay_privileged_pairing_challenges` | Server-only one-time pairing challenges             |
| `relay_privileged_pairing_requests`   | Account-scoped client pairing submissions           |

Dynatrace dashboard definitions are not stored in PocketBase. They are local app configuration in `dynatrace-dashboards.json` under Relay's app data directory because the dashboard list is a local operator convenience and contains external URLs rather than shared operational data.

`knowledge_documents` is server-owned: authenticated users can list/view records, but API create/update/delete rules are disabled. It is readable through Relay's metadata cache allowlist and deliberately excluded from writable-cache and offline-mutation allowlists.

Privileged account, device, command, and pairing collections are not part of the ordinary Relay cache. The nonsecret assignment singleton is readable by authenticated Relay clients for role labels, but only the server can mutate it.

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
