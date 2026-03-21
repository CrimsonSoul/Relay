# PocketBase Integration Design Spec

**Date:** 2026-03-21
**Status:** Approved
**Scope:** Replace Relay's JSON file storage with embedded PocketBase, add network access for multi-user support, offline fallback with conflict resolution.

---

## 1. Goals

- Replace all JSON file storage with PocketBase (embedded SQLite)
- Enable multi-user access: NOC office PC acts as server, remote/local users connect as clients
- Graceful offline fallback with local cache and pending change queue
- Last-write-wins conflict resolution with a restorable conflict log
- Maintain full data portability (JSON, CSV, Excel import/export)
- Auto-migrate existing JSON data on first launch
- Single portable folder — no installer, everything relative to the exe

## 2. Non-Goals

- Public internet exposure (relies on corporate LAN/VPN)
- Per-user authentication (shared secret only)
- Full merge/conflict resolution UI (last-write-wins with conflict log is sufficient)
- Configurable data root (replaced by portable folder model)
- Server-mode graceful degradation — if PocketBase crashes on the server and cannot restart, data is inaccessible until the app is restarted. This is acceptable because the server is the source of truth and clients have their own offline cache.

---

## 3. Deployment Topology

### Two Modes (Same Executable)

**Server mode** — NOC office PC:

- Spawns embedded PocketBase bound to `0.0.0.0:<port>`
- Is the source of truth for all data
- Up nearly 24/7

**Client mode** — Remote/local users:

- Does NOT spawn PocketBase
- Connects to the server's PocketBase URL over LAN/VPN
- Maintains local SQLite cache for offline fallback
- Queues writes when offline, syncs on reconnection

### Configuration

Stored in `data/config.json`:

```json
// Server mode
{ "mode": "server", "port": 8090, "secret": "configured-passphrase" }

// Client mode
{ "mode": "client", "serverUrl": "http://192.168.1.50:8090", "secret": "configured-passphrase" }
```

On first launch, user picks mode and enters config. Saved to `config.json` and reused on subsequent launches. Editable via settings.

### Authentication

Shared secret (passphrase) configured on the server. Clients enter it once alongside the server URL. Prevents casual access from other devices on the network. No user accounts.

**Mechanism:** PocketBase creates a single `relay_user` auth record on first setup with the configured passphrase as its password. Clients authenticate on connect via `pb.collection('users').authWithPassword('relay', secret)`. All collection rules require `@request.auth.id != ""` — unauthenticated requests are rejected. The PocketBase JS SDK stores the auth token and includes it on all subsequent requests automatically.

---

## 4. Folder Structure

### Server

```
Relay/
  Relay.exe
  pocketbase.exe
  data/
    config.json
    pb_data/              (PocketBase SQLite DB + internal files)
    pb_migrations/        (schema migration files)
    backups/              (SQLite backup copies)
    exports/              (user-triggered exports)
```

### Client

```
Relay/
  Relay.exe
  pocketbase.exe          (bundled but unused unless switching to server mode)
  data/
    config.json
    cache.db              (local SQLite cache via better-sqlite3)
    pending_changes.db    (offline write queue)
    exports/
```

---

## 5. App Lifecycle

### Server Mode Startup

1. Electron main process starts
2. Resolve `appRoot` — `path.dirname(process.execPath)` in production, project root in dev
3. Read `data/config.json` for port and secret
4. Spawn `pocketbase.exe serve --http=0.0.0.0:<port> --dir=<appRoot>/data/pb_data --migrationsDir=<appRoot>/data/pb_migrations`
5. Health check — poll `http://127.0.0.1:<port>/api/health` until ready (timeout 10s, error dialog on failure)
6. If legacy JSON files detected in old data location → run auto-migration (one-time)
7. Create BrowserWindow, pass PocketBase URL (`http://127.0.0.1:<port>`) to renderer
8. Renderer initializes PocketBase JS SDK

### Client Mode Startup

1. Read `data/config.json` for server URL and secret
2. Attempt to connect to server (health check)
3. If reachable → fetch full data, update local cache, subscribe to realtime events
4. If unreachable → load from local cache (`cache.db`), enter offline mode
5. Create BrowserWindow, renderer shows connection status indicator

### Shutdown (Server Mode)

1. `app.on('before-quit')` → gracefully stop PocketBase
   - **Windows:** Use `taskkill /PID <pid>` to send WM_CLOSE, allowing PocketBase to flush SQLite WAL cleanly
   - **macOS/Linux:** Send SIGTERM via `child.kill('SIGTERM')`
2. Wait up to 5s for graceful exit
3. Force kill if still alive (`child.kill('SIGKILL')` / `taskkill /F /PID <pid>`)
4. Electron exits

Note: Even on force-kill, SQLite with WAL mode is crash-safe by design — data will not be corrupted.

### Crash Recovery (Server Mode)

- Main process monitors child via `child.on('exit')`
- On unexpected exit: attempt restart (max 3 retries), then show error dialog

---

## 6. Database Schema

PocketBase auto-generates `id` (string), `created` (datetime), and `updated` (datetime) on every record.

### contacts

| Field | Type | Constraints |
| ----- | ---- | ----------- |
| name  | text | required    |
| email | text |             |
| phone | text |             |
| title | text |             |

### servers

| Field        | Type | Constraints |
| ------------ | ---- | ----------- |
| name         | text | required    |
| businessArea | text |             |
| lob          | text |             |
| comment      | text |             |
| owner        | text |             |
| contact      | text |             |
| os           | text |             |

### oncall

| Field      | Type   | Constraints           |
| ---------- | ------ | --------------------- |
| team       | text   | required              |
| role       | text   |                       |
| name       | text   |                       |
| contact    | text   |                       |
| timeWindow | text   |                       |
| sortOrder  | number | ordering within teams |

### bridge_groups

| Field    | Type | Constraints                   |
| -------- | ---- | ----------------------------- |
| name     | text | required                      |
| contacts | json | string array, max 200 entries |

### bridge_history

| Field          | Type   | Constraints  |
| -------------- | ------ | ------------ |
| note           | text   |              |
| groups         | json   | string array |
| contacts       | json   | string array |
| recipientCount | number |              |

Retention: 30 days, max 100 entries. Enforced by server-side cleanup (see below).

### alert_history

| Field     | Type   | Constraints                        |
| --------- | ------ | ---------------------------------- |
| severity  | select | ISSUE, MAINTENANCE, INFO, RESOLVED |
| subject   | text   |                                    |
| bodyHtml  | text   | max 50000                          |
| sender    | text   |                                    |
| recipient | text   |                                    |
| pinned    | bool   | default false                      |
| label     | text   | only when pinned                   |

Retention: 90 days unpinned, pinned kept indefinitely. Max 50 unpinned + 100 pinned. Enforced by server-side cleanup (see below).

### Retention Enforcement

The Electron main process (server mode only) runs a cleanup task on startup and every 24 hours:

- Delete `bridge_history` records older than 30 days, keep max 100
- Delete unpinned `alert_history` records older than 90 days, keep max 50 unpinned + 100 pinned
- Delete `conflict_log` entries older than 90 days

Cleanup runs via PocketBase API calls (filter + delete), not direct SQL.

### notes

| Field      | Type   | Constraints                    |
| ---------- | ------ | ------------------------------ |
| entityType | select | contact, server                |
| entityKey  | text   | lowercase email or server name |
| note       | text   | max 10000                      |
| tags       | json   | string array, max 20           |

Flattened from the current nested `{ contacts: {}, servers: {} }` structure.

### saved_locations

| Field     | Type   | Constraints |
| --------- | ------ | ----------- |
| name      | text   | required    |
| lat       | number | -90 to 90   |
| lon       | number | -180 to 180 |
| isDefault | bool   |             |

### oncall_layout

| Field  | Type   | Constraints      |
| ------ | ------ | ---------------- |
| team   | text   | required, unique |
| x      | number | grid position    |
| y      | number | grid position    |
| w      | number | optional         |
| h      | number | optional         |
| static | bool   | optional         |

### conflict_log

| Field           | Type | Constraints                    |
| --------------- | ---- | ------------------------------ |
| collection      | text | which collection was affected  |
| recordId        | text | the overwritten record's ID    |
| overwrittenData | json | full snapshot before overwrite |
| overwrittenBy   | text | client identifier              |

---

## 7. Renderer Data Access Layer

### Architecture

The renderer communicates directly with PocketBase via its JS SDK over HTTP. No IPC for data operations.

```
src/renderer/services/
  pocketbase.ts              ← SDK instance, init, connection state
  contactService.ts          ← CRUD for contacts collection
  serverService.ts
  oncallService.ts
  bridgeGroupService.ts
  bridgeHistoryService.ts
  alertHistoryService.ts
  notesService.ts
  savedLocationService.ts
  oncallLayoutService.ts

src/renderer/hooks/
  usePocketBase.ts           ← connection status, reconnect logic
  useContacts.ts             ← fetch + realtime subscribe, returns [data, loading, error]
  useServers.ts
  useOncall.ts
  useBridgeGroups.ts
  useBridgeHistory.ts
  useAlertHistory.ts
  useNotes.ts
  useSavedLocations.ts
  useOncallLayout.ts
```

### Connection State Machine

```
CONNECTING → ONLINE → OFFLINE → RECONNECTING → ONLINE
```

### Online-to-Offline Detection

The app uses multiple signals to detect loss of connectivity:

1. **API error catching:** Any PocketBase API call that fails with a network error transitions to offline state
2. **SSE monitoring:** The realtime subscription's `onerror`/`onclose` events trigger offline detection
3. **Periodic heartbeat:** Health check runs every 30s even while online (`GET /api/health`), catches silent SSE disconnects (common over VPN)

All three mechanisms feed into the same state transition. A single failure triggers offline mode immediately — no waiting for multiple failures.

### Online Mode

- PocketBase JS SDK talks directly to server
- Realtime SSE subscriptions keep UI in sync across all windows/clients
- Every received event also updates the local cache (client mode)
- Periodic 30s health check detects silent disconnects

### Offline Mode (Client Only)

- Reads from local SQLite cache (`cache.db`) via IPC to main process
- Writes queued in `pending_changes.db` (mutation type, collection, data, timestamp)
- UI shows "offline" indicator
- Periodic health check every 30s polls server for reconnection

### Reconnection Sync

1. Server becomes reachable
2. Replay pending changes in chronological order
3. For each write, compare server record's `updated` timestamp vs client's snapshot:
   - Not modified on server → apply normally
   - Modified on server → apply anyway (last-write-wins), log overwritten version to `conflict_log`
4. Clear pending changes queue
5. Full data refresh from server → update local cache
6. Resume realtime subscriptions
7. UI returns to "online" state

### Service Layer Pattern

```typescript
// Each service checks connection state
async function getContacts(): Promise<ContactRecord[]> {
  if (isOnline()) {
    return pb.collection('contacts').getFullList();
  }
  return ipcRenderer.invoke('cache:contacts:getAll');
}
```

---

## 8. Migration (One-Time, Server Mode)

On first server-mode launch, if legacy JSON files are detected:

1. Detect JSON files at the previously configured Relay data root
2. Create full backup of all JSON files before touching anything
3. Read and transform each JSON file:
   - Convert `createdAt`/`updatedAt` millisecond timestamps to PocketBase datetime format
   - Flatten `notes.json` nested structure into individual records with `entityType` discriminator
   - Generate `sortOrder` for `oncall` records based on array position
   - `bridgeGroups.json` (managed by `PresetOperations.ts`) maps to the `bridge_groups` collection
4. Batch-insert into PocketBase collections
5. Rename originals (e.g., `contacts.json` → `contacts.json.migrated`)
6. Log migration summary (record counts per collection, errors if any)

**Failure recovery:** If migration fails partway through (e.g., crash during batch insert), the JSON files are still in their original state (not yet renamed). On next launch, the migration detects the JSON files again and retries. To avoid duplicates, the migration deletes all PocketBase data for any collection that has a corresponding un-renamed JSON file before re-importing. This makes the migration idempotent — safe to retry from any failure point.

---

## 9. Backup & Data Portability

### Backup (Server Mode)

- **Scheduled:** SQLite file copy on configurable interval (default daily)
- **On-demand:** User triggers from UI → copies `pb_data/data.db` to `data/backups/<timestamp>.db`
- **Retention:** Keep last 10, delete older

### Import (Server Mode, Online)

| Format | Method                                        |
| ------ | --------------------------------------------- |
| JSON   | Parse → bulk create/upsert via PocketBase API |
| CSV    | Parse with csv-parse → bulk create/upsert     |
| Excel  | Parse with exceljs → bulk create/upsert       |

Upsert logic: match on unique key (email for contacts, name for servers), update existing or create new.

### Export (Any Mode, Online)

| Format | Method                                                                     |
| ------ | -------------------------------------------------------------------------- |
| JSON   | Query PocketBase → `JSON.stringify` → save via file dialog                 |
| CSV    | Query PocketBase → format as CSV with formula injection protection → save  |
| Excel  | Query PocketBase → format with exceljs (column headers, auto-width) → save |

Export categories: per-collection or "all".

---

## 10. Security

- PocketBase binds to `0.0.0.0` in server mode (LAN/VPN accessible)
- No public internet exposure — relies on corporate network security
- Shared secret (passphrase) for access control — no user accounts
- No PocketBase admin UI exposed to clients (admin routes restricted to localhost)
- Existing security posture maintained: context isolation, CSP, path validation in Electron

### CSP Changes

The renderer needs `fetch` access to PocketBase's HTTP endpoint and SSE endpoint for realtime. CSP `connect-src` must be set dynamically at window creation based on `config.json`:

- **Server mode:** `connect-src 'self' http://127.0.0.1:<port>`
- **Client mode:** `connect-src 'self' http://<serverUrl>`

This is configured in the BrowserWindow's `webPreferences` or via a custom session handler before the renderer loads.

---

## 11. Development Experience

### Dev Mode

- PocketBase binary stored in `resources/pocketbase/` (per platform, gitignored)
- Data stored in `dev-data/` (gitignored)
- Same spawn logic as production, different paths
- A download script fetches the correct PocketBase binary per platform

### Schema Management

- Schema changes made via PocketBase admin UI in dev
- Exported as migration files → committed to repo under `resources/pb_migrations/`
- Copied to `data/pb_migrations/` on build
- PocketBase auto-applies pending migrations on startup

### Build Changes

- `electron-builder.yml`: add PocketBase binary as `extraResources` (platform-specific)
- Build script to download PocketBase binary per target platform
- New dependencies: `pocketbase` (JS SDK), `better-sqlite3` (offline cache), `exceljs` (Excel import/export)
- Removed: `chokidar`
- `npmRebuild` must be enabled (or `electron-rebuild` run as a postinstall step) because `better-sqlite3` is a native C++ addon that requires compilation against Electron's Node.js ABI. Alternatively, `sql.js` (pure WASM, no native compilation) could be used if native module pain becomes an issue.

### Platform Considerations

The app builds for Windows (portable exe) and macOS (DMG). Platform-specific differences:

- **Binary naming:** `pocketbase.exe` (Windows) vs `pocketbase` (macOS/Linux)
- **Shutdown signals:** `taskkill` on Windows, SIGTERM on macOS/Linux (see Section 5)
- **Portable folder semantics:** On Windows the folder is self-contained; on macOS the binary lives inside the `.app` bundle's Resources directory
- **Download script:** Must select the correct PocketBase release binary per platform+arch (win-amd64, darwin-arm64, darwin-amd64)

### Codebase Changes

**Removed entirely:**

- `src/main/operations/` — all JSON operations, file lock, file watcher, file emitter, file manager, cache manager, JSON CRUD helper
- All IPC data channels and handlers
- `window.api` data methods from preload

**Added:**

- `src/main/pocketbase/` — process lifecycle, health check, crash recovery
- `src/main/config/` — config.json management
- `src/main/cache/` — offline cache (better-sqlite3), pending changes queue, sync logic
- `src/main/migration/` — one-time JSON → PocketBase migration
- `src/renderer/services/` — PocketBase service layer (one per collection)
- `src/renderer/hooks/` — React hooks per collection (fetch + realtime + offline)

**IPC remains for:**

- Window management (minimize, maximize, close)
- Native dialogs (file picker for import/export)
- App lifecycle (quit, get version)
- Opening external URLs
- Offline cache reads (client mode only)
- Pending changes queue management (client mode only)

---

## 12. Conflict Resolution

### Strategy: Last-Write-Wins with Conflict Log

When a client reconnects after being offline:

1. For each pending change, check if the server record's `updated` timestamp is newer than the client's snapshot
2. If conflict detected: apply the client's version (last-write-wins) AND log the overwritten server version to the `conflict_log` collection
3. The conflict log stores the full record snapshot, so data can be restored manually if needed

### Conflict Log Access

- Viewable in the app (a simple list of conflicts with timestamps)
- Each entry shows: collection, what was overwritten, when, by whom
- "Restore this version" action to revert a record to the overwritten state

### Expected Frequency

- Very low — NOC PC is up ~24/7, offline windows are brief
- Small user base reduces likelihood of concurrent edits to the same record
