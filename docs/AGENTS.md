# Relay - Agent Guidelines

## Overview
Electron desktop app for operations teams. Manages on-call schedules, contacts, 
servers, and weather monitoring.

## Tech Stack
- **Core**: Electron 34 + React 18 + TypeScript 5.9
- **Build**: Vite + electron-vite
- **Testing**: Vitest (unit) + Playwright (E2E)
- **State**: React Context + Hooks
- **Styling**: CSS Modules / Vanilla CSS (Matte Dark theme)

## Architecture

### Process Separation
- **Main** (`src/main/`): Node.js, business logic, file I/O, IPC handlers.
- **Renderer** (`src/renderer/`): React UI, no Node access.
- **Preload** (`src/preload/`): Secure bridge via `contextBridge`.
- **Shared** (`src/shared/`): Types and IPC definitions.

### Business Logic
Business logic is centralized in **Operations** modules (`src/main/operations/`) rather than inside IPC handlers. This promotes testability and reusability.

## Key Directories
| Directory | Purpose |
|-----------|---------|
| `src/main/handlers/` | IPC handler registration and input validation |
| `src/main/operations/` | Core business logic (pure functions/classes) |
| `src/renderer/src/tabs/` | Main application tabs (Compose, People, etc.) |
| `src/renderer/src/hooks/` | React hooks for data access and state |
| `src/renderer/src/components/` | Reusable UI components |
| `src/renderer/src/utils/` | Renderer utilities (Logger, Column Storage) |

## Commands
- `npm run dev` - Development with hot reload
- `npm run build` - Production build
- `npm run test:unit` - Run unit tests (Vitest)
- `npm run test` - Run E2E tests (Playwright)
- `npm run typecheck` - TypeScript validation

## Code Patterns

### Logging
Always use the structured logging system defined in `docs/LOGGING.md`.
```typescript
import { loggers } from './utils/logger'; // or src/main/logger
loggers.app.info('Action performed', { details });
```

### Adding Features
1. **Shared**: Define types and IPC channels in `src/shared/ipc.ts`.
2. **Operations**: Implement logic in `src/main/operations/`.
3. **Handlers**: Expose via IPC in `src/main/handlers/`.
4. **Preload**: Add to `BridgeAPI` in `src/preload/index.ts`.
5. **Renderer**: Create hook in `src/renderer/src/hooks/` and component.

### Data Validation
Use Zod schemas (`src/shared/ipcValidation.ts`) for all data entering the Main process.

## Security Constraints
- **Context Isolation**: Enforced. No Node.js APIs in renderer.
- **Content Security Policy**: Strict CSP applied to all windows.
- **Credentials**: Never store secrets in the Renderer. Use `safeStorage` in Main.

## Autonomous Vibe Protocol

You are an autonomous senior engineer. Your goal is to complete tasks with zero manual input from the user. You have 7 specialized MCP servers; use them according to these rules:

### 1. Research & Context (zai, context7, grep-local)
- **Before writing any code**, you MUST use `grep-local` to map the codebase and `zai` or `context7` to fetch the latest documentation for any third-party libraries mentioned in the task. 
- Do not guess API signatures. Read the docs first.

### 2. Implementation (filesystem, github)
- Use `filesystem` to implement changes. 
- If the task is a new feature or a bug fix, automatically use the `github` server to commit your changes to the `test` branch and open a Pull Request when finished. 
- Do not ask for permission to commit; do it as part of your "Done" definition.

### 3. Verification (playwright, grep-github)
- For UI changes, you MUST use `playwright` to "see" the result and verify there are no visual regressions.
- If you encounter an error you don't understand, use `grep-github` (Vercel Grep) to search public repositories for how others solved the same issue.

### 4. Operational Style
- **Plan Mode:** Use `zai` and `grep-local` to build a bulletproof plan.
- **Build Mode:** Execute the plan. If a tool fails, use `zai` to diagnose and try a different approach. Only alert the user if you are fundamentally blocked by a lack of API keys or environment secrets.

## Documentation
- `docs/ARCHITECTURE.md`: System design and tab behaviors.
- `docs/DEVELOPMENT.md`: Coding standards and patterns.
- `docs/LOGGING.md`: Logging system guide.

Use `gh_grep` or `glob` to find examples when implementing new features.
