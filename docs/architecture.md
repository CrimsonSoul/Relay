# Relay Architecture

System design for the Relay Electron desktop application.

## Stack

| Layer          | Technology               | Version             |
| -------------- | ------------------------ | ------------------- |
| Shell          | Electron                 | 40                  |
| Renderer       | React                    | 19                  |
| Language       | TypeScript               | 5.9 (strict)        |
| Build          | Vite + electron-vite     | 7 / 5               |
| Validation     | Zod                      | 4                   |
| File Watching  | Chokidar                 | 5                   |
| Virtualization | react-window + AutoSizer | 2                   |
| Drag & Drop    | @dnd-kit                 | core 6, sortable 10 |

## Process Model

```
┌─────────────────────────────────────────────────────┐
│  Main Process (Node.js)                             │
│                                                     │
│  ┌──────────┐  ┌────────────┐  ┌────────────────┐  │
│  │ Handlers │──│ Operations │──│ File Lock      │  │
│  │ (IPC)    │  │ (Logic)    │  │ (Atomic I/O)   │  │
│  └────┬─────┘  └────────────┘  └───────┬────────┘  │
│       │                                │            │
│  ┌────┴─────┐  ┌────────────┐  ┌──────┴─────────┐  │
│  │ Zod      │  │ FileWatcher│  │ JSON Files     │  │
│  │ Validate │  │ (chokidar) │  │ (data root)    │  │
│  └──────────┘  └─────┬──────┘  └────────────────┘  │
│                      │                              │
│  ┌───────────────────┴──────────────────────────┐   │
│  │ FileEmitter (pushes changes to all windows)  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────┘
                      │ contextBridge (preload)
┌─────────────────────┴───────────────────────────────┐
│  Renderer Process (Chromium)                        │
│                                                     │
│  window.api.*  →  Hooks  →  Components  →  Tabs    │
│                                                     │
│  No Node.js access. No fs. No electron imports.     │
└─────────────────────────────────────────────────────┘
```

### Main Process

Entry point: `src/main/index.ts`

Responsibilities:

- Window creation and lifecycle management
- IPC handler registration (delegated to handler modules)
- File system access (all reads/writes go through `fileLock.ts`)
- External API proxying (weather, geolocation)
- HTTP 401 interception and credential management
- Structured logging with rotation

Key services:

- **FileManager** (`FileManager.ts`): Orchestrates data loading, caching, and change detection
- **FileWatcher** (`FileWatcher.ts`): Chokidar-based file change monitoring
- **FileEmitter** (`FileEmitter.ts`): Pushes data updates to renderer windows
- **DataCacheManager** (`DataCacheManager.ts`): In-memory cache to avoid redundant disk reads
- **FileSystemService** (`FileSystemService.ts`): Low-level file system abstraction
- **CredentialManager** (`credentialManager.ts`): Encrypts/decrypts credentials with Electron safeStorage
- **RateLimiter** (`rateLimiter.ts`): Prevents excessive API calls
- **Logger** (`logger.ts`): Structured logging with file rotation, error categorization, sensitive data sanitization

### Preload

Entry point: `src/preload/index.ts`

Exposes a typed `window.api` object via `contextBridge.exposeInMainWorld`. Every method maps to an `ipcRenderer.invoke` or `ipcRenderer.on` call. The renderer never imports Electron or Node.js modules directly.

The full API surface is defined by the `BridgeAPI` type in `src/shared/ipc.ts`.

### Renderer

Entry point: `src/renderer/src/App.tsx`

React application with sidebar navigation and 7 tabs. Uses the "mount once, keep alive" pattern — once a tab is visited, it stays in the DOM (hidden via CSS) to preserve state and scroll position. Only the Compose tab loads eagerly; others use `React.lazy`.

State is managed through custom hooks (one per feature domain) that call `window.api` methods and manage local React state. Context providers handle cross-cutting concerns (location, notes).

### Shared

Location: `src/shared/`

Contains TypeScript types, IPC channel definitions, Zod validation schemas, and phone number utilities. Imported by main, preload, and renderer.

## Data Handling

### Storage Format

All data is stored as JSON files in a user-configurable data directory:

| File                  | Contents                                              |
| --------------------- | ----------------------------------------------------- |
| `contacts.json`       | Contact records (name, email, phone, title)           |
| `servers.json`        | Server records (name, business area, owner, OS, etc.) |
| `oncall.json`         | On-call records (team, role, name, contact)           |
| `bridgeGroups.json`   | Bridge group presets (name, contact emails)           |
| `bridgeHistory.json`  | Bridge history log (groups, contacts, timestamp)      |
| `notes.json`          | Contact and server notes with tags                    |
| `savedLocations.json` | Weather saved locations                               |

Legacy CSV files (`contacts.csv`, `servers.csv`) are supported for import but not used as primary storage.

### Atomic Writes

All write operations use `modifyJsonWithLock` from `fileLock.ts`:

1. Acquire in-memory lock for the file path (prevents concurrent writes)
2. Read current file contents
3. Pass to caller's callback function
4. Write callback return value to a temporary file
5. Rename temp file over original (atomic on all platforms)
6. Release lock

If any step fails, the temp file is cleaned up and the original remains untouched.

### File Watching

`FileWatcher` monitors the data directory with chokidar. When a JSON data file changes on disk (from an external editor, another instance, or a sync tool), `FileEmitter` pushes the updated data to all renderer windows via IPC. The `DataCacheManager` invalidates its cache for the affected file.

### Backups

`BackupOperations` creates timestamped backups during critical operations (bulk imports, migrations). Backups are stored alongside the data files.

## IPC Contracts

### Channel Naming

Channels follow the `domain:action` convention:

```
contacts:get, contacts:add, contacts:update, contacts:delete
servers:get, servers:add, ...
oncall:get, oncall:add, oncall:deleteByTeam, ...
groups:get, groups:save, groups:update, groups:delete
history:get, history:add, history:delete, history:clear
notes:get, notes:setContact, notes:setServer
locations:get, locations:save, locations:setDefault, ...
weather:get, weather:search, weather:alerts
data:export, data:import, data:stats
```

All channels are defined as string constants in `IPC_CHANNELS` (`src/shared/ipc.ts`).

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

### AI Chat (AIChatTab)

Sandboxed access to Gemini and ChatGPT via webview. Session data is automatically cleared when leaving the tab. Webviews run in strict isolation with no access to app data or the main process.

## Security

### Context Isolation

All renderer windows run with `contextIsolation: true` and `sandbox: true`. The renderer has no access to Node.js globals, `require`, or Electron modules. All communication goes through the typed `window.api` bridge.

### Content Security Policy

Strict CSP headers are set on all windows in `src/main/index.ts`. Script sources are limited to `self`. External connections are allowlisted by domain.

### Webview Security

Webview creation is intercepted by `will-attach-webview` in the main process. Only URLs matching the HTTPS allowlist are permitted. Navigation events and `window.open()` are blocked.

### Credential Management

Sensitive credentials (proxy auth, cached passwords) are encrypted using Electron's `safeStorage` API in the main process. The renderer never handles raw credentials — it submits them via IPC with a one-time nonce, and the main process encrypts and stores them.

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
