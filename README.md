# Relay

Relay is a desktop application for operations teams to manage contacts, servers, on-call schedules, and emergency bridge communications from a single interface. Built with Electron, React, and TypeScript, it runs entirely local-first — all data stays on your machine as JSON and CSV files.

## Features

### Compose

Build communication bridges by selecting contacts and groups, then copy the assembled list to your clipboard. Bridges are logged to a searchable history. Groups can be saved as reusable presets and imported from CSV.

### On-Call Board

Drag-and-drop grid of on-call teams and assignments. Teams can be created, renamed, reordered, and populated with roles and contacts. The board supports popout to a separate window for multi-monitor setups.

### People

Searchable, virtualized contact directory. Add, edit, and delete contacts. Push contacts directly into the Compose tab. Supports keyboard navigation, context menus, and group filtering.

### Servers

Virtualized server list with business area, owner, contact, and OS information. Supports search, notes, and context menus.

### Weather

Live weather dashboard with current conditions, hourly and daily forecasts, and severe weather alerts. Locations can be auto-detected via IP, searched by name, or saved for quick switching.

### Radar

Embedded live weather radar via webview with allowlisted HTTPS sources.

### AI Chat

Sandboxed access to Gemini and ChatGPT. Session data is cleared on tab leave for privacy. Webviews run in strict isolation with no access to app data.

### Global

- **Command Palette** (`Cmd/Ctrl+K`) — search contacts, servers, groups; navigate tabs; quick actions
- **Keyboard Shortcuts** (`Cmd/Ctrl+Shift+?`) — full shortcut reference
- **Notes** — attach notes and tags to any contact or server
- **Data Manager** — import and export contacts, servers, on-call, and groups in JSON or CSV
- **Toast Notifications** — non-blocking alerts for weather, sync status, and errors
- **World Clock** — header display of current time

## Tech Stack

| Layer          | Technology                                          |
| -------------- | --------------------------------------------------- |
| Shell          | Electron 40                                         |
| Frontend       | React 19, CSS (no CSS-in-JS)                        |
| Build          | Vite 7, electron-vite 5                             |
| Language       | TypeScript 5.9 (strict, `noUncheckedIndexedAccess`) |
| Virtualization | react-window 2, react-virtualized-auto-sizer 2      |
| Drag & Drop    | @dnd-kit/core 6, @dnd-kit/sortable 10               |
| Validation     | Zod 4 (IPC schema validation)                       |
| File Watching  | Chokidar 5                                          |
| Testing        | Vitest 4 (unit + renderer), Playwright (E2E)        |
| Linting        | ESLint 9 (flat config), eslint-plugin-jsx-a11y      |
| Formatting     | Prettier 3                                          |
| Git Hooks      | Husky 9, lint-staged 16                             |
| Typography     | Sora (variable), JetBrains Mono                     |

## Getting Started

```bash
# Install dependencies
npm install

# Start development (hot reload)
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Run all tests
npm test

# Build for production
npm run build:mac   # macOS DMG (arm64 + x64)
npm run build:win   # Windows portable executable (x64)
```

## Project Structure

```
src/
  main/                  # Electron main process
    handlers/            # IPC handler registration (auth, data, files, weather, etc.)
    operations/          # Business logic (contacts, servers, on-call, groups, import/export)
    app/                 # App state and maintenance tasks
    utils/               # Path safety
    FileManager.ts       # File I/O orchestrator
    FileWatcher.ts       # Chokidar-based file change detection
    FileEmitter.ts       # Event-based notifications to renderer
    credentialManager.ts # Electron safeStorage credential handling
    logger.ts            # Structured logging with rotation
    rateLimiter.ts       # API rate limiting
    fileLock.ts          # Atomic file operations
  preload/               # Context bridge (window.api)
  renderer/
    src/
      tabs/              # Tab components (Compose, On-Call, People, Servers, Weather, Radar, AI)
      components/        # Reusable UI (modals, cards, search, sidebar, toast, etc.)
      hooks/             # Custom hooks (~23, one per feature domain)
      contexts/          # React context providers (location, notes)
      styles/            # Global CSS (theme tokens, components, modals, animations)
      utils/             # Renderer utilities (logger, secure storage, time parsing, colors)
  shared/                # Types, IPC channel definitions, Zod schemas, phone utilities
docs/                    # Architecture, development guide, logging guide, agent instructions
build/                   # App icons, macOS entitlements
```

## Architecture

### Data

All data is stored as JSON files in a user-configurable directory. File operations use atomic writes with temp files and backups. A file watcher detects external changes and pushes updates to the renderer in real time. An in-memory cache layer avoids redundant disk reads.

### IPC

All communication between main and renderer goes through Electron's context bridge. Every IPC call is validated with Zod schemas on both sides. The preload script exposes a typed `window.api` object — the renderer never has direct access to Node.js or Electron APIs.

### Security

- Context isolation and sandbox enabled
- Content Security Policy headers on all windows
- Webview creation locked to an HTTPS allowlist
- Navigation and `window.open()` blocked
- Path traversal validation on all file operations
- Credentials encrypted with Electron's safeStorage API
- Sensitive data sanitized from logs

### Rendering

Large lists (contacts, servers, composition) are virtualized with react-window. Tabs use a "mount once, keep alive" pattern — once visited, a tab stays in the DOM (hidden via CSS) to preserve scroll position and state. Only the Compose tab is eagerly loaded; all others use `React.lazy`.

## Testing

```bash
npm test               # Run all tests (unit + renderer)
npm run test:unit      # Main process + shared (Vitest, Node environment)
npm run test:renderer  # Renderer (Vitest, jsdom environment)
npm run test:coverage  # Unit tests with coverage report
npm run test:electron  # E2E tests (Playwright + Electron)
```

Coverage thresholds are enforced in both Vitest configs:

| Suite       | Lines | Functions | Branches | Statements |
| ----------- | ----- | --------- | -------- | ---------- |
| Main/Shared | 52%   | 52%       | 38%      | 52%        |
| Renderer    | 78%   | 76%       | 67%      | 79%        |

## Scripts Reference

| Script                  | Purpose                              |
| ----------------------- | ------------------------------------ |
| `npm run dev`           | Development with hot reload          |
| `npm run build`         | Production build                     |
| `npm run build:mac`     | macOS DMG                            |
| `npm run build:win`     | Windows portable .exe                |
| `npm run release`       | Build + auto-publish Windows release |
| `npm run typecheck`     | TypeScript validation                |
| `npm run lint`          | ESLint check                         |
| `npm run lint:fix`      | ESLint auto-fix                      |
| `npm test`              | All tests                            |
| `npm run test:unit`     | Main/shared unit tests               |
| `npm run test:renderer` | Renderer unit tests                  |
| `npm run test:coverage` | Unit tests with coverage             |
| `npm run test:electron` | Playwright E2E tests                 |
| `npm run format`        | Prettier format all files            |
| `npm run format:check`  | Prettier check                       |

## Pre-Commit Hooks

Husky runs lint-staged on every commit:

- `.ts` / `.tsx` files: `eslint --fix` then `prettier --write`
- `.css` / `.json` / `.md` files: `prettier --write`

## Logging

Structured logging writes to disk with automatic rotation at 10MB (5 backups retained). Logs are stored in platform-specific locations:

| Platform | Path                                        |
| -------- | ------------------------------------------- |
| macOS    | `~/Library/Application Support/Relay/logs/` |
| Windows  | `%AppData%\Relay\logs\`                     |
| Linux    | `~/.config/Relay/logs/`                     |

Files:

- `relay.log` — all application logs
- `errors.log` — errors only

The renderer logger forwards entries to the main process over IPC. Both loggers support levels (DEBUG, INFO, WARN, ERROR, FATAL), module categorization, and automatic sensitive data sanitization.

See [docs/LOGGING.md](docs/LOGGING.md) for the full guide.

## Documentation

- [Architecture](docs/architecture.md) — system design, data handling, IPC contracts, security model
- [Development Guide](docs/DEVELOPMENT.md) — patterns, conventions, testing strategy, code style
- [Logging Guide](docs/LOGGING.md) — logger usage, configuration, examples
- [Logging Examples](docs/LOGGING_EXAMPLES.ts) — annotated code patterns
- [Agent Instructions](docs/AGENTS.md) — AI agent workflow reference
