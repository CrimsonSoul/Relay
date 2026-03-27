# Relay Architecture

System design for the Relay Electron desktop application.

## Stack

| Layer          | Technology                   | Version             |
| -------------- | ---------------------------- | ------------------- |
| Shell          | Electron                     | 41                  |
| Renderer       | React                        | 19                  |
| Language       | TypeScript                   | 5.9 (strict)        |
| Build          | Vite + electron-vite         | 7 / 5               |
| Validation     | Zod                          | 4                   |
| Database       | PocketBase (embedded SQLite) | 0.26                |
| SDK            | pocketbase                   | 0.26                |
| Virtualization | react-window + AutoSizer     | 2                   |
| Drag & Drop    | @dnd-kit                     | core 6, sortable 10 |

## Process Model

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process (Node.js)                                     │
│                                                             │
│  ┌──────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ Handlers │  │ PocketBaseProcess│  │ AppConfig        │  │
│  │ (IPC)    │  │ (lifecycle)      │  │ (config.json)    │  │
│  └────┬─────┘  └────────┬─────────┘  └──────────────────┘  │
│       │                 │                                   │
│  ┌────┴──────────────┐  │  ┌──────────────────────────────┐ │
│  │ OfflineCache      │  │  │ PocketBase binary            │ │
│  │ PendingChanges    │  └──│ (embedded Go server,         │ │
│  │ SyncManager       │     │  localhost only)             │ │
│  └───────────────────┘     └──────────────────────────────┘ │
└─────────────────────┬───────────────────────────────────────┘
                      │ contextBridge (preload)
┌─────────────────────┴───────────────────────────────────────┐
│  Renderer Process (Chromium)                                │
│                                                             │
│  window.api.*  →  Hooks  →  Components  →  Tabs            │
│                                                             │
│  Data CRUD: direct HTTP calls to PocketBase REST API        │
│  (bypasses IPC entirely for all collection reads/writes)    │
│                                                             │
│  No Node.js access. No fs. No electron imports.            │
└─────────────────────────────────────────────────────────────┘
```

### Main Process

Entry point: `src/main/index.ts`

Responsibilities:

- Window creation and lifecycle management
- IPC handler registration (delegated to handler modules)
- PocketBase process lifecycle (start, health check, crash recovery)
- External API proxying (weather, geolocation, cloud status)
- HTTP 401 interception and credential management
- Offline cache reads/writes on behalf of the renderer
- Backup creation and restoration with cache invalidation
- Structured logging with rotation

Key services:

- **PocketBaseProcess** (`pocketbase/PocketBaseProcess.ts`): Spawns and manages the embedded PocketBase binary. Polls `/api/health` until ready. Restarts on crash (up to 3 attempts). Sends SIGTERM on Unix / `taskkill /F` on Windows at shutdown.
- **AppConfig** (`config/AppConfig.ts`): Reads and writes `config.json` (mode, port/serverUrl, secret). Encrypts the secret at rest using Electron `safeStorage` when available.
- **OfflineCache** (`cache/OfflineCache.ts`): Local `better-sqlite3` database storing a snapshot of each PocketBase collection. Used as a fallback data source when PocketBase is unreachable.
- **PendingChanges** (`cache/PendingChanges.ts`): `better-sqlite3` queue of write operations made while offline. Each entry records the collection, action (create/update/delete), payload, and timestamp.
- **SyncManager** (`cache/SyncManager.ts`): Replays the `PendingChanges` queue against PocketBase on reconnect. Detects conflicts by comparing server `updated` timestamps against the client timestamp; logs conflicts to a `conflict_log` collection and applies last-write-wins.
- **CredentialManager** (`credentialManager.ts`): Encrypts/decrypts proxy credentials with Electron `safeStorage`.
- **RateLimiter** (`rateLimiter.ts`): Prevents excessive API calls.
- **Logger** (`logger.ts`): Structured logging with file rotation, error categorization, sensitive data sanitization.

### Preload

Entry point: `src/preload/index.ts`

Exposes a typed `window.api` object via `contextBridge.exposeInMainWorld`. Every method maps to an `ipcRenderer.invoke` or `ipcRenderer.on` call. The renderer never imports Electron or Node.js modules directly.

The full API surface is defined by the `BridgeAPI` type in `src/shared/ipc.ts`. The bridge is intentionally narrow: it covers window management, weather/location APIs, cloud status, auth, clipboard, alert image/logo management, setup, cache/sync, backups, logging, and PocketBase bootstrap. All data CRUD (contacts, servers, on-call, etc.) bypasses IPC entirely — the renderer calls the PocketBase REST API directly via the `pocketbase` SDK.

### Renderer

Entry point: `src/renderer/src/App.tsx`

React application with sidebar navigation and 9 tabs. Uses the "mount once, keep alive" pattern — once a tab is visited, it stays in the DOM (hidden via CSS) to preserve state and scroll position. Only the Compose tab loads eagerly; others use `React.lazy`.

State is managed through custom hooks (one per feature domain) that call the PocketBase SDK directly for data operations, and `window.api` methods for system-level operations. Context providers handle cross-cutting concerns (location, notes, connection state).

The renderer's PocketBase client is initialized in `src/renderer/src/services/pocketbase.ts`. This module exports `initPocketBase`, `authenticate`, `getPb`, and connection-state helpers (`onConnectionStateChange`, `isOnline`, `startHealthCheck`). Services under `src/renderer/src/services/` (e.g. `contactService.ts`, `serverService.ts`, `oncallService.ts`) build on `getPb()` to call collection endpoints directly.

### Shared

Location: `src/shared/`

Contains TypeScript types, IPC channel definitions, Zod validation schemas, and phone number utilities. Imported by main, preload, and renderer.

## Data Handling

### Storage Format

All application data is stored in PocketBase's embedded SQLite database. The following collections are defined:

| Collection          | Contents                                                       |
| ------------------- | -------------------------------------------------------------- |
| `contacts`          | Contact records (name, email, phone, title)                    |
| `servers`           | Server records (name, business area, owner, OS, etc.)          |
| `oncall`            | On-call records (team, role, name, contact, sort order)        |
| `bridge_groups`     | Bridge group presets (name, contact emails)                    |
| `bridge_history`    | Bridge composition log (groups, contacts, timestamp)           |
| `alert_history`     | Alert composition log (severity, subject, body, sender, label) |
| `notes`             | Contact and server notes with tags (entityType, entityKey)     |
| `standalone_notes`  | Standalone notes with title, content, color, tags, sort order  |
| `saved_locations`   | Weather saved locations                                        |
| `oncall_dismissals` | On-call alert dismissal tracking (alertType, dateKey)          |
| `conflict_log`      | Sync conflict records (collection, recordId, overwritten data) |

Schema migrations live in `src/main/pocketbase/migrations/` and are applied automatically on startup via the `--migrationsDir` flag.

### Database Access Pattern

The renderer talks to PocketBase directly over HTTP (localhost). There is no IPC proxy for collection reads or writes — the `pocketbase` SDK in the renderer process issues REST calls to `http://127.0.0.1:<port>`. PocketBase provides ACID transactions and enforces record-level access rules.

The main process holds a separate `PocketBase` client instance used only by `SyncManager` for replaying the offline queue.

### Offline Fallback

When PocketBase is unreachable the renderer falls back to data cached in `OfflineCache`. Writes made offline are recorded in `PendingChanges`. On reconnect the renderer calls `window.api.syncPending()`, which triggers `SyncManager.syncAll()` in the main process to flush the queue.

The offline cache is invalidated (cleared) in two scenarios to prevent stale data from being served:

- **Reconfiguration**: When the user saves a new configuration via setup, the cache is cleared so stale data from a previous server does not persist.
- **Backup restore**: After restoring a PocketBase backup, the cache is cleared so it does not serve data from the pre-restore state.

The `SyncManager` and `PendingChanges` queue provide the infrastructure for future offline-write support. Currently, the sync pipeline replays queued writes on reconnect and logs conflicts to the `conflict_log` collection using a last-write-wins strategy.

### Realtime Subscriptions

The renderer uses the PocketBase SDK's realtime subscription API (`pb.collection(...).subscribe(...)`) to receive push updates from the server. This replaces the chokidar file-watcher used in the previous architecture.

### Crash Safety

The PocketBase binary uses SQLite WAL mode. If the process is terminated unexpectedly, SQLite's WAL recovery ensures data integrity on the next startup. `PocketBaseProcess.killSync()` is called during Electron's `before-quit` event to release the WAL lock cleanly before exit.

## IPC Contracts

### Channel Naming

Channels follow the `domain:action` convention and are defined as string constants in `IPC_CHANNELS` (`src/shared/ipc.ts`).

### Current IPC Surface

Data CRUD for all collections is handled directly by the renderer via the PocketBase REST API — it does **not** go through IPC. IPC is used only for:

```
window:minimize, window:maximize, window:close, window:isMaximized,
window:maximizeChange, window:openAux
fs:openPath, shell:openExternal
auth:requested, auth:submit, auth:cancel, auth:useCached
weather:get, weather:search, weather:alerts
location:ip
cloudstatus:get
radar:data, config:registerRadarUrl
clipboard:write, clipboard:writeImage
alert:saveImage, alert:saveCompanyLogo, alert:getCompanyLogo, alert:removeCompanyLogo,
alert:saveFooterLogo, alert:getFooterLogo, alert:removeFooterLogo
drag:started, drag:stopped
oncall:alertDismissed
setup:getConfig, setup:saveConfig, setup:isConfigured
cache:read, cache:write, cache:snapshot
sync:pending
pb:getUrl, pb:getSecret, pb:start
backup:list, backup:create, backup:restore
logger:toMain, metrics:logBridge
```

### Validation

Every handler validates its input with Zod schemas before processing. The `validateIpcDataSafe` function from `src/shared/ipcValidation.ts` parses input and logs validation failures. Invalid input returns `{ success: false, error: 'Invalid input' }` without throwing.

### Return Types

Mutation handlers return `IpcResult<T>`:

```typescript
type IpcResult<T = void> = {
  success: boolean;
  data?: T;
  error?: string;
  rateLimited?: boolean;
};
```

Query handlers return the data directly (arrays, objects, or null).

## Tab Behaviors

### Compose (AssemblerTab)

Build communication bridges from contacts and groups. The sidebar lists available groups with checkboxes. Selected contacts appear in a virtualized composition list. "Draft Bridge" copies the assembled contact list to the clipboard and logs the bridge to history.

Sub-components: `AssemblerSidebar`, `CompositionList`, `VirtualRow`, `SaveGroupModal`, `BridgeHistoryModal`, `BridgeReminderModal`, `SidebarToggleHandle`

Bridge history auto-saves silently (no prompt). History entries record the groups used, all contact emails, and a timestamp. History entries older than 30 days are pruned automatically; max 500 entries.

### On-Call Board (PersonnelTab)

Drag-and-drop grid of on-call teams. Each team card shows role assignments. Teams can be created, renamed, deleted, and reordered. Supports popout to a separate window via `openAuxWindow`. Cross-window drag state is synchronized via IPC (`drag:started`, `drag:stopped`).

Smart reminders appear on Monday/Wednesday/Friday prompting schedule updates. Auto-refresh updates data even when the app is left running.

### People (DirectoryTab)

Searchable, virtualized contact directory. Supports add/edit/delete contacts, group filtering, context menus (right-click or Shift+F10), and keyboard navigation (arrow keys, Enter to select). Contacts can be pushed directly into the Compose tab.

### Servers (ServersTab)

Virtualized server list with search, context menus, and notes. Displays business area, owner, contact, and OS for each server.

### Weather (WeatherTab)

Dashboard showing current conditions, hourly forecast, daily forecast, and severe weather alerts. Locations can be auto-detected via IP, searched by name, or saved. Multiple saved locations supported with a default setting.

### Radar (RadarTab)

Embedded weather radar via webview. The webview source is locked to an HTTPS allowlist. Webview creation is validated by the `will-attach-webview` handler in the main process.

### Alerts (AlertsTab)

Build and capture alert cards for incident communications. Each alert has a severity level (Issue, Maintenance, Info, Resolved) with corresponding color coding. The body editor supports compact and enhance text processing engines, inline highlight colors via a highlight popover, and event time banners. Completed alerts can be captured as screenshots via `html2canvas` and saved to disk or clipboard. Company and footer logos can be uploaded and persisted.

Sub-components: `AlertForm`, `AlertCard`, `AlertSeveritySelector`, `AlertBodyEditor`, `AlertLogoUpload`, `EventTimeBanner`, `HighlightPopover`, `AlertHistoryModal`

Alert history is saved to the `alert_history` collection. Entries can be pinned and labeled for quick reference.

### Notes (NotesTab)

Standalone note-taking with color-coded cards (amber, blue, green, red, purple, slate). Notes support titles, rich content with parsed formatting (via `noteContentParser`), and tags. Notes can be created, edited, reordered via drag-and-drop, and filtered by tag. Data is stored in the `standalone_notes` collection with a `sortOrder` field for persistent ordering.

Sub-components: `NoteCard`, `NoteEditor`, `NoteToolbar`, `NoteContentRenderer`

### Cloud Status (CloudStatusTab)

Monitors status pages for cloud providers: AWS, Azure, Microsoft 365, GitHub, Cloudflare, Google Cloud, Claude (Anthropic), ChatGPT (OpenAI), and Salesforce. Status data is fetched via IPC (`cloudstatus:get`) from the main process, which aggregates feeds from multiple provider-specific fetchers (RSS, Statuspage API, Google-specific, Salesforce-specific). Each incident shows severity (info, warning, error, resolved), description, and link to the provider's status page.

## Security

### Context Isolation

All renderer windows run with `contextIsolation: true` and `sandbox: true`. The renderer has no access to Node.js globals, `require`, or Electron modules. All communication goes through the typed `window.api` bridge.

### Content Security Policy

Strict CSP headers are set on all windows in `src/main/index.ts`. Script sources are limited to `self`. External connections are allowlisted by domain.

### Webview Security

Webview creation is intercepted by `will-attach-webview` in the main process. Only URLs matching the HTTPS allowlist are permitted. Navigation events and `window.open()` are blocked.

### Credential Management

Sensitive credentials (proxy auth, cached passwords, PocketBase secret) are encrypted using Electron's `safeStorage` API in the main process. The renderer never handles raw credentials — it submits them via IPC with a one-time nonce, and the main process encrypts and stores them.

The PocketBase secret stored in `config.json` is encrypted at rest via `AppConfig.save()` when `safeStorage.isEncryptionAvailable()` returns true; a plaintext fallback is used only in headless/CI environments.

### Path Validation

All file paths are validated against directory traversal attacks by `src/main/pathValidation.ts` before any file operation.

### Log Sanitization

The logger automatically strips sensitive fields (passwords, tokens, authorization headers) from log output before writing to disk.

## Logging

Structured logging with automatic rotation. See [LOGGING.md](LOGGING.md) for the full guide.

Main process: `src/main/logger.ts` — writes to `relay.log` and `errors.log`
Renderer: `src/renderer/src/utils/logger.ts` — forwards to main via IPC

Log files are stored in platform-specific app data directories:

- macOS: `~/Library/Application Support/Relay/logs/`
- Windows: `%AppData%\Relay\logs\`
- Linux: `~/.config/Relay/logs/`

Rotation at 10MB, 5 backups retained.

## Build Targets

| Platform | Target   | Architecture | Artifact           |
| -------- | -------- | ------------ | ------------------ |
| macOS    | DMG      | arm64 + x64  | `Relay-{arch}.dmg` |
| Windows  | Portable | x64          | `Relay.exe`        |

Build output goes to `release/`. Configuration in `electron-builder.yml`.

ASAR packaging enabled. Test files, config files, docs, and source maps are excluded from the build.

## Testing Strategy

### Unit Tests (Vitest)

Two separate configs for different environments:

- `vitest.config.ts` — Node environment for main process and shared code
- `vitest.renderer.config.ts` — jsdom environment for renderer code

Coverage thresholds are enforced in both configs. Tests are co-located with source code (either `*.test.ts` next to the file or in `__tests__/` directories).

### E2E Tests (Playwright)

Located in `tests/e2e/`. Run against the packaged Electron application. Configuration in `playwright.electron.config.ts`.

### Quality Gates

All must pass before merge:

- `npm run typecheck` — 0 TypeScript errors
- `npm run lint` — 0 ESLint errors/warnings (includes jsx-a11y)
- `npm test` — all unit + renderer tests pass
- Coverage thresholds met
- Pre-commit hooks pass (eslint --fix + prettier --write via husky)
