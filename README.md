# Relay

Relay is an Electron desktop command center for operations teams managing people, systems, and incident bridge communications.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-0a7ea4) ![Shell](https://img.shields.io/badge/shell-Electron%2040-47848f) ![UI](https://img.shields.io/badge/ui-React%2019-149eca) ![Language](https://img.shields.io/badge/language-TypeScript%205.9-2ea043)

## Snapshot

- Local-first data model with atomic JSON writes and live file-watcher sync
- Typed IPC contracts with Zod validation and a context-isolated preload bridge
- Scales to large directories via virtualization and lazy tab loading
- Security-first desktop posture: CSP, webview allowlists, path validation, encrypted credentials
- Full quality workflow: linting, type checking, tests, and CI release packaging

## Preview

| Compose                                      | On-Call Board                               |
| -------------------------------------------- | ------------------------------------------- |
| ![Compose tab](docs/screenshots/compose.png) | ![On-Call tab](docs/screenshots/oncall.png) |

## Core Features

- **Compose** — Build bridge communication lists from contacts and groups, copy to clipboard instantly
- **On-Call Board** — Drag-and-drop team/role scheduling with week navigation and popout display mode
- **People & Servers** — Searchable directories with inline notes, tags, and quick-action menus
- **Weather** — Live conditions, NWS alerts, saved locations, and an embedded radar tab
- **AI Chat** — Sandboxed webviews for Gemini, ChatGPT, Claude, and Copilot with isolated sessions
- **Global Layer** — Command palette, keyboard shortcuts modal, import/export manager, toast notifications

## Architecture

- `src/main/`: IPC handlers, file/data services, and business-logic operations modules
- `src/preload/`: typed `window.api` bridge via Electron context isolation
- `src/renderer/`: React tabs, feature-focused hooks, and shared UI components
- `src/shared/`: IPC channel contracts, Zod validation schemas, and domain types

Business logic stays in operations modules; handlers validate inputs and delegate — no logic in handlers.

## Tech Stack

| Layer          | Technology                                      |
| -------------- | ----------------------------------------------- |
| Desktop shell  | Electron 40                                     |
| Frontend       | React 19 + TypeScript 5.9                       |
| Build          | Vite 7 + electron-vite 5                        |
| Validation     | Zod 4                                           |
| Virtualization | react-window 2 + react-virtualized-auto-sizer 2 |
| Drag and drop  | @dnd-kit/core + @dnd-kit/sortable               |
| Testing        | Vitest 4 + Playwright                           |

## Quick Start

```bash
npm install
npm run dev
```

## Quality and Testing

```bash
npm run typecheck   # TypeScript strict mode
npm run lint        # ESLint
npm test            # Vitest unit tests
npm run test:electron  # Playwright integration tests
```

Coverage thresholds are enforced:

- Main/shared: lines 52%, functions 52%, branches 38%
- Renderer: lines 78%, functions 76%, branches 67%

## Security

- Context isolation and OS-level sandbox enabled on all renderer processes
- Renderer has no direct Node.js or Electron API access
- Strict CSP headers and HTTPS-only webview allowlists
- Navigation and `window.open()` interception on all windows
- Path traversal checks on all file system operations
- Credential handling delegated to main process via Electron `safeStorage`

## Project Layout

- `src/main/operations/`: core data and business logic
- `src/main/handlers/`: IPC handler registration and input validation
- `src/renderer/src/tabs/`: feature tabs (Compose, On-Call, People, Servers, Weather, Radar, AI)
- `src/renderer/src/hooks/`: feature-focused state and side-effect hooks
- `docs/`: architecture decisions, logging guide, security notes, troubleshooting

## License

MIT
