# Development Guide

This guide covers best practices and patterns for developing Relay.

## Table of Contents

- [Column Storage Patterns](#column-storage-patterns)
- [Schema Changes](#schema-changes)
- [Testing](#testing)

## Column Storage Patterns

### Overview

Column configurations (widths and order) are persisted to `localStorage` to maintain user preferences across sessions. We use shared utilities to handle this safely and consistently.

### Using Column Storage Utilities

Located in `src/renderer/src/utils/columnStorage.ts`, these utilities provide validated loading and saving of column configurations:

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

const [columnOrder, setColumnOrder] = useState(() =>
  loadColumnOrder({
    storageKey: 'relay-servers-order',
    defaults: DEFAULT_ORDER
  })
);
```

**DON'T:**
```typescript
// Don't access localStorage directly
const [baseWidths, setBaseWidths] = useState(() => {
  const saved = localStorage.getItem('relay-servers-columns');
  return saved ? JSON.parse(saved) : DEFAULT_WIDTHS;
});
```

#### 2. Save with Utilities

**DO:**
```typescript
const newWidths = { ...baseWidths, [key]: newValue };
setBaseWidths(newWidths);
saveColumnWidths('relay-servers-columns', newWidths);
```

**DON'T:**
```typescript
// Don't save directly to localStorage
localStorage.setItem('relay-servers-columns', JSON.stringify(newWidths));
```

### Why These Utilities?

The column storage utilities provide critical validation:

1. **Stale Key Filtering**: Removes keys that no longer exist in the current schema
2. **Default Fallback**: Returns defaults when validation fails
3. **Type Safety**: Ensures loaded data matches expected types
4. **Error Handling**: Gracefully handles corrupt localStorage data

This prevents issues when:
- Column identifiers are renamed (e.g., `osType` → `os`)
- Columns are added or removed
- Users have old localStorage data from previous versions

## Schema Changes

### Renaming Column Identifiers

When renaming a column identifier (the key used in `DEFAULT_WIDTHS`):

1. **Update the Interface**: Change the property name in the type/interface
2. **Update DEFAULT_WIDTHS**: Change the key name
3. **Update DEFAULT_ORDER**: Change the key name in the array
4. **Update Formatters/Renderers**: Update any functions that reference the column

The column storage utilities will automatically handle stale localStorage data.

**Example:**
```typescript
// Before
const DEFAULT_WIDTHS = {
  osType: 100,  // old name
  // ...
};

// After
const DEFAULT_WIDTHS = {
  os: 100,  // new name
  // ...
};
```

Users with `osType` in their localStorage will automatically fall back to defaults.

### Adding New Columns

1. Add the new property to the interface
2. Add the new column to `DEFAULT_WIDTHS`
3. Add the new column to `DEFAULT_ORDER`
4. Add rendering logic for the new column

The utilities will automatically merge the new column with existing localStorage data.

### Removing Columns

1. Remove from the interface
2. Remove from `DEFAULT_WIDTHS`
3. Remove from `DEFAULT_ORDER`
4. Remove rendering logic

The utilities will automatically filter out the removed column from localStorage.

### Migration for Complex Changes

For complex schema migrations, you can:

1. **Change the storage key**: Use a new localStorage key (e.g., `relay-servers-columns-v2`)
2. **Clear old data**: Use `clearColumnStorage()` to remove outdated keys
3. **Transform data**: Load old data, transform it, save to new key

```typescript
import { clearColumnStorage } from '../utils/columnStorage';

// In migration code (e.g., useEffect on mount)
clearColumnStorage('relay-servers-columns-v1', 'relay-servers-order-v1');
```

## Testing

### Column Storage Tests

Tests for column storage utilities are in `src/renderer/src/utils/columnStorage.test.ts`.

Run tests:
```bash
npm test
```

Run specific test file:
```bash
npm test -- columnStorage.test.ts
```

### Adding Tests for New Tabs

When adding column storage to a new tab:

1. Write unit tests for the utilities (if adding new functionality)
2. Manually test:
   - Column resizing persists across page refreshes
   - Column reordering persists across page refreshes
   - Renaming a column identifier doesn't break for existing users
   - Invalid localStorage data falls back to defaults

## Header Matching for CSV Import

### Column Aliases

When importing CSV files, header names are matched using priority-ordered aliases defined in `src/main/FileManager.ts`:

- `SERVER_COLUMN_ALIASES`: Maps server column identifiers to possible CSV header names
- `CONTACT_COLUMN_ALIASES`: Maps contact column identifiers to possible CSV header names

### Priority Order Matters

The order of aliases is significant. When a CSV has multiple headers that could match (e.g., both "OS Type" and "OS"), the **first matching alias** is used.

**Example:**
```typescript
const SERVER_COLUMN_ALIASES = {
  os: ['OS Type', 'OS', 'Operating System'],  // Prefers "OS Type" over "OS"
  // ...
};
```

If a CSV has both "OS Type" and "OS" columns:
- ✅ "OS Type" is used (first in priority)
- ❌ "OS" is ignored

### When to Update Aliases

Update aliases when:
- Users report CSV import failures for common header names
- Adding support for new CSV formats
- Standardizing on new terminology

Always add new aliases to the **end** of the array unless you specifically want to change the priority order.

## Code Style

- Use TypeScript strict mode
- Prefer functional components with hooks
- Use `useMemo` and `useCallback` for performance optimization
- Follow existing naming conventions
- Add JSDoc comments for public APIs
- Write tests for utility functions

## Common Patterns

### Virtual Lists

We use `react-window` for efficient rendering of large lists:

```typescript
<AutoSizer>
  {({ height, width }) => (
    <List
      height={height}
      itemCount={items.length}
      itemSize={60}
      width={width}
    >
      {Row}
    </List>
  )}
</AutoSizer>
```

### Column Resizing

Columns use `ResizableHeader` component with base widths that scale proportionally:

1. **Base widths**: Stored in pixels, represent desired proportions
2. **Scaled widths**: Calculated to fit available space
3. **Reverse scaling**: When user resizes, scaled width is converted back to base width

See `src/renderer/src/utils/columnSizing.ts` for the scaling algorithms.

### Drag and Drop

Column reordering uses `@dnd-kit`:

```typescript
import { DndContext, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';

// In component
<DndContext onDragEnd={handleDragEnd}>
  <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
    {columnOrder.map(key => (
      <DraggableHeader key={key} id={key}>
        {/* Header content */}
      </DraggableHeader>
    ))}
  </SortableContext>
</DndContext>
```

## Questions?

If you have questions about development patterns, please:

1. Check existing code for similar examples
2. Review this guide and inline comments
3. Open a GitHub issue for clarification
