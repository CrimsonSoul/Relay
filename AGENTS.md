# Relay - Agent Guidelines

## Overview
Electron desktop app for operations teams. Manages on-call schedules, contacts, 
servers, and weather monitoring.

## Tech Stack
- Electron 34 + React 18 + TypeScript 5.9
- Build: Vite + electron-vite
- Testing: Vitest (unit) + Playwright (E2E)

## Architecture

### Process Separation
- **Main** (`src/main/`): Node.js, file I/O, IPC handlers
- **Renderer** (`src/renderer/`): React UI, no Node access
- **Preload** (`src/preload/`): Secure bridge via contextBridge
- **Shared** (`src/shared/`): Types and IPC definitions

### IPC Pattern
All main/renderer communication goes through typed IPC channels defined in 
`src/shared/ipc.ts`. Never expose Node APIs to the renderer.

## Key Directories
| Directory | Purpose |
|-----------|---------|
| `src/main/handlers/` | IPC handler implementations |
| `src/main/operations/` | CRUD operations for data types |
| `src/renderer/src/tabs/` | Tab components (Personnel, Directory, etc.) |
| `src/renderer/src/hooks/` | React hooks for data access |
| `src/renderer/src/components/` | Reusable UI components |

## Commands
- `npm run dev` - Development with hot reload
- `npm run build` - Production build
- `npm run test:all` - Run all unit tests (REQUIRED before commits)
- `npm run test` - Playwright E2E tests
- `npm run lint` - ESLint check

## Code Patterns

### Adding IPC Handlers
1. Define channel and types in `src/shared/ipc.ts`
2. Implement handler in `src/main/handlers/`
3. Register in `src/main/ipcHandlers.ts`
4. Expose in preload via `BridgeAPI`

### Column Storage
Use utilities in `src/renderer/src/utils/columnStorage.ts` for persisting 
column widths/order. Never access localStorage directly.

### Validation
Use Zod for runtime validation of IPC inputs and external data.

### Virtual Lists
Use `react-window` + `AutoSizer` for lists with many items.

## Testing Requirements
- Run `npm run test:all` before committing
- Unit tests live alongside source files (`*.test.ts`)
- E2E tests in `tests/e2e/`

## Security Constraints
- No Node.js APIs in renderer (context isolation enforced)
- Validate all IPC inputs in main process
- CSP headers enforced
- Credentials stored securely, never in renderer state

## When to Check External Docs
Use `context7` for current documentation on:
- Electron APIs (especially IPC, BrowserWindow)
- gridstack (on-call board layout)
- @dnd-kit (drag-and-drop)
- Playwright/Vitest (testing)

Use `gh_grep` for real-world code examples when implementing unfamiliar patterns.
