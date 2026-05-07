# Relay Architecture

High-level structure of the Relay Electron application.

## Stack

| Layer         | Technology                  |
| ------------- | --------------------------- |
| Desktop shell | Electron 41                 |
| Renderer      | React 19                    |
| Language      | TypeScript 6                |
| Build         | Vite 7 + electron-vite 5    |
| Data store    | PocketBase 0.26 with SQLite |
| Validation    | Zod 4                       |
| Testing       | Vitest 4 + Playwright       |

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
- Cloud status aggregation
- Clipboard and file-system actions
- Backup and restore
- Offline cache reads and sync triggers
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
- Ensure the superuser and app user exist
- Bootstrap required collections on startup
- Start backup and retention jobs after PocketBase is healthy

Relay currently bootstraps required collections in code. It does not rely on checked-in migration files.

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

## Renderer Structure

### App Shell

The renderer entry point is `src/renderer/src/App.tsx`.

The shell consists of:

- Sidebar navigation
- Header search and utility actions
- Mount-once tab content area
- Modal and toast infrastructure

Only the Compose tab is loaded eagerly. Other major tabs are lazy-loaded.

### Tabs

The current primary tabs are:

- Compose
- Alerts
- On-Call (`Personnel`)
- People
- Servers
- Notes
- Status

### Hooks And Services

The renderer separates concerns between:

- Hooks in `src/renderer/src/hooks/` for UI state and effects
- Services in `src/renderer/src/services/` for PocketBase data access
- Shared components in `src/renderer/src/components/`

This keeps React views thin and moves data operations into testable modules.

## Storage Model

Relay bootstraps the PocketBase collections it needs at runtime. The core collections include:

| Collection              | Purpose                                |
| ----------------------- | -------------------------------------- |
| `contacts`              | People directory                       |
| `servers`               | Server directory                       |
| `oncall`                | On-call rows and ordering              |
| `bridge_groups`         | Saved compose groups                   |
| `bridge_history`        | Compose history                        |
| `alert_history`         | Saved alert cards                      |
| `notes`                 | Notes attached to contacts and servers |
| `standalone_notes`      | Freeform notes tab data                |
| `oncall_dismissals`     | On-call alert dismissals               |
| `oncall_board_settings` | Board-level settings                   |
| `conflict_log`          | Offline sync conflict records          |

## Windowing

Relay supports a main window and a small number of auxiliary windows.

Important rules:

- Auxiliary windows are route-limited
- Existing auxiliary windows are focused instead of duplicated when possible
- Navigation and `window.open()` are blocked for both main and auxiliary windows

See `src/main/app/windowFactory.ts` for the implementation.

## Security Touchpoints

Architecture decisions that directly support security:

- Context-isolated preload bridge
- Renderer sandboxing with no direct Electron imports
- Path validation for file operations
- CSP installation at the session level
- Centralized IPC validation through shared schemas

For full security guidance, see `docs/SECURITY.md`.
