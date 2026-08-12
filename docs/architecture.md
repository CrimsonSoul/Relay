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
| Testing       | Vitest 4.1.10 and Playwright 1.62.0                     |

Dependency and runtime declarations live in `package.json`, `package-lock.json`, and
`.node-version`. Release versions are derived from conventional commits on `test` and injected into
the packaged application by the gated GitHub release workflow.

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

### Service Status

`src/main/handlers/cloudStatus/CloudStatusManager.ts` polls official status sources and owns one
combined in-memory view. Persistence remains split for compatibility:

- `cloud_status_snapshot` keeps the original ten-provider contract.
- `cloud_status_mist_snapshot` contains four Juniper Mist region rows.
- `cloud_status_extension_snapshot` contains post-compatibility providers, beginning with Dynatrace.

Updated clients merge all three records. Older clients retain the original or original-plus-Mist
shapes, and updated clients connected to an older server keep missing Mist or extension providers
visible as Unknown without creating false outage alerts.

#### Dynatrace and Mist roll-up

The extension partition is reusable for later providers. Updated clients merge every available
partition; older clients retain the original and Mist shapes, while an updated client connected to
an older server defaults missing extension providers to Unknown rather than failing or generating a
false outage.

The public API and persisted snapshots retain the raw provider buckets, while a display aggregation
layer owns the operator-facing provider list. It deduplicates the same Mist incident across regional
buckets, unions its affected regions, and presents one `Juniper Mist` row. Dynatrace is a single
display provider; its dedicated Status.io adapter maps affected cloud and region containers into the
same bounded affected-scope metadata. Service Status presents twelve rows: the original ten
providers, Juniper Mist, and Dynatrace.

Roll-up posture uses the worst current availability state: outage, degraded, unknown, then
operational. Status.io degraded performance maps to degraded, while partial and full service
disruptions map to outage. Planned maintenance, closed incidents, security-only notices, stale
records, and operational monitoring updates do not enter the active issue list. A failed feed keeps
the last good snapshot and marks only its display provider Unknown; a partial Mist component
failure cannot manufacture an outage.

Cloud notifications consume the display aggregation rather than the raw regional buckets, so a Mist
incident produces one stable notification regardless of how many regions it affects. Dynatrace
public-status incidents use normal cloud-notification priority. The separate Dynatrace Problems
notification manager remains authoritative for tenant problems and keeps priority over cloud
notifications.

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
```

Upload coordination lives under `src/main/knowledge/`, with
`KnowledgeUploadCoordinator.ts` and `ManagedKnowledgeService.ts` separating client transfer from
server authority. Source paths and PDF bytes never enter renderer state.

Full-text search is optional derived data. `src/main/knowledge/knowledgeSearchRuntime.ts` builds
and serves bounded passages from managed PDFs. Search failure disables search without weakening
the authoritative library or document reader.

Desktop PDF and cover caches are checksum-addressed, bounded, and disposable. They improve offline
reading but never become a second document authority. Operator procedures and current limits live
in `docs/knowledge-base.md`; file and trust controls live in `docs/SECURITY.md`.

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
navigation limited to approved Dynatrace and Microsoft authentication hosts.

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
