# Relay - Agent Guidelines

## Overview

Electron desktop app for operations teams. Manages contacts, servers, on-call schedules, bridge communications, weather monitoring, and AI chat from a single interface. All data is stored locally as JSON files.

## Tech Stack

- **Core**: Electron 40 + React 19 + TypeScript 5.9 (strict, `noUncheckedIndexedAccess`)
- **Build**: Vite 7 + electron-vite 5
- **Testing**: Vitest 4 (unit + renderer) + Playwright (E2E)
- **Validation**: Zod 4 (IPC schema validation)
- **State**: React Context + custom hooks (one hook per feature domain)
- **Styling**: Vanilla CSS (no CSS-in-JS, no CSS modules)
- **Virtualization**: react-window 2 + react-virtualized-auto-sizer 2
- **Drag & Drop**: @dnd-kit/core 6 + @dnd-kit/sortable 10
- **File Watching**: Chokidar 5
- **Linting**: ESLint 9 (flat config) + eslint-plugin-jsx-a11y
- **Formatting**: Prettier 3
- **Git Hooks**: Husky 9 + lint-staged 16

## Architecture

### Process Separation

- **Main** (`src/main/`): Node.js — business logic, file I/O, IPC handlers
- **Renderer** (`src/renderer/`): React UI — no Node.js access
- **Preload** (`src/preload/`): Secure bridge via `contextBridge` — exposes typed `window.api`
- **Shared** (`src/shared/`): Types, IPC channel definitions, Zod schemas, phone utilities

### Business Logic

All business logic lives in **Operations** modules (`src/main/operations/`), not in IPC handlers. Handlers validate input and delegate to operations. Operations use `readWithLock` / `modifyJsonWithLock` from `src/main/fileLock.ts` for atomic file access.

### Data Flow

```
Renderer hook -> window.api.method() -> IPC channel -> Handler (validates with Zod)
  -> Operation (reads/writes JSON via fileLock) -> Handler returns result -> Hook updates state
```

External file changes are detected by `FileWatcher` (chokidar) -> `FileEmitter` -> renderer via IPC push.

## Key Directories

| Directory                                | Purpose                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `src/main/handlers/`                     | IPC handler registration and Zod input validation                      |
| `src/main/operations/`                   | Core business logic (pure functions, file I/O via fileLock)            |
| `src/main/operations/__tests__/`         | Operation unit tests                                                   |
| `src/renderer/src/tabs/`                 | Tab components (Compose, On-Call, People, Servers, Weather, Radar, AI) |
| `src/renderer/src/hooks/`                | Custom React hooks (22 hooks, one per feature domain)                  |
| `src/renderer/src/hooks/__tests__/`      | Hook unit tests                                                        |
| `src/renderer/src/components/`           | Reusable UI components (modals, cards, search, sidebar, toast)         |
| `src/renderer/src/components/__tests__/` | Component unit tests                                                   |
| `src/renderer/src/styles/`               | Global CSS (theme.css, components.css, modals.css, animations.css)     |
| `src/renderer/src/utils/`                | Renderer utilities (logger, secureStorage, timeParsing, colors)        |
| `src/renderer/src/contexts/`             | React context providers (LocationContext, NotesContext)                |
| `src/shared/`                            | IPC types, channel definitions, Zod schemas, phone utilities           |

## Operations Modules

| Module                       | Domain                                           |
| ---------------------------- | ------------------------------------------------ |
| `ContactJsonOperations.ts`   | Contact CRUD (contacts.json)                     |
| `ServerJsonOperations.ts`    | Server CRUD (servers.json)                       |
| `OnCallJsonOperations.ts`    | On-call team CRUD, rename, reorder (oncall.json) |
| `PresetOperations.ts`        | Bridge group presets (bridgeGroups.json)         |
| `BridgeHistoryOperations.ts` | Bridge history log                               |
| `NotesOperations.ts`         | Contact and server notes                         |
| `SavedLocationOperations.ts` | Weather saved locations                          |
| `DataImportOperations.ts`    | CSV and JSON import with validation              |
| `DataExportOperations.ts`    | JSON and CSV export                              |
| `BackupOperations.ts`        | Automatic backups                                |
| `FileContext.ts`             | Shared JSON file name constants                  |
| `idUtils.ts`                 | ID generation                                    |

## Handler Modules

| Module                  | Domain                                           |
| ----------------------- | ------------------------------------------------ |
| `authHandlers.ts`       | HTTP 401 interception, credential prompts        |
| `configHandlers.ts`     | App settings, data folder management             |
| `dataHandlers.ts`       | Data lifecycle (load, reload, subscribe)         |
| `dataRecordHandlers.ts` | CRUD for contacts, servers, on-call records      |
| `featureHandlers.ts`    | Groups, history, notes, locations, import/export |
| `fileHandlers.ts`       | File open, external URLs                         |
| `locationHandlers.ts`   | IP geolocation                                   |
| `loggerHandlers.ts`     | Renderer-to-main log bridge                      |
| `weatherHandlers.ts`    | Weather API proxy                                |
| `windowHandlers.ts`     | Window management, clipboard, drag sync          |
| `ipcHelpers.ts`         | Shared handler utilities                         |

## Commands

| Command                 | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `npm run dev`           | Development with hot reload                    |
| `npm run build`         | Production build                               |
| `npm run build:mac`     | macOS DMG (arm64 + x64)                        |
| `npm run build:win`     | Windows portable .exe (x64)                    |
| `npm run typecheck`     | TypeScript validation (`tsc --noEmit`)         |
| `npm run lint`          | ESLint check                                   |
| `npm run lint:fix`      | ESLint auto-fix                                |
| `npm test`              | Run all tests (unit + renderer)                |
| `npm run test:unit`     | Main process + shared tests (Vitest, Node env) |
| `npm run test:renderer` | Renderer tests (Vitest, jsdom env)             |
| `npm run test:coverage` | Unit tests with coverage report                |
| `npm run test:electron` | E2E tests (Playwright + Electron)              |
| `npm run format`        | Prettier format all                            |
| `npm run format:check`  | Prettier check                                 |

## Adding a New Feature

Follow this order — each step depends on the previous:

1. **Types**: Define types and IPC channel in `src/shared/ipc.ts`
2. **Validation**: Add Zod schema in `src/shared/ipcValidation.ts`
3. **Operation**: Implement logic in `src/main/operations/NewDomainOperations.ts`
4. **Handler**: Register IPC handler in `src/main/handlers/` (validate input, delegate to operation)
5. **Preload**: Add method to `BridgeAPI` type in `src/shared/ipc.ts`, expose in `src/preload/index.ts`
6. **Hook**: Create `src/renderer/src/hooks/useNewDomain.ts` that calls `window.api.method()`
7. **Component**: Build UI in `src/renderer/src/tabs/` or `src/renderer/src/components/`
8. **Tests**: Add unit tests for operation, hook, and component

## Code Patterns

### Logging

Use the structured logging system. Never use `console.log` in production code.

```typescript
// Main process
import { loggers } from '../logger';
loggers.fileManager.info('File saved', { path });
loggers.fileManager.warn('Validation failed', { reason });
loggers.fileManager.error('Write failed', { error: getErrorMessage(err) });

// Renderer
import { loggers } from '../utils/logger';
loggers.app.info('Tab switched', { tab });
```

Available loggers: `app`, `fileManager`, `ipc`, `auth`, `weather`, `radar`.

### File Operations

All JSON reads and writes go through the file lock to prevent corruption:

```typescript
import { readWithLock, modifyJsonWithLock } from '../../fileLock';

// Read
const data = await readWithLock<MyType[]>(filePath, []);

// Read-modify-write (atomic)
await modifyJsonWithLock<MyType[]>(filePath, [], (current) => {
  return [...current, newItem];
});
```

### IPC Validation (Zod 4)

```typescript
import { z } from 'zod';

// Define schema (Zod 4 syntax)
const MyInputSchema = z.object({
  name: z.string().min(1),
  count: z.number().int(),
});

// Validate in handler
import { validateIpcDataSafe } from '../../shared/ipcValidation';

ipcMain.handle('my-channel', (_, payload) => {
  const data = validateIpcDataSafe(MyInputSchema, payload, 'my-channel');
  if (!data) return { success: false, error: 'Invalid input' };
  return myOperation(data);
});
```

Note: Zod 4 uses `.error.message` and `.error.issues` (not `.error.format()` from Zod 3).

### Virtual Lists (react-window v2)

Use the `renderProp` pattern (not children-as-function):

```typescript
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList } from 'react-window';

<AutoSizer
  renderProp={({ height, width }) => (
    <FixedSizeList
      height={height ?? 0}
      width={width ?? 0}
      itemCount={items.length}
      itemSize={ROW_HEIGHT}
    >
      {({ index, style }) => <Row key={index} style={style} item={items[index]} />}
    </FixedSizeList>
  )}
/>
```

### Accessibility

eslint-plugin-jsx-a11y is enforced on all renderer code. Rules:

- Clickable `<div>` elements need `role="button"`, `tabIndex={0}`, and `onKeyDown` (Enter/Space)
- Overlay/backdrop elements need `role="presentation"`
- Label-input pairs need `htmlFor`/`id`
- `role="menu"` containers need `tabIndex={-1}`
- `jsx-a11y/no-autofocus` is disabled (intentional for modals with `useFocusTrap`)

### Hooks with Toast

Hooks that call `useToast()` need a `ToastProvider` in tests. Use the noop variant:

```typescript
import { NoopToastProvider } from '../../components/Toast';

const wrapper = ({ children }) => <NoopToastProvider>{children}</NoopToastProvider>;
const { result } = renderHook(() => useMyHook(), { wrapper });
```

### Mocking `window.api` in Renderer Tests

```typescript
const mockApi = {
  getContacts: vi.fn().mockResolvedValue([]),
  // ... other methods
};

beforeEach(() => {
  (window as Window & { api: typeof mockApi }).api = mockApi as unknown as Window['api'];
});
```

### Mocking File Operations in Operation Tests

```typescript
vi.mock('../../fileLock', () => ({
  readWithLock: vi.fn(),
  modifyJsonWithLock: vi.fn(),
}));
vi.mock('../../logger', () => ({
  loggers: { fileManager: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));
vi.mock('./idUtils', () => ({
  generateId: vi.fn(() => 'test-id'),
}));

// For modifyJsonWithLock: capture the callback and test it
(modifyJsonWithLock as Mock).mockImplementation(async (_path, _default, callback) => {
  return callback(existingData);
});
```

### Modal Component Tests

Mock the `Modal` component to avoid portal issues in jsdom:

```typescript
vi.mock('../../components/Modal', () => ({
  default: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div>{children}</div> : null,
}));
```

## Security Constraints

- **Context Isolation**: Enforced. Renderer has zero Node.js access.
- **Content Security Policy**: Strict CSP on all windows.
- **Webviews**: Creation locked to HTTPS allowlist. Navigation and `window.open()` blocked.
- **Credentials**: Use Electron's `safeStorage` in main process. Never store secrets in renderer.
- **Path Validation**: All file paths validated against traversal attacks (`src/main/pathValidation.ts`).
- **Sensitive Data**: Automatically sanitized from log output.
- **No `any`**: `@typescript-eslint/no-explicit-any` is `error` in main/preload, `warn` in renderer.
- **No `@ts-ignore`**: Zero `@ts-ignore` or `@ts-expect-error` directives in production code.

## Quality Gates

All of these must pass before merging:

- `npm run typecheck` — 0 TypeScript errors
- `npm run lint` — 0 ESLint errors (includes jsx-a11y)
- `npm test` — all tests pass (unit + renderer)
- Coverage thresholds enforced (main: 52/52/38/52, renderer: 78/76/67/79)
- Pre-commit hooks run automatically (eslint --fix + prettier --write)

## Documentation

- [Architecture](architecture.md) — system design, data handling, IPC contracts, security
- [Development Guide](DEVELOPMENT.md) — coding patterns, testing, code style
- [Logging Guide](LOGGING.md) — logger usage, file locations, configuration
- [Logging Examples](LOGGING_EXAMPLES.ts) — annotated code patterns
