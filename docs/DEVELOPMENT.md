# Development Guide

This guide covers best practices and patterns for developing Relay.

## Table of Contents

- [Business Logic & Operations](#business-logic--operations)
- [IPC & Validation](#ipc--validation)
- [Column Storage Patterns](#column-storage-patterns)
- [Testing](#testing)

## Business Logic & Operations

Relay uses an "Operations" pattern to organize business logic in the main process. This separates the *how* (file I/O, data manipulation) from the *interface* (IPC handlers).

### Adding New Operations

1.  **Create Module**: Create a new file in `src/main/operations/` (e.g., `MyDomainOperations.ts`).
2.  **Define Functions**: Export pure async functions for your logic.
    ```typescript
    export async function doSomething(dataRoot: string, input: InputType): Promise<ResultType> {
      // Validation
      // File I/O
      // Return result
    }
    ```
3.  **Export**: Add the new file to `src/main/operations/index.ts`.
4.  **Use in Handler**: Import the operation in your IPC handler (`src/main/handlers/`).

### Why this pattern?
- **Testability**: You can unit test `doSomething` without mocking the entire Electron IPC event structure.
- **Reusability**: The same operation can be used by an IPC call, a scheduled task, or a migration script.

## IPC & Validation

All data crossing the bridge between the Main and Renderer processes must be validated.

### Using Zod schemas

Defined in `src/shared/ipcValidation.ts`.

```typescript
// Define Schema
export const MyInputSchema = z.object({
  name: z.string().min(1),
  count: z.number().int()
});

// In Main Process Handler
import { validateIpcDataSafe } from '../../shared/ipcValidation';

ipcMain.handle('my-channel', (_, payload) => {
  const data = validateIpcDataSafe(MyInputSchema, payload, 'my-channel');
  if (!data) return { success: false, error: 'Invalid input' };
  
  // Proceed...
});
```

## Column Storage Patterns

### Overview

Column configurations (widths and order) are persisted to `localStorage` to maintain user preferences across sessions. We use shared utilities to handle this safely and consistently.

### Using Column Storage Utilities

Located in `src/renderer/src/utils/columnStorage.ts`:

```typescript
import {
  loadColumnWidths,
  saveColumnWidths,
  loadColumnOrder,
  saveColumnOrder
} from '../utils/columnStorage';
```

### Best Practices

#### 1. Always Use Shared Utilities

**DO:**
```typescript
const [baseWidths, setBaseWidths] = useState(() =>
  loadColumnWidths({
    storageKey: 'relay-servers-columns',
    defaults: DEFAULT_WIDTHS
  })
);
```

**DON'T:** Access `localStorage` directly.

#### 2. Save with Utilities

**DO:**
```typescript
saveColumnWidths('relay-servers-columns', newWidths);
```

## Testing

### Unit Tests (Vitest)

We use Vitest for unit testing. Tests should act as "executable documentation" for your code.

- **Location**: Next to the source file (e.g., `MyComponent.test.tsx`) or in `__tests__` folder.
- **Running**: `npm run test:unit`
- **Coverage**: `npm run test:coverage`

### End-to-End Tests (Playwright)

We use Playwright to test the full application flow.

- **Location**: `tests/e2e/`
- **Running**: `npm run test`
- **Best Practice**: Avoid `waitForTimeout`. Use event-driven assertions:
  ```typescript
  // ✅ Good
  await expect(page.locator('.success-toast')).toBeVisible();
  
  // ❌ Bad
  await page.waitForTimeout(1000);
  ```

## Code Style

- **Strict Mode**: TypeScript strict mode is enabled.
- **No `any`**: Avoid `any` types. Define interfaces in `src/shared/types.ts` or local types.
- **Logging**: Use the global `loggers` object (see `docs/LOGGING.md`) instead of `console.log`.

## Common Patterns

### Virtual Lists
Use `react-window` + `AutoSizer` for efficient rendering of large lists (Contacts, Servers).

### Drag and Drop
Use `@dnd-kit` for all drag-and-drop interactions (e.g., On-Call board, column reordering).

## Questions?

If you have questions about development patterns, please:

1. Check existing code for similar examples.
2. Review this guide and inline comments.
3. Open a GitHub issue for clarification.
