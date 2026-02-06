# Development Guide

Patterns, conventions, and testing strategy for the Relay codebase.

## Table of Contents

- [Operations Pattern](#operations-pattern)
- [IPC and Validation](#ipc-and-validation)
- [File I/O and Locking](#file-io-and-locking)
- [Renderer Patterns](#renderer-patterns)
- [Testing](#testing)
- [Code Style](#code-style)

## Operations Pattern

Business logic lives in `src/main/operations/`, separated from IPC handlers. Each domain has its own module.

### Current Modules

| Module                  | File                         | Domain                                                               |
| ----------------------- | ---------------------------- | -------------------------------------------------------------------- |
| ContactJsonOperations   | `ContactJsonOperations.ts`   | Contact CRUD against `contacts.json`                                 |
| ServerJsonOperations    | `ServerJsonOperations.ts`    | Server CRUD against `servers.json`                                   |
| OnCallJsonOperations    | `OnCallJsonOperations.ts`    | On-call team CRUD, rename, reorder against `oncall.json`             |
| PresetOperations        | `PresetOperations.ts`        | Bridge group presets against `bridgeGroups.json`                     |
| BridgeHistoryOperations | `BridgeHistoryOperations.ts` | Bridge history log (auto-prunes entries older than 30 days, max 500) |
| NotesOperations         | `NotesOperations.ts`         | Contact and server notes with tags                                   |
| SavedLocationOperations | `SavedLocationOperations.ts` | Weather saved locations with default management                      |
| DataImportOperations    | `DataImportOperations.ts`    | CSV and JSON import with email/phone validation                      |
| DataExportOperations    | `DataExportOperations.ts`    | JSON and CSV export via Electron dialog                              |
| BackupOperations        | `BackupOperations.ts`        | Automatic backup creation                                            |

### Adding a New Operation

1. Create `src/main/operations/NewDomainOperations.ts`
2. Import `readWithLock` / `modifyJsonWithLock` from `../../fileLock`
3. Import `loggers` from `../../logger`
4. Import `generateId` from `./idUtils` if you need IDs
5. Export pure async functions that take a `dataRoot` path and input, return results
6. Add the module to `src/main/operations/index.ts`
7. Write tests in `src/main/operations/__tests__/NewDomainOperations.test.ts`
8. Wire into a handler in `src/main/handlers/`

```typescript
import { readWithLock, modifyJsonWithLock } from '../../fileLock';
import { loggers } from '../../logger';
import { generateId } from './idUtils';
import path from 'path';

const FILE = 'myDomain.json';

type MyRecord = { id: string; name: string; createdAt: number };

export async function getAll(dataRoot: string): Promise<MyRecord[]> {
  return readWithLock<MyRecord[]>(path.join(dataRoot, FILE), []);
}

export async function add(dataRoot: string, name: string): Promise<MyRecord> {
  const record: MyRecord = { id: generateId(), name, createdAt: Date.now() };
  await modifyJsonWithLock<MyRecord[]>(path.join(dataRoot, FILE), [], (current) => {
    return [...current, record];
  });
  loggers.fileManager.info('Record added', { id: record.id });
  return record;
}
```

### Why This Pattern?

- **Testable**: Operations can be unit tested by mocking `fileLock`, without Electron IPC
- **Reusable**: Same operation callable from handlers, maintenance tasks, or migration scripts
- **Atomic**: `modifyJsonWithLock` handles read-modify-write atomically with temp files

## IPC and Validation

All data crossing the main/renderer boundary is validated with Zod 4 schemas.

### Defining Channels

Channels are defined in `src/shared/ipc.ts` as the `IPC_CHANNELS` const object:

```typescript
export const IPC_CHANNELS = {
  GET_MY_RECORDS: 'myDomain:get',
  ADD_MY_RECORD: 'myDomain:add',
  // ...
} as const;
```

### Zod 4 Validation

Schemas are in `src/shared/ipcValidation.ts`. Key Zod 4 differences from Zod 3:

- Use `z.ZodType<T>` (not `z.ZodSchema<T>`)
- Error access: `.error.message` and `.error.issues` (not `.error.format()`)
- Import: `import { z } from 'zod'` (same)

```typescript
// Define schema
export const MyInputSchema = z.object({
  name: z.string().min(1).max(200),
});

// Use in handler
import { validateIpcDataSafe } from '../../shared/ipcValidation';

ipcMain.handle(IPC_CHANNELS.ADD_MY_RECORD, async (_, payload) => {
  const data = validateIpcDataSafe(MyInputSchema, payload, 'myDomain:add');
  if (!data) return { success: false, error: 'Invalid input' };
  const record = await add(dataRoot, data.name);
  return { success: true, data: record };
});
```

### Preload Bridge

After adding the handler, expose it in the preload:

1. Add the method signature to the `BridgeAPI` type in `src/shared/ipc.ts`
2. Implement in `src/preload/index.ts` using `ipcRenderer.invoke`

## File I/O and Locking

### Atomic Writes

All file mutations use `modifyJsonWithLock` from `src/main/fileLock.ts`:

1. Acquires an in-memory lock for the file path
2. Reads current file contents
3. Passes contents to your callback function
4. Writes callback return value to a temp file
5. Renames temp file over original (atomic on all platforms)
6. Releases lock

If the write fails, the temp file is cleaned up and the original is untouched.

### Read-Only Access

For reads, use `readWithLock` which acquires a shared lock and parses JSON:

```typescript
const contacts = await readWithLock<ContactRecord[]>(filePath, []);
// Second argument is the default value if the file doesn't exist
```

### File Watching

`FileWatcher.ts` uses chokidar to detect external file changes. When a watched file changes, `FileEmitter.ts` pushes updated data to all renderer windows via IPC. This enables live sync when files are edited externally or by another app instance.

### Data Cache

`DataCacheManager.ts` maintains an in-memory cache of parsed JSON data. The cache is invalidated when file changes are detected, avoiding redundant disk reads on each IPC call.

## Renderer Patterns

### Tab Architecture

Tabs use a "mount once, keep alive" pattern. Once a tab is visited, its component stays in the DOM (hidden via `display: none`) to preserve scroll position and state. Only the Compose tab is eagerly loaded; all others use `React.lazy` with `Suspense`.

### Hook-per-Domain

Each feature domain has a dedicated hook in `src/renderer/src/hooks/`:

| Hook                   | Tab     | Purpose                                     |
| ---------------------- | ------- | ------------------------------------------- |
| `useAssembler`         | Compose | Contact/group selection, draft bridge, copy |
| `useAppAssembler`      | Compose | Tab state, settings, cross-tab integration  |
| `useBridgeHistory`     | Compose | Bridge history CRUD                         |
| `useGroups`            | Compose | Group preset CRUD                           |
| `usePersonnel`         | On-Call | Team grid, alerts, reminders                |
| `useOnCallBoard`       | On-Call | Board interactions, clipboard, animations   |
| `useDirectory`         | People  | Search, pagination, tab state               |
| `useDirectoryContacts` | People  | Contact data, add/edit/delete               |
| `useDirectoryKeyboard` | People  | Keyboard navigation (arrows, context menu)  |
| `useServers`           | Servers | Server data, search, selection              |
| `useAppWeather`        | Weather | Weather data, alerts, location              |
| `useWeatherLocation`   | Weather | Location selection state                    |
| `useSavedLocations`    | Weather | Saved location CRUD                         |
| `useAIChat`            | AI      | Chat session management                     |
| `useAppData`           | Global  | Data loading, reload, sync                  |
| `useNotes`             | Global  | Contact/server notes                        |
| `useCommandSearch`     | Global  | Command palette search                      |
| `useDataManager`       | Global  | Import/export                               |
| `useDebounce`          | Utility | Debounced values                            |
| `useFocusTrap`         | Utility | Modal focus trapping                        |
| `useMounted`           | Utility | Mount state tracking                        |
| `useOnClickOutside`    | Utility | Click-outside detection                     |

### Virtual Lists

Large lists (contacts, servers, composition) use react-window v2 with AutoSizer v2:

```typescript
<AutoSizer
  renderProp={({ height, width }) => (
    <FixedSizeList
      height={height ?? 0}
      width={width ?? 0}
      itemCount={items.length}
      itemSize={ROW_HEIGHT}
    >
      {({ index, style }) => <Row key={index} style={style} />}
    </FixedSizeList>
  )}
/>
```

The `renderProp` pattern (not children-as-function) is required by AutoSizer v2. Always provide `?? 0` fallbacks for height/width.

### Drag and Drop

On-Call Board and sortable lists use @dnd-kit:

- `@dnd-kit/core` for `DndContext`, sensors, collision detection
- `@dnd-kit/sortable` for `SortableContext`, `useSortable`
- Custom `PointerSensor` with activation constraints for touch/click disambiguation

### Accessibility

eslint-plugin-jsx-a11y is enforced on all renderer code. Key rules:

- Clickable divs: `role="button"` + `tabIndex={0}` + `onKeyDown` (Enter/Space handler)
- Overlays/backdrops: `role="presentation"`
- Toggle items: `role="checkbox"` + `aria-checked`
- Menu containers: `role="menu"` + `tabIndex={-1}`
- Label-input pairs: `htmlFor`/`id` matching
- `jsx-a11y/no-autofocus` is disabled (modals use `useFocusTrap` intentionally)

### CSS Structure

Styles are in `src/renderer/src/styles/` — vanilla CSS with design tokens:

| File             | Purpose                                   |
| ---------------- | ----------------------------------------- |
| `theme.css`      | Color palette, spacing tokens, typography |
| `components.css` | Cards, buttons, inputs, sidebar           |
| `modals.css`     | Modal layouts and overlays                |
| `animations.css` | Keyframes and transitions                 |
| `responsive.css` | Breakpoints                               |
| `toast.css`      | Toast notifications                       |
| `utilities.css`  | Utility classes                           |
| `app-icon.css`   | App icon styling                          |

No CSS modules. No Tailwind. Components reference class names directly.

## Testing

### Two Test Suites

| Suite       | Config                      | Environment | Scope                                              |
| ----------- | --------------------------- | ----------- | -------------------------------------------------- |
| Main/Shared | `vitest.config.ts`          | Node        | `src/main/**/*.test.ts`, `src/shared/**/*.test.ts` |
| Renderer    | `vitest.renderer.config.ts` | jsdom       | `src/renderer/**/*.test.{ts,tsx}`                  |

```bash
npm test               # Both suites sequentially
npm run test:unit      # Main/shared only
npm run test:renderer  # Renderer only
npm run test:coverage  # Main/shared with coverage report
npm run test:electron  # Playwright E2E
```

### Coverage Thresholds

Enforced in both vitest configs — CI fails if coverage drops below:

| Suite       | Lines | Functions | Branches | Statements |
| ----------- | ----- | --------- | -------- | ---------- |
| Main/Shared | 52%   | 52%       | 38%      | 52%        |
| Renderer    | 78%   | 76%       | 67%      | 79%        |

### Testing Operations (Main Process)

Mock the file lock, logger, and ID generator:

```typescript
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { readWithLock, modifyJsonWithLock } from '../../fileLock';

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

describe('MyOperations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds a record', async () => {
    // Capture the modifyJsonWithLock callback and test it
    (modifyJsonWithLock as Mock).mockImplementation(async (_path, _default, callback) => {
      const result = callback([]); // Pass empty array as current data
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'test-id', name: 'Test' });
    });

    await add('/data', 'Test');
    expect(modifyJsonWithLock).toHaveBeenCalledOnce();
  });
});
```

### Testing Hooks (Renderer)

Hooks that use `useToast` need a toast provider wrapper:

```typescript
import { renderHook, act } from '@testing-library/react';
import { NoopToastProvider } from '../../components/Toast';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NoopToastProvider>{children}</NoopToastProvider>
);

it('loads data on mount', async () => {
  const mockApi = {
    getContacts: vi.fn().mockResolvedValue([{ id: '1', name: 'Alice' }]),
  };
  (window as Window & { api: typeof mockApi }).api = mockApi as unknown as Window['api'];

  const { result } = renderHook(() => useMyHook(), { wrapper });

  await act(async () => {});  // Flush promises
  expect(result.current.items).toHaveLength(1);
});
```

### Testing Components (Renderer)

Mock the Modal component to avoid portal issues:

```typescript
vi.mock('../../components/Modal', () => ({
  default: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div>{children}</div> : null,
}));
```

Renderer tests use `@testing-library/react` with `globals: true` in the vitest config. The setup file (`src/renderer/test/setup.ts`) imports `@testing-library/jest-dom` for DOM matchers.

### Test Quality Rules

- No tests that just check CSS classes or assert React internals
- No tautological assertions (e.g., sorting an array and comparing to itself)
- Use concrete expected values, not derived values
- Test behavior and outcomes, not implementation details

## Code Style

- **Strict TypeScript**: `strict: true`, `noUncheckedIndexedAccess: true`
- **No `any`**: `@typescript-eslint/no-explicit-any` is `error` in main/preload, `warn` in renderer
- **No `@ts-ignore`**: Zero tolerance for `@ts-ignore` or `@ts-expect-error`
- **Logging**: Use `loggers` object — never `console.log` in production code
- **Promises**: `no-floating-promises: error` and `no-misused-promises: error` enforced
- **Formatting**: Prettier with single quotes, trailing commas, 100 char width, 2 space indent
- **Pre-commit**: Husky runs lint-staged (eslint --fix + prettier --write) on every commit
