# Development Guide

Patterns, conventions, and testing strategy for the Relay codebase.

## Table of Contents

- [PocketBase Service Pattern](#pocketbase-service-pattern)
- [IPC and Validation](#ipc-and-validation)
- [PocketBase Data Access](#pocketbase-data-access)
- [Realtime Subscriptions](#realtime-subscriptions)
- [Offline Cache and Pending Changes](#offline-cache-and-pending-changes)
- [Renderer Patterns](#renderer-patterns)
- [Testing](#testing)
- [Code Style](#code-style)

## PocketBase Service Pattern

Data CRUD lives in `src/renderer/src/services/`, separated from UI hooks. Each domain has its own service module. Services call the PocketBase REST API directly — no IPC round-trip for data operations.

### Current Service Modules

| Module                 | File                        | Domain                                                  |
| ---------------------- | --------------------------- | ------------------------------------------------------- |
| PocketBase client      | `pocketbase.ts`             | Client init, auth, health check, error handling         |
| pbErrors               | `pbErrors.ts`               | PocketBase error type guards (e.g. 404 not-found check) |
| crudServiceFactory     | `crudServiceFactory.ts`     | Generic CRUD service factory (`createCrudService<T>`)   |
| contactService         | `contactService.ts`         | Contact CRUD                                            |
| serverService          | `serverService.ts`          | Server CRUD                                             |
| oncallService          | `oncallService.ts`          | On-call team CRUD and reorder                           |
| oncallDismissalService | `oncallDismissalService.ts` | On-call alert dismissal persistence                     |
| bridgeGroupService     | `bridgeGroupService.ts`     | Bridge group preset CRUD                                |
| bridgeHistoryService   | `bridgeHistoryService.ts`   | Bridge history log                                      |
| notesService           | `notesService.ts`           | Contact and server notes                                |
| standaloneNoteService  | `standaloneNoteService.ts`  | Standalone notepad CRUD and reorder                     |
| savedLocationService   | `savedLocationService.ts`   | Weather saved locations                                 |
| alertHistoryService    | `alertHistoryService.ts`    | Alert history log                                       |
| importExportService    | `importExportService.ts`    | CSV and JSON import/export                              |

### Adding a New Service

1. Create `src/renderer/src/services/newDomainService.ts`
2. Import `getPb`, `requireOnline`, `handleApiError` from `./pocketbase`
3. Export pure async functions; use `requireOnline()` before any write
4. Write tests in a `__tests__/` directory (mock the PB SDK — see [Testing PB Services](#testing-pb-services))
5. Create a hook in `src/renderer/src/hooks/useNewDomain.ts` that calls the service

```typescript
import { getPb, handleApiError, requireOnline } from './pocketbase';

export interface MyRecord {
  id: string;
  name: string;
  created: string;
  updated: string;
}

export type MyInput = Omit<MyRecord, 'id' | 'created' | 'updated'>;

export async function getAll(): Promise<MyRecord[]> {
  try {
    return await getPb().collection('myDomain').getFullList<MyRecord>({ sort: 'name' });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function add(data: MyInput): Promise<MyRecord> {
  requireOnline();
  try {
    return await getPb().collection('myDomain').create<MyRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function update(id: string, data: Partial<MyInput>): Promise<MyRecord> {
  requireOnline();
  try {
    return await getPb().collection('myDomain').update<MyRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function remove(id: string): Promise<void> {
  requireOnline();
  try {
    await getPb().collection('myDomain').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
```

### CRUD Service Factory

For new domains with standard CRUD operations, use `createCrudService<T>` from `crudServiceFactory.ts` to avoid boilerplate:

```typescript
import { createCrudService } from './crudServiceFactory';

export interface MyRecord {
  id: string;
  name: string;
  created: string;
  updated: string;
}

const crud = createCrudService<MyRecord>('my_collection');

export const addRecord = (data: Partial<MyRecord>) => crud.create(data);
export const updateRecord = (id: string, data: Partial<MyRecord>) => crud.update(id, data);
export const deleteRecord = (id: string) => crud.remove(id);
```

The factory provides `getAll`, `getOne`, `create`, `update`, and `remove` — all with proper `requireOnline()` guards and `handleApiError()` wrapping. `getOne` returns `null` on 404 instead of throwing (uses `isPbNotFoundError` from `pbErrors.ts`).

### Why This Pattern?

- **Testable**: Services can be unit tested by mocking the PB SDK, without Electron or IPC
- **No IPC overhead**: Renderer talks directly to PocketBase REST — one fewer round-trip
- **Consistent error handling**: `handleApiError` centralises offline detection; `requireOnline` gives clear errors before writes

## IPC and Validation

Data CRUD no longer uses IPC. IPC handlers remain for system-level operations: weather API proxy, window management, auth credential prompts, cloud status, location lookup, logging bridge, and initial setup/config.

All IPC messages are validated with Zod 4 schemas.

### Defining Channels

Channels are defined in `src/shared/ipc.ts` as the `IPC_CHANNELS` const object:

```typescript
export const IPC_CHANNELS = {
  MY_CHANNEL: 'myDomain:action',
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

ipcMain.handle(IPC_CHANNELS.MY_CHANNEL, async (_, payload) => {
  const data = validateIpcDataSafe(MyInputSchema, payload, 'myDomain:action');
  if (!data) return { success: false, error: 'Invalid input' };
  return doSomething(data);
});
```

### Preload Bridge

After adding a handler, expose it in the preload:

1. Add the method signature to the `BridgeAPI` type in `src/shared/ipc.ts`
2. Implement in `src/preload/index.ts` using `ipcRenderer.invoke`

## PocketBase Data Access

The PB client is initialised in the renderer at startup via `initPocketBase(url)` from `src/renderer/src/services/pocketbase.ts`. All service modules access it through `getPb()`.

### Filter Escaping

Always escape user-supplied values in PB filter strings:

```typescript
import { escapeFilter } from './pocketbase';

const result = await getPb()
  .collection('contacts')
  .getFirstListItem<ContactRecord>(`email="${escapeFilter(email)}"`);
```

Never interpolate user input directly into filter strings — this is equivalent to a SQL injection vector.

### Connection State

The PB client exposes a connection state machine: `connecting` → `online` → `offline` → `reconnecting`. Use `isOnline()` to check, or `requireOnline()` to throw immediately on writes when offline. `onConnectionStateChange(listener)` registers a callback for UI updates.

## Realtime Subscriptions

PocketBase supports realtime subscriptions over SSE. Use them to push collection changes to the UI without polling:

```typescript
// Subscribe to all changes in a collection
const unsub = await getPb()
  .collection('contacts')
  .subscribe('*', (e) => {
    if (e.action === 'create') addToList(e.record);
    if (e.action === 'update') updateInList(e.record);
    if (e.action === 'delete') removeFromList(e.record.id);
  });

// Unsubscribe on component unmount
return () => {
  unsub();
};
```

The `useCollection` hook in `src/renderer/src/hooks/useCollection.ts` provides a generic subscription wrapper. It fetches the full collection on mount, subscribes to realtime SSE events, maintains sort order via a parsed comparator, and falls back to the offline cache when the connection is lost. On reconnect, it automatically flushes pending offline writes and re-subscribes.

### useOptimisticList

When a hook needs to apply optimistic UI updates while receiving realtime pushes from `useCollection`, wrap the data with `useOptimisticList`:

```typescript
import { useOptimisticList } from './useOptimisticList';
import { useCollection } from './useCollection';

const { data: records } = useCollection<MyRecord>('my_collection', { sort: 'sortOrder' });
const { data, setData, startMutation, finishMutation } = useOptimisticList(records);

async function handleAdd(input: MyInput) {
  startMutation();
  setData((prev) => [optimisticRecord, ...prev]); // Optimistic update
  try {
    await addRecord(input);
  } finally {
    finishMutation(); // Releases lock — queued external updates apply
  }
}
```

While mutations are in-flight, external realtime updates are queued. Once all mutations settle, the queued data is applied. This prevents realtime SSE events from overwriting optimistic UI state.

## Offline Cache and Pending Changes

The main process maintains two local SQLite databases (via better-sqlite3) for offline resilience:

- **OfflineCache** (`src/main/cache/OfflineCache.ts`): Read-through cache of PB collections. Renderer reads from this via `window.api.cacheRead(collection)` when offline.
- **PendingChanges** (`src/main/cache/PendingChanges.ts`): Write queue for mutations that occurred while offline.
- **SyncManager** (`src/main/cache/SyncManager.ts`): On reconnect, replays the pending queue to PocketBase and resolves conflicts (last-write-wins, server takes precedence).

Cache updates are triggered via `window.api.cacheSnapshot(collection, records)` after a successful PB fetch. Pending writes are queued via `window.api.cacheWrite(collection, action, record)` when the renderer is offline.

### Cache Handler Validation

Cache handlers (`src/main/handlers/cacheHandlers.ts`) validate all inputs against allowlists before touching the database:

- **Collection allowlist**: A `VALID_COLLECTIONS` set restricts which collection names are accepted. Any unrecognised collection name is rejected and logged as an error.
- **Action allowlist**: A `VALID_ACTIONS` set (`create`, `update`, `delete`) validates mutation types.
- **Record shape check**: Write operations verify the record is a non-null, non-array object.

This prevents the renderer from reading or writing arbitrary collections through the cache IPC bridge.

## Renderer Patterns

### Tab Architecture

Tabs use a "mount once, keep alive" pattern. Once a tab is visited, its component stays in the DOM (hidden via `display: none`) to preserve scroll position and state. Only the Compose tab is eagerly loaded; all others use `React.lazy` with `Suspense`.

Current tabs: Compose, On-Call (Personnel), People (Directory), Servers, Weather, Radar, Alerts, Notes, Cloud Status.

### Hook-per-Domain

Each feature domain has a dedicated hook in `src/renderer/src/hooks/`:

| Hook                   | Tab          | Purpose                                           |
| ---------------------- | ------------ | ------------------------------------------------- |
| `useAssembler`         | Compose      | Contact/group selection, draft bridge, copy       |
| `useAppAssembler`      | Compose      | Tab state, settings, cross-tab integration        |
| `useBridgeHistory`     | Compose      | Bridge history CRUD                               |
| `useGroups`            | Compose      | Group preset CRUD                                 |
| `usePersonnel`         | On-Call      | Team grid, alerts, reminders                      |
| `useOnCallBoard`       | On-Call      | Board interactions, clipboard, animations         |
| `useOnCallManager`     | On-Call      | Team CRUD, rename, reorder                        |
| `useAlertDismissal`    | On-Call      | Daily alert dismissal with optimistic updates     |
| `useDirectory`         | People       | Search, pagination, tab state                     |
| `useDirectoryContacts` | People       | Contact data, add/edit/delete                     |
| `useDirectoryKeyboard` | People       | Keyboard navigation (arrows, context menu)        |
| `useServers`           | Servers      | Server data, search, selection                    |
| `useAppWeather`        | Weather      | Weather data, alerts, location                    |
| `useWeatherLocation`   | Weather      | Location selection state                          |
| `useSavedLocations`    | Weather      | Saved location CRUD                               |
| `useAlertHistory`      | Alerts       | Alert history CRUD with pin/label                 |
| `useNotepad`           | Notes        | Notepad state, font size, search integration      |
| `useNoteStorage`       | Notes        | Standalone note CRUD, reorder, optimistic queue   |
| `useAppCloudStatus`    | Cloud Status | Cloud provider status polling and aggregation     |
| `useAppData`           | Global       | Data loading, reload, sync                        |
| `useNotes`             | Global       | Contact/server entity notes                       |
| `useCommandSearch`     | Global       | Command palette search                            |
| `useDataManager`       | Global       | Import/export                                     |
| `useCollection`        | Global       | Generic PB realtime subscription wrapper          |
| `useOptimisticList`    | Global       | Optimistic list updates with queued external sync |
| `useHistory`           | Global       | Generic history hook for PB-backed collections    |
| `useListFilters`       | Global       | Filter definitions with predicate-based matching  |
| `usePolling`           | Global       | Generic polling loop                              |
| `usePocketBase`        | Global       | PB client init, auth, connection state            |
| `useKeyboardShortcuts` | Global       | Global keyboard shortcut bindings                 |
| `useDebounce`          | Utility      | Debounced values                                  |
| `useFocusTrap`         | Utility      | Modal focus trapping                              |
| `useModalState`        | Utility      | Open/close/toggle state for modals                |
| `useMounted`           | Utility      | Mount state tracking                              |
| `useOnClickOutside`    | Utility      | Click-outside detection                           |

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

For the full visual language, component patterns, and rules for adding new UI, see [DESIGN.md](DESIGN.md).

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
| Main/Shared | 80%   | 80%       | 80%      | 80%        |
| Renderer    | 80%   | 80%       | 80%      | 80%        |

### Testing PB Services

Mock the PocketBase SDK and the `pocketbase.ts` module:

```typescript
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { getPb, requireOnline, handleApiError } from '../pocketbase';
import { add, update, remove } from '../myDomainService';

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
  vi.clearAllMocks();
  (getPb as Mock).mockReturnValue({ collection: () => mockCollection });
});

describe('myDomainService', () => {
  it('creates a record', async () => {
    const record = { id: '1', name: 'Test', created: '', updated: '' };
    mockCollection.create.mockResolvedValue(record);

    const result = await add({ name: 'Test' });

    expect(requireOnline).toHaveBeenCalledOnce();
    expect(mockCollection.create).toHaveBeenCalledWith({ name: 'Test' });
    expect(result).toEqual(record);
  });

  it('calls handleApiError on network failure', async () => {
    const err = new Error('Network error');
    mockCollection.create.mockRejectedValue(err);

    await expect(add({ name: 'Test' })).rejects.toThrow('Network error');
    expect(handleApiError).toHaveBeenCalledWith(err);
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
  mockCollection.getFullList.mockResolvedValue([{ id: '1', name: 'Alice' }]);

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
