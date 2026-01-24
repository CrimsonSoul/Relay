# Operators Atelier architecture

This document captures deeper implementation guidance for the Electron + Vite desktop app, focusing on data handling, IPC contracts, UI tab behaviors, authentication flows, and test coverage.

## Environment and setup
- **Stack**: Electron 34 + React 18 + TypeScript 5.9.
- **Build**: Vite + electron-vite.
- **Development**: `npm run dev` starts Vite in watch mode and boots Electron with hot reload. Keep the console open to monitor main-process logs.
- **Production build**: `npm run build` outputs bundled renderer assets and packages an Electron binary. Run the packaged app to verify IPC wiring outside the dev server.
- **Linting/formatting**: Adopt project defaults (e.g., ESLint/Prettier) to keep main/renderer code style consistent.

## Styling philosophy: Analog Precision
- **Typography & scale**: Use readable sans-serif faces with strict spacing increments (4/8 px). Emphasize labels and numeric readouts.
- **Color**: Prefer muted neutrals for backgrounds, with sparing use of accent colors for alerts and primary actions. Avoid gradients; use solid fills and 1 px keylines for separation.
- **Components**: Buttons and toggles should feel "instrumented"—clear borders, high-contrast focus states, minimal radius. Avoid excessive shadows; rely on consistent elevation tokens.
- **Motion**: Animations should be short (<150 ms) and driven by state change significance (e.g., confirming an action). No looping or decorative motion.

## Data Handling & Persistence
Relay uses a local-first architecture with JSON-based storage for high performance and privacy.

- **Data Root**: Data is stored in the user's data directory (configurable).
- **JSON Storage**: Contacts, servers, on-call schedules, and groups are stored in dedicated JSON files (e.g., `contacts.json`, `servers.json`).
- **Legacy CSV**: Support for importing legacy CSV files (`contacts.csv`, `servers.csv`) is maintained, with migration tools available.
- **Atomic Writes**: All file writes are atomic (using temporary files and rename) to prevent data corruption.
- **Backups**: Automatic backups are created during critical operations (migrations, bulk imports).

## Business Logic Layer (`src/main/operations`)
To maintain clean separation of concerns, business logic is decoupled from IPC handlers and placed in `src/main/operations`.

- **Modular Design**: Each domain (Contacts, Servers, On-Call) has its own operation modules (e.g., `ContactJsonOperations.ts`, `ServerOperations.ts`).
- **Testability**: Operations are pure functions or classes that can be unit tested without mocking Electron IPC.
- **Reusability**: Operations can be called by multiple IPC handlers or internal maintenance tasks.

## IPC API (main ↔ renderer)
- **Principles**: Narrow, declarative channels; validate payloads; never expose `remote` or Node globals to the renderer.
- **Structure**: Handlers are organized by domain in `src/main/handlers/`.
- **Validation**: All IPC inputs are validated using Zod schemas (`src/shared/ipcValidation.ts`) before processing.

### Key Channels
- **Data Records**: CRUD operations for contacts, servers, etc. (e.g., `data:addContact`, `data:getServers`).
- **Configuration**: App settings and paths (e.g., `config:getDataPath`).
- **Weather/Location**: External API proxies (e.g., `weather:get`).
- **Logging**: Telemetry from renderer (e.g., `logger:toMain`).

## Tab behaviors
- **Compose (Assembler)**: Build and manage communication bridges. Select contacts/groups and "Draft Bridge" to initiate actions.
- **On-Call (Personnel)**: visual grid of on-call teams. Drag-and-drop reordering, team management, and shift assignments.
- **People (Directory)**: Searchable list of all contacts. Add, edit, or delete personnel.
- **Servers**: Server infrastructure monitoring list with status indicators.
- **Weather**: Dashboard for environmental awareness. Supports multiple locations and severe weather alerts.
- **Radar**: Real-time weather radar visualization.
- **AI Chat**: Sandboxed interface for AI assistants (Gemini, ChatGPT) with privacy controls (auto-clear on exit).

## Authentication & Security
- **Credential Management**: Sensitive credentials (proxies, API keys) are stored using Electron's `safeStorage` API.
- **Interception**: `authHandlers.ts` intercepts HTTP 401 challenges and prompts the user via the renderer, securely caching the result.
- **Context Isolation**: Enabled for all renderer windows. No direct Node.js access.
- **CSP**: Strict Content Security Policy enforced.

## Testing strategy
- **Unit tests (Vitest)**:
  - Located alongside source files (`*.test.ts`) or in `__tests__` directories.
  - Cover operations, utility functions, and validation logic.
- **Integration tests**:
  - Test IPC handlers and complex workflows.
- **E2E tests (Playwright)**:
  - Located in `tests/e2e/`.
  - Verify critical user paths (startup, navigation, CRUD) on the packaged application.
  - Use `await expect(...).toBeVisible()` patterns for reliability (avoid hardcoded waits).

## Implementation notes
- Keep a shared `types` module for IPC payloads to reduce drift between main and renderer.
- Prefer reactive streams (e.g., RxJS or simple EventEmitter) in the main process to manage watcher events and backpressure.
- Log with structured messages (JSON) to make it easy to pipe into external observability tools during ops shifts.
