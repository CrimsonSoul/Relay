# Cross-Instance Sync Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix cross-instance sync so on-call alert dismissals, on-call board edits, and alert history propagate instantly between server and client Relay instances.

**Architecture:** Three targeted fixes: (1) new PocketBase collection `oncall_dismissals` replaces localStorage-based dismissals, (2) `useAlertDismissal` hook rewritten to use PB realtime, (3) `useOptimisticList` bug fix to apply queued data instead of discarding it. Consumer components updated to use simplified dismissal API.

**Tech Stack:** React 19, TypeScript, PocketBase (SSE realtime), Vitest, @testing-library/react

**Spec:** `docs/superpowers/specs/2026-03-26-cross-instance-sync-design.md`

---

### Task 1: Add `oncall_dismissals` Collection to PocketBase Schema

**Files:**
- Modify: `src/main/pocketbase/CollectionBootstrap.ts:31-150` (add to COLLECTIONS array)
- Test: `src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`

- [ ] **Step 1: Update test expectation for collection count**

The test at `CollectionBootstrap.test.ts:68` asserts `mockCreate` is called 10 times (one per collection). Adding `oncall_dismissals` makes it 11.

```ts
// In CollectionBootstrap.test.ts, line 68, change:
expect(mockCreate).toHaveBeenCalledTimes(11);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/claude/apps/Relay && npx vitest run src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`
Expected: FAIL — expected 11 but received 10

- [ ] **Step 3: Add `oncall_dismissals` to COLLECTIONS array**

In `CollectionBootstrap.ts`, add this entry after the `alert_history` collection (after line 102):

```ts
  {
    name: 'oncall_dismissals',
    type: 'base',
    fields: [
      { type: 'text', name: 'alertType', required: true },
      { type: 'text', name: 'dateKey', required: true },
    ],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/claude/apps/Relay && npx vitest run src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/pocketbase/CollectionBootstrap.ts src/main/pocketbase/__tests__/CollectionBootstrap.test.ts
git commit -m "feat: add oncall_dismissals PocketBase collection schema"
```

---

### Task 2: Add Retention Rule for `oncall_dismissals`

**Files:**
- Modify: `src/main/pocketbase/RetentionManager.ts:11-16` (add to runCleanup)

- [ ] **Step 1: Add `cleanOncallDismissals` method to `RetentionManager`**

Add this method after `cleanConflictLog` (after line 107):

```ts
  private async cleanOncallDismissals(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ');
    try {
      const old = await this.pb
        .collection('oncall_dismissals')
        .getFullList({ filter: `created < "${sevenDaysAgo}"`, batch: 200 });
      if (old.length > 0) logger.info('Cleaning oncall dismissals', { expired: old.length });
      await this.batchDelete('oncall_dismissals', old);
    } catch (err) {
      logger.error('Oncall dismissals cleanup failed', { error: err });
    }
  }
```

- [ ] **Step 2: Wire into `runCleanup`**

In the `runCleanup` method (line 11-16), add the call:

```ts
  async runCleanup(): Promise<void> {
    await this.cleanBridgeHistory();
    await this.cleanAlertHistory();
    await this.cleanConflictLog();
    await this.cleanOncallDismissals();
    logger.info('Retention cleanup complete');
  }
```

- [ ] **Step 3: Run all tests to verify nothing broke**

Run: `cd /home/claude/apps/Relay && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/main/pocketbase/RetentionManager.ts
git commit -m "feat: add 7-day retention rule for oncall_dismissals"
```

---

### Task 3: Create `oncallDismissalService`

**Files:**
- Create: `src/renderer/src/services/oncallDismissalService.ts`
- Create: `src/renderer/src/services/oncallDismissalService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/src/services/oncallDismissalService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetFullList = vi.fn();
const mockCreate = vi.fn();

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      getFullList: mockGetFullList,
      create: mockCreate,
    }),
  }),
  handleApiError: vi.fn(),
  escapeFilter: (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
}));

import { getDismissalsForDate, dismissAlert } from './oncallDismissalService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('oncallDismissalService', () => {
  it('getDismissalsForDate fetches records filtered by dateKey', async () => {
    mockGetFullList.mockResolvedValue([]);
    const result = await getDismissalsForDate('2026-03-26');
    expect(mockGetFullList).toHaveBeenCalledWith({
      filter: 'dateKey="2026-03-26"',
    });
    expect(result).toEqual([]);
  });

  it('dismissAlert creates a record with alertType and dateKey', async () => {
    const record = { id: 'rec1', alertType: 'oracle', dateKey: '2026-03-26', created: '', updated: '' };
    mockCreate.mockResolvedValue(record);
    const result = await dismissAlert('oracle', '2026-03-26');
    expect(mockCreate).toHaveBeenCalledWith({
      alertType: 'oracle',
      dateKey: '2026-03-26',
    });
    expect(result).toEqual(record);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/claude/apps/Relay && npx vitest run src/renderer/src/services/oncallDismissalService.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the service**

Create `src/renderer/src/services/oncallDismissalService.ts`:

```ts
import type { RecordModel } from 'pocketbase';
import { getPb, handleApiError, escapeFilter } from './pocketbase';

export interface OncallDismissalRecord extends RecordModel {
  alertType: string;
  dateKey: string;
}

export async function getDismissalsForDate(dateKey: string): Promise<OncallDismissalRecord[]> {
  try {
    return await getPb()
      .collection('oncall_dismissals')
      .getFullList<OncallDismissalRecord>({
        filter: `dateKey="${escapeFilter(dateKey)}"`,
      });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function dismissAlert(
  alertType: string,
  dateKey: string,
): Promise<OncallDismissalRecord> {
  try {
    return await getPb()
      .collection('oncall_dismissals')
      .create<OncallDismissalRecord>({
        alertType,
        dateKey,
      });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/claude/apps/Relay && npx vitest run src/renderer/src/services/oncallDismissalService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/services/oncallDismissalService.ts src/renderer/src/services/oncallDismissalService.test.ts
git commit -m "feat: add oncallDismissalService for PB-backed dismissals"
```

---

### Task 4: Rewrite `useAlertDismissal` Hook

**Files:**
- Modify: `src/renderer/src/hooks/useAlertDismissal.ts` (full rewrite)
- Modify: `src/renderer/src/hooks/__tests__/usePersonnel.test.ts` (update dismissal tests)

The hook currently uses `secureStorage` (localStorage) and `broadcastToAllWindows` IPC. Replace with PocketBase-backed state via `useCollection`.

- [ ] **Step 1: Rewrite `useAlertDismissal.ts`**

Replace the entire file with:

```ts
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useCollection } from './useCollection';
import { dismissAlert as pbDismissAlert } from '../services/oncallDismissalService';
import type { OncallDismissalRecord } from '../services/oncallDismissalService';
import { loggers } from '../utils/logger';

function getTodayDateKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function useAlertDismissal() {
  const [todayKey, setTodayKey] = useState(getTodayDateKey);
  const [dayOfWeek, setDayOfWeek] = useState(() => new Date().getDay());
  const [tick, setTick] = useState(Date.now());
  // Optimistic local dismissals — shown immediately before PB SSE confirms
  const [optimisticDismissals, setOptimisticDismissals] = useState<Set<string>>(new Set());

  const { data: records } = useCollection<OncallDismissalRecord>('oncall_dismissals');

  // Derive dismissed alert types for today from PB records
  const dismissedAlerts = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (r.dateKey === todayKey) {
        set.add(r.alertType);
      }
    }
    // Merge optimistic dismissals
    for (const type of optimisticDismissals) {
      set.add(type);
    }
    return set;
  }, [records, todayKey, optimisticDismissals]);

  const dismissAlert = useCallback(
    (type: string) => {
      // Skip if already dismissed
      if (dismissedAlerts.has(type)) return;

      // Optimistic: show immediately
      setOptimisticDismissals((prev) => {
        const next = new Set(prev);
        next.add(type);
        return next;
      });

      // Persist to PocketBase
      pbDismissAlert(type, todayKey).catch((err: unknown) => {
        loggers.app.error('Failed to persist alert dismissal', { error: err });
      });

      // Broadcast to popout windows on same instance (fast path)
      globalThis.api?.notifyAlertDismissed(type);
    },
    [dismissedAlerts, todayKey],
  );

  // Day rollover check + tick for re-renders
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const checkDay = () => {
      setTick(Date.now());
      const now = new Date();
      setDayOfWeek(now.getDay());
      const newKey = getTodayDateKey();
      if (newKey !== todayKey) {
        setTodayKey(newKey);
        setOptimisticDismissals(new Set());
      }
    };

    const startInterval = () => {
      intervalId ??= setInterval(checkDay, 60000);
    };

    const stopInterval = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopInterval();
      } else {
        checkDay();
        startInterval();
      }
    };

    startInterval();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for dismissals from other windows (same Electron process)
    const cleanupAlertListener = globalThis.api?.onAlertDismissed((type: string) => {
      setOptimisticDismissals((prev) => {
        const next = new Set(prev);
        next.add(type);
        return next;
      });
    });

    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cleanupAlertListener?.();
    };
  }, [todayKey]);

  // Clear optimistic state when PB records catch up
  useEffect(() => {
    const pbTypes = new Set(records.filter((r) => r.dateKey === todayKey).map((r) => r.alertType));
    setOptimisticDismissals((prev) => {
      const remaining = new Set<string>();
      for (const type of prev) {
        if (!pbTypes.has(type)) remaining.add(type);
      }
      return remaining.size === prev.size ? prev : remaining;
    });
  }, [records, todayKey]);

  return {
    dismissedAlerts,
    dismissAlert,
    dayOfWeek,
    tick,
  };
}
```

Key changes:
- `getAlertKey` is **removed** — no longer exported
- `dismissedAlerts` is now a `Set<string>` of raw alert type names (e.g., `"oracle"`) for today only
- Optimistic local state ensures instant UI feedback before PB SSE confirms
- IPC listener for same-process popout windows preserved
- 60s interval preserved for day rollover

- [ ] **Step 2: Update `usePersonnel.ts` to remove `getAlertKey` export**

In `src/renderer/src/hooks/usePersonnel.ts`, remove the `getAlertKey` line from the return object. The hook no longer provides it.

Current (line 1-29):
```ts
import { OnCallRow } from '@shared/ipc';
import { useOnCallManager } from './useOnCallManager';
import { useAlertDismissal } from './useAlertDismissal';

/**
 * Composes on-call CRUD and alert dismissal logic.
 * Kept as a thin wrapper for backward compatibility.
 */
export function usePersonnel(onCall: OnCallRow[]) {
  const alerts = useAlertDismissal();
  const manager = useOnCallManager(onCall, alerts.dismissAlert);

  return {
    localOnCall: manager.localOnCall,
    weekRange: manager.weekRange,
    dismissedAlerts: alerts.dismissedAlerts,
    dismissAlert: alerts.dismissAlert,
    getAlertKey: alerts.getAlertKey,
    dayOfWeek: alerts.dayOfWeek,
    teams: manager.teams,
    handleUpdateRows: manager.handleUpdateRows,
    handleRemoveTeam: manager.handleRemoveTeam,
    handleRenameTeam: manager.handleRenameTeam,
    handleAddTeam: manager.handleAddTeam,
    handleReorderTeams: manager.handleReorderTeams,
    setLocalOnCall: manager.setLocalOnCall,
    tick: alerts.tick,
  };
}
```

Replace with:
```ts
import { OnCallRow } from '@shared/ipc';
import { useOnCallManager } from './useOnCallManager';
import { useAlertDismissal } from './useAlertDismissal';

/**
 * Composes on-call CRUD and alert dismissal logic.
 * Kept as a thin wrapper for backward compatibility.
 */
export function usePersonnel(onCall: OnCallRow[]) {
  const alerts = useAlertDismissal();
  const manager = useOnCallManager(onCall, alerts.dismissAlert);

  return {
    localOnCall: manager.localOnCall,
    weekRange: manager.weekRange,
    dismissedAlerts: alerts.dismissedAlerts,
    dismissAlert: alerts.dismissAlert,
    dayOfWeek: alerts.dayOfWeek,
    teams: manager.teams,
    handleUpdateRows: manager.handleUpdateRows,
    handleRemoveTeam: manager.handleRemoveTeam,
    handleRenameTeam: manager.handleRenameTeam,
    handleAddTeam: manager.handleAddTeam,
    handleReorderTeams: manager.handleReorderTeams,
    setLocalOnCall: manager.setLocalOnCall,
    tick: alerts.tick,
  };
}
```

- [ ] **Step 3: Update `usePersonnel.test.ts`**

The tests reference `secureStorage`, `getAlertKey`, and `secureStore`. Replace the affected tests.

In `src/renderer/src/hooks/__tests__/usePersonnel.test.ts`:

**Remove** the `secureStorage` mock block (lines 8-32) and `secureStore` references. Replace with mocks for the new PB-backed service:

```ts
// Remove these lines:
// const secureStore = new Map<string, unknown>();
// vi.mock('../../utils/secureStorage', ...);

// Add these mocks instead:
const mockDismissAlert = vi.fn().mockResolvedValue({ id: 'rec1' });
vi.mock('../../services/oncallDismissalService', () => ({
  dismissAlert: (...args: unknown[]) => mockDismissAlert(...args),
}));

// Mock useCollection to return dismissal records
const mockDismissalRecords: Array<{ id: string; alertType: string; dateKey: string; collectionId: string; collectionName: string; created: string; updated: string }> = [];
vi.mock('../useCollection', () => ({
  useCollection: (name: string) => {
    if (name === 'oncall_dismissals') {
      return { data: mockDismissalRecords, loading: false, error: null, refetch: vi.fn() };
    }
    return { data: [], loading: false, error: null, refetch: vi.fn() };
  },
}));
```

**Update** the `beforeEach` to clear these mocks instead of `secureStore`:

```ts
  beforeEach(() => {
    vi.clearAllMocks();
    mockDismissalRecords.length = 0;
  });
```

**Remove** the `afterEach` block (lines 80-83) that clears `secureStore` and `localStorage`.

**Replace** the dismissal-specific tests:

Replace `'dismisses alerts and persists to secureStorage'` (lines 254-264) with:

```ts
  it('dismisses alerts optimistically and persists to PB', () => {
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    act(() => {
      result.current.dismissAlert('general');
    });

    expect(result.current.dismissedAlerts.has('general')).toBe(true);
    expect(mockDismissAlert).toHaveBeenCalledWith('general', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });
```

Replace `'handleUpdateRows auto-dismisses general alert on Monday'` (lines 266-278) with:

```ts
  it('handleUpdateRows auto-dismisses general alert on Monday', async () => {
    vi.setSystemTime(new Date(2026, 1, 2, 10, 0, 0)); // Feb 2, 2026 is a Monday
    mockReplaceTeamRecords.mockResolvedValue([]);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleUpdateRows('Network', [makeRow('Network', 'Primary', 'Alice')]);
    });

    expect(result.current.dismissedAlerts.has('general')).toBe(true);
  });
```

Replace `'getAlertKey generates date-based key'` (lines 297-303) with:

```ts
  it('dismissedAlerts reflects PB records for today', () => {
    const today = new Date().toISOString().slice(0, 10);
    mockDismissalRecords.push(
      { id: 'r1', alertType: 'oracle', dateKey: today, collectionId: '', collectionName: 'oncall_dismissals', created: '', updated: '' },
      { id: 'r2', alertType: 'sql', dateKey: '2020-01-01', collectionId: '', collectionName: 'oncall_dismissals', created: '', updated: '' },
    );

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    expect(result.current.dismissedAlerts.has('oracle')).toBe(true);
    expect(result.current.dismissedAlerts.has('sql')).toBe(false);
  });
```

- [ ] **Step 4: Run tests**

Run: `cd /home/claude/apps/Relay && npx vitest run src/renderer/src/hooks/__tests__/usePersonnel.test.ts`
Expected: All tests pass

- [ ] **Step 5: Run full test suite**

Run: `cd /home/claude/apps/Relay && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useAlertDismissal.ts src/renderer/src/hooks/usePersonnel.ts src/renderer/src/hooks/__tests__/usePersonnel.test.ts
git commit -m "feat: rewrite useAlertDismissal to use PocketBase for cross-instance sync"
```

---

### Task 5: Update Consumer Components

**Files:**
- Modify: `src/renderer/src/tabs/PersonnelTab.tsx:129-157`
- Modify: `src/renderer/src/components/PopoutBoard.tsx:17,52-76`

Both consumers currently destructure `getAlertKey` from `usePersonnel` and call `dismissedAlerts.has(getAlertKey(type))`. Update to use `dismissedAlerts.has(type)` directly.

- [ ] **Step 1: Update `PersonnelTab.tsx`**

Find the destructuring (around line 29 or wherever `getAlertKey` is destructured from `usePersonnel`):
```ts
  const { localOnCall, weekRange, dismissedAlerts, dismissAlert, getAlertKey, dayOfWeek, ...
```
Remove `getAlertKey` from the destructuring.

Find the filter line (line 139):
```ts
        (config) => config.day === dayOfWeek && !dismissedAlerts.has(getAlertKey(config.type)),
```
Change to:
```ts
        (config) => config.day === dayOfWeek && !dismissedAlerts.has(config.type),
```

- [ ] **Step 2: Update `PopoutBoard.tsx`**

Find the destructuring (line 17):
```ts
  const { localOnCall, weekRange, dismissedAlerts, getAlertKey, dayOfWeek, teams, tick } =
```
Remove `getAlertKey`:
```ts
  const { localOnCall, weekRange, dismissedAlerts, dayOfWeek, teams, tick } =
```

Find the filter line (line 61):
```ts
      .filter((c) => c.day === dayOfWeek && !dismissedAlerts.has(getAlertKey(c.type)))
```
Change to:
```ts
      .filter((c) => c.day === dayOfWeek && !dismissedAlerts.has(c.type))
```

- [ ] **Step 3: Run full test suite**

Run: `cd /home/claude/apps/Relay && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Run TypeScript check**

Run: `cd /home/claude/apps/Relay && npx tsc --noEmit`
Expected: No errors (confirms `getAlertKey` is not referenced anywhere)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/PersonnelTab.tsx src/renderer/src/components/PopoutBoard.tsx
git commit -m "refactor: update consumers to use simplified dismissal API"
```

---

### Task 6: Fix `useOptimisticList` Stale Data Bug

**Files:**
- Modify: `src/renderer/src/hooks/useOptimisticList.ts:16-26`
- Modify: `src/renderer/src/hooks/__tests__/useOptimisticList.test.ts:55-78,80-108`

- [ ] **Step 1: Update existing test expectations**

In `src/renderer/src/hooks/__tests__/useOptimisticList.test.ts`:

Replace the test `'queued updates are discarded after mutation finishes (optimistic state preserved)'` (lines 55-78) with:

```ts
  it('queued updates are applied after mutation finishes', () => {
    const { result, rerender } = renderHook(({ data }) => useOptimisticList(data), {
      initialProps: { data: data1 },
    });

    act(() => {
      result.current.startMutation();
    });

    rerender({ data: data2 });
    // Should still show old data since mutation is pending
    expect(result.current.data).toEqual([1, 2, 3]);

    // finishMutation applies queued data — realtime events from PB are correctly
    // sorted by useCollection, so applying them is safe and prevents stale state.
    act(() => {
      result.current.finishMutation();
    });
    expect(result.current.data).toEqual([4, 5, 6]);
  });
```

Replace the test `'multiple concurrent mutations discard queued data and preserve optimistic state'` (lines 80-108) with:

```ts
  it('multiple concurrent mutations apply latest queued data after all finish', () => {
    const { result, rerender } = renderHook(({ data }) => useOptimisticList(data), {
      initialProps: { data: data1 },
    });

    act(() => {
      result.current.startMutation();
      result.current.startMutation();
    });

    rerender({ data: data3 });
    expect(result.current.data).toEqual([1, 2, 3]);

    // First mutation finishes — still one pending, data stays optimistic
    act(() => {
      result.current.finishMutation();
    });
    expect(result.current.data).toEqual([1, 2, 3]);

    // Second mutation finishes — queued data applied
    act(() => {
      result.current.finishMutation();
    });
    expect(result.current.data).toEqual([7, 8, 9]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/claude/apps/Relay && npx vitest run src/renderer/src/hooks/__tests__/useOptimisticList.test.ts`
Expected: FAIL — the two updated tests expect new behavior but code still discards queued data

- [ ] **Step 3: Fix `useOptimisticList.ts`**

In `src/renderer/src/hooks/useOptimisticList.ts`, replace the `finishMutation` callback (lines 16-26):

Current:
```ts
  const finishMutation = useCallback(() => {
    pendingRef.current = Math.max(0, pendingRef.current - 1);
    if (pendingRef.current === 0) {
      // Discard queued external data — the optimistic state is already correct.
      // Applying queued realtime events would undo optimistic ordering because
      // PocketBase delete+create cycles append records to the end of the array,
      // scrambling the derived team order.  The next external data change (from
      // any new realtime event) will sync naturally with pendingRef at 0.
      queuedRef.current = null;
    }
  }, []);
```

Replace with:
```ts
  const finishMutation = useCallback(() => {
    pendingRef.current = Math.max(0, pendingRef.current - 1);
    if (pendingRef.current === 0 && queuedRef.current) {
      // Apply queued external data now that all mutations are settled.
      // useCollection sorts realtime events via applyRealtimeEvent, so
      // the queued snapshot is correctly ordered and safe to apply.
      localRef.current = queuedRef.current;
      setLocalData(queuedRef.current);
      queuedRef.current = null;
    }
  }, []);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/claude/apps/Relay && npx vitest run src/renderer/src/hooks/__tests__/useOptimisticList.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /home/claude/apps/Relay && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useOptimisticList.ts src/renderer/src/hooks/__tests__/useOptimisticList.test.ts
git commit -m "fix: apply queued realtime data in useOptimisticList instead of discarding"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd /home/claude/apps/Relay && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript check**

Run: `cd /home/claude/apps/Relay && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run ESLint**

Run: `cd /home/claude/apps/Relay && npx eslint src/`
Expected: No errors

- [ ] **Step 4: Verify no remaining references to `getAlertKey` or `secureStorage` in dismissal code**

Run: `grep -r "getAlertKey" src/renderer/src/`
Expected: No matches

Run: `grep -r "secureStorage" src/renderer/src/hooks/useAlertDismissal.ts`
Expected: No matches

- [ ] **Step 5: Verify `oncall_dismissals` is in the COLLECTIONS array**

Run: `grep "oncall_dismissals" src/main/pocketbase/CollectionBootstrap.ts`
Expected: One match in the COLLECTIONS array
