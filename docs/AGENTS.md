# Relay - Agent Guidelines

## Overview

Electron desktop app for operations teams. Manages contacts, servers, on-call schedules, bridge communications, weather monitoring, and AI chat from a single interface. All application data is stored in an embedded PocketBase instance (SQLite), replacing the previous JSON file storage.

## Tech Stack

- **Core**: Electron 40 + React 19 + TypeScript 5.9 (strict, `noUncheckedIndexedAccess`)
- **Build**: Vite 7 + electron-vite 5
- **Testing**: Vitest 4 (unit + renderer) + Playwright (E2E)
- **Validation**: Zod 4 (IPC schema validation)
- **State**: React Context + custom hooks (one hook per feature domain)
- **Styling**: Vanilla CSS (no CSS-in-JS, no CSS modules)
- **Virtualization**: react-window 2 + react-virtualized-auto-sizer 2
- **Drag & Drop**: @dnd-kit/core 6 + @dnd-kit/sortable 10
- **Database**: PocketBase (embedded SQLite, REST API)
- **Offline Storage**: better-sqlite3 (OfflineCache + PendingChanges)
- **Linting**: ESLint 9 (flat config) + eslint-plugin-jsx-a11y
- **Formatting**: Prettier 3
- **Git Hooks**: Husky 9 + lint-staged 16

## Architecture

### Process Separation

- **Main** (`src/main/`): Node.js — PocketBase lifecycle, auth, backup, sync, IPC handlers
- **Renderer** (`src/renderer/`): React UI — calls PocketBase REST API directly via service modules
- **Preload** (`src/preload/`): Secure bridge via `contextBridge` — exposes typed `window.api` for non-data IPC
- **Shared** (`src/shared/`): Types, IPC channel definitions, Zod schemas, phone utilities

### Business Logic

Data CRUD is handled entirely in the renderer via service modules in `src/renderer/src/services/`. Services call the PocketBase REST API directly using the PB SDK — no IPC round-trip for data operations.

The main process handles the PocketBase server lifecycle (`PocketBaseProcess`), config management (`AppConfig`), offline caching (`OfflineCache`, `PendingChanges`), conflict resolution on reconnect (`SyncManager`), and API-based backups (`BackupManager`).

IPC handlers remain for non-data operations: weather API proxy, cloud status polling, window management, auth credential prompts, location lookup, logging bridge, and setup/config.

### Data Flow

```
Renderer service -> getPb().collection('x').getList() -> PocketBase REST API -> SQLite
```

For offline resilience:

```
Renderer (offline) -> window.api.cacheRead(collection) -> OfflineCache (local SQLite)
On reconnect       -> SyncManager.syncAll(pendingChanges) -> PocketBase REST API
```

## Key Directories

| Directory                                | Purpose                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `src/main/handlers/`                     | IPC handler registration and Zod input validation                       |
| `src/main/pocketbase/`                   | PocketBase process management, backup, and retention                    |
| `src/main/cache/`                        | Offline cache (OfflineCache), write queue (PendingChanges), SyncManager |
| `src/main/config/`                       | AppConfig — reads/writes encrypted relay config                         |
| `src/main/migration/`                    | JsonMigrator — one-time migration from JSON files to PocketBase         |
| `src/renderer/src/services/`             | PocketBase service modules — all data CRUD (contacts, servers, etc.)    |
| `src/renderer/src/tabs/`                 | Tab components (Compose, On-Call, People, Servers, Weather, Radar, AI)  |
| `src/renderer/src/hooks/`                | Custom React hooks (one per feature domain)                             |
| `src/renderer/src/hooks/__tests__/`      | Hook unit tests                                                         |
| `src/renderer/src/components/`           | Reusable UI components (modals, cards, search, sidebar, toast)          |
| `src/renderer/src/components/__tests__/` | Component unit tests                                                    |
| `src/renderer/src/styles/`               | Global CSS (theme.css, components.css, modals.css, animations.css)      |
| `src/renderer/src/utils/`                | Renderer utilities (logger, secureStorage, timeParsing, colors)         |
| `src/renderer/src/contexts/`             | React context providers (LocationContext, NotesContext)                 |
| `src/shared/`                            | IPC types, channel definitions, Zod schemas, phone utilities            |

## Renderer Service Modules

| Module                    | Domain                                             |
| ------------------------- | -------------------------------------------------- |
| `pocketbase.ts`           | PB client init, auth, health check, error handling |
| `contactService.ts`       | Contact CRUD                                       |
| `serverService.ts`        | Server CRUD                                        |
| `oncallService.ts`        | On-call team CRUD and reorder                      |
| `oncallLayoutService.ts`  | On-call board layout persistence                   |
| `bridgeGroupService.ts`   | Bridge group preset CRUD                           |
| `bridgeHistoryService.ts` | Bridge history log                                 |
| `notesService.ts`         | Contact and server notes                           |
| `savedLocationService.ts` | Weather saved locations                            |
| `alertHistoryService.ts`  | Alert history log                                  |
| `importExportService.ts`  | CSV and JSON import/export                         |

## Handler Modules

| Module                | Domain                                           |
| --------------------- | ------------------------------------------------ |
| `authHandlers.ts`     | HTTP 401 interception, credential prompts        |
| `cacheHandlers.ts`    | Offline cache read/write, pending change sync    |
| `cloudStatus/`        | Cloud service status polling (Google, RSS, etc.) |
| `configHandlers.ts`   | App settings management                          |
| `locationHandlers.ts` | IP geolocation                                   |
| `loggerHandlers.ts`   | Renderer-to-main log bridge                      |
| `setupHandlers.ts`    | Initial setup — save/load relay config           |
| `weatherHandlers.ts`  | Weather API proxy                                |
| `windowHandlers.ts`   | Window management, clipboard, drag sync          |
| `ipcHelpers.ts`       | Shared handler utilities                         |

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

1. **Types**: Define TypeScript types in the relevant service file or `src/shared/ipc.ts` if IPC is needed
2. **Service**: Implement data CRUD in `src/renderer/src/services/NewDomainService.ts` using `getPb()`, `requireOnline()`, and `handleApiError()`
3. **Hook**: Create `src/renderer/src/hooks/useNewDomain.ts` that calls the service functions
4. **Component**: Build UI in `src/renderer/src/tabs/` or `src/renderer/src/components/`
5. **Tests**: Add unit tests for the service (mock PB SDK) and hook
6. **IPC (if needed)**: For non-data operations, add channel to `src/shared/ipc.ts`, handler in `src/main/handlers/`, and expose in `src/preload/index.ts`

## Code Patterns

### Logging

Use the structured logging system. Never use `console.log` in production code.

```typescript
// Main process
import { loggers } from '../logger';
loggers.main.info('PocketBase started', { port });
loggers.sync.warn('Sync conflict', { collection, id });
loggers.backup.error('Backup failed', { error: getErrorMessage(err) });

// Renderer
import { loggers } from '../utils/logger';
loggers.app.info('Tab switched', { tab });
```

Available loggers: `app`, `main`, `sync`, `backup`, `ipc`, `auth`, `weather`, `radar`.

### PocketBase Service Pattern

All data CRUD uses the PocketBase SDK in renderer service modules:

```typescript
import { getPb, handleApiError, requireOnline } from './pocketbase';

// Read (works offline via collection subscription or cache)
const records = await getPb().collection('myDomain').getFullList<MyRecord>();

// Write (requires online)
export async function addRecord(data: MyInput): Promise<MyRecord> {
  requireOnline();
  try {
    return await getPb().collection('myDomain').create<MyRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

// Update
export async function updateRecord(id: string, data: Partial<MyInput>): Promise<MyRecord> {
  requireOnline();
  try {
    return await getPb().collection('myDomain').update<MyRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

// Delete
export async function deleteRecord(id: string): Promise<void> {
  requireOnline();
  try {
    await getPb().collection('myDomain').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
```

### IPC Validation (Zod 4)

IPC is only used for non-data operations (weather, window, auth, etc.):

```typescript
import { z } from 'zod';
import { validateIpcDataSafe } from '../../shared/ipcValidation';

const MyInputSchema = z.object({
  name: z.string().min(1),
  count: z.number().int(),
});

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

### Mocking PocketBase SDK in Service Tests

```typescript
vi.mock('../pocketbase', () => ({
  getPb: vi.fn(),
  requireOnline: vi.fn(),
  handleApiError: vi.fn(),
}));

const mockCollection = {
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getFullList: vi.fn(),
};

beforeEach(() => {
  (getPb as Mock).mockReturnValue({ collection: () => mockCollection });
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
- **Filter Escaping**: Use `escapeFilter()` from `pocketbase.ts` for all PB filter values.
- **Sensitive Data**: Automatically sanitized from log output.
- **No `any`**: `@typescript-eslint/no-explicit-any` is `error` in main/preload, `warn` in renderer.
- **No `@ts-ignore`**: Zero `@ts-ignore` or `@ts-expect-error` directives in production code.

## Quality Gates

All of these must pass before merging:

- `npm run typecheck` — 0 TypeScript errors
- `npm run lint` — 0 ESLint errors (includes jsx-a11y)
- `npm test` — all tests pass (unit + renderer)
- Coverage thresholds enforced (main: 80/80/75/80, renderer: 80/80/75/80)
- Pre-commit hooks run automatically (eslint --fix + prettier --write)

## Documentation

- [Architecture](architecture.md) — system design, data handling, IPC contracts, security
- [Development Guide](DEVELOPMENT.md) — coding patterns, testing, code style
- [Logging Guide](LOGGING.md) — logger usage, file locations, configuration
- [Logging Examples](LOGGING_EXAMPLES.ts) — annotated code patterns
