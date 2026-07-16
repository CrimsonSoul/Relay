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

The public command catalog is an explicit allowlist rather than a general-purpose data bridge. Administrator commands cover the operator roster, the single Knowledge Publisher assignment, paired devices, sanitized administration snapshots, and three typed Dynatrace settings. The server resolves current account, operator, role, assignment, device, and revision records again for every command. Publisher sessions retain only `privileged.status.read` and `knowledge.manage`.

### Remote Relay Administration

Settings exposes the ordinary operator roster as a synchronized read-only surface. An `Administration` area appears only while Ryan Bledsoe's administrator session is active. The same signed command path works from the Relay server PC and a paired work laptop:

| Area                                           | Administrator                            | Publisher | Ordinary operator |
| ---------------------------------------------- | ---------------------------------------- | --------- | ----------------- |
| Read synchronized roster                       | Yes                                      | Yes       | Yes               |
| Add, rename, activate, or deactivate operators | Yes                                      | No        | No                |
| Assign the single Knowledge Publisher          | Yes, fresh reauthentication              | No        | No                |
| Rename or revoke paired devices                | Yes; revoke needs fresh reauthentication | No        | No                |
| Replace approved Dynatrace settings            | Yes; token needs fresh reauthentication  | No        | No                |
| Manage Knowledge Base documents                | Yes                                      | Yes       | No                |

`administration.snapshot.read` returns only bounded public views: operator status and revisions, role assignment IDs, configured/not-configured credential state, device labels and fingerprint suffixes, and redacted setting summaries. Passwords, hashes, tokens, public keys, private-key state, command envelopes, filesystem paths, and raw PocketBase errors are excluded.

The initial administrator password and later privileged credential recovery stay on the server PC. Bootstrap leaves the Ryan Bledsoe administrator account unusable until that local first-password step succeeds; Relay ships no default credential. Publisher reassignment creates a pending inactive account, revokes the prior publisher's sessions/devices, and requires local credential setup before the new publisher can sign in.

Remote settings are intentionally limited to the Dynatrace environment URL, platform-token replacement, and alerting-profile filter. Relay connection paths, backup/restore selection, folder pickers, executables, and other filesystem-dependent operations remain local to the server PC.

### Managed Knowledge Base

PocketBase on the Relay server is the sole Knowledge Base document authority. There is no administrator-managed source folder, watcher, or filesystem reconciliation path. Ordinary operators have read-only access. An administrator or the single designated publisher can choose PDFs on the server PC or a paired work laptop and manage them through capability-checked privileged commands. Source files are limited to 50 MiB and 1,000 pages; batches are limited to 100 files.

The client main process inspects each selected regular PDF without exposing its path or bytes to the renderer. It builds a persistent upload queue, hashes and reads the file in bounded 4 MiB chunks, and revalidates the canonical path, file identity, size, modification time, signature, and checksum before transfer. At most two chunks are in flight. Retryable network failures use bounded exponential backoff; after eight attempts the item pauses for network recovery. The encrypted queue survives restart when Electron `safeStorage` is available. If the source moved or changed, the publisher must reselect the same unchanged PDF.

Upload manifests and chunks live in account- and device-bound PocketBase collections. The server reports missing chunk indexes so a client reconnecting over VPN sends only unacknowledged data. Once complete, a single-concurrency worker assembles and checksum-validates the file, extracts native PDF bookmarks or a bounded inferred outline, and leaves the upload ready for publisher review. Publishing or replacing copies the protected PDF into `knowledge_documents` and immediately clears the temporary staged file. Unpublished upload records expire after seven days.

Clients subscribe to `knowledge_documents` metadata through the same realtime and offline snapshot path as other read models. PDF bytes do not ride the metadata stream: the renderer requests one validated document/checksum pair through trusted IPC, and the main process authenticates to the Relay server's protected file endpoint.

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
