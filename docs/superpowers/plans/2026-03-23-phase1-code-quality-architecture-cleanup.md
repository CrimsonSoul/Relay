# Phase 1: Code Quality & Architecture Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up dead code, eliminate duplication, split oversized modules, and standardize patterns across the Relay codebase on the pb branch.

**Architecture:** Module-by-module sweep following dependency order (shared → main/utils → main/handlers → main root → renderer/utils → renderer/hooks → renderer/components → renderer root). Each task produces a self-contained, committable change.

**Tech Stack:** Electron 41, React 19, TypeScript 5.9, Vitest 4, ESLint 9

**Working directory:** `/Users/ryan/Apps/Relay/.worktrees/pocketbase`

---

## Task 1: Remove `featureFlags` module (dead code)

**Files:**

- Delete: `src/shared/featureFlags.ts`
- Delete: `src/shared/featureFlags.test.ts`

- [ ] **Step 1: Verify no imports exist outside test file**

Run: `grep -r "featureFlags" src/ --include="*.ts" --include="*.tsx" -l`
Expected: Only `src/shared/featureFlags.ts` and `src/shared/featureFlags.test.ts`

- [ ] **Step 2: Delete both files**

```bash
rm src/shared/featureFlags.ts src/shared/featureFlags.test.ts
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No new errors from this deletion

- [ ] **Step 4: Run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All tests pass (featureFlags tests will simply no longer exist)

- [ ] **Step 5: Commit**

```bash
git add -A src/shared/featureFlags.ts src/shared/featureFlags.test.ts
git commit -m "chore: remove unused featureFlags module"
```

---

## Task 2: Export missing types from `ipc.ts`

**Files:**

- Modify: `src/shared/ipc.ts:235-252`

- [ ] **Step 1: Export `IpLocationResult`**

In `src/shared/ipc.ts`, change line 245 from:

```typescript
type IpLocationResult = {
```

to:

```typescript
export type IpLocationResult = {
```

- [ ] **Step 2: Export `LocationSearchResult`**

In `src/shared/ipc.ts`, change line 235 from:

```typescript
type LocationSearchResult = {
```

to:

```typescript
export type LocationSearchResult = {
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc.ts
git commit -m "chore: export IpLocationResult and LocationSearchResult types"
```

---

## Task 3: Create coordinate validation utility

**Files:**

- Create: `src/main/utils/validation.ts`
- Create: `src/main/utils/validation.test.ts`

- [ ] **Step 1: Write the test**

Create `src/main/utils/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isValidCoordinate } from './validation';

describe('isValidCoordinate', () => {
  it('accepts valid coordinates', () => {
    expect(isValidCoordinate(40.7128, -74.006)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
  });

  it('accepts string numbers', () => {
    expect(isValidCoordinate('40.7128', '-74.006')).toBe(true);
  });

  it('rejects out-of-range latitude', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(-91, 0)).toBe(false);
  });

  it('rejects out-of-range longitude', () => {
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(0, -181)).toBe(false);
  });

  it('rejects NaN values', () => {
    expect(isValidCoordinate(NaN, 0)).toBe(false);
    expect(isValidCoordinate(0, NaN)).toBe(false);
    expect(isValidCoordinate('abc', '0')).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(isValidCoordinate(null, 0)).toBe(false);
    expect(isValidCoordinate(0, undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/utils/validation.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/main/utils/validation.ts`:

```typescript
/**
 * Validates that lat/lon values are valid geographic coordinates.
 * Accepts any type and coerces to number for runtime safety.
 */
export function isValidCoordinate(lat: unknown, lon: unknown): boolean {
  const nLat = Number(lat);
  const nLon = Number(lon);
  return (
    !Number.isNaN(nLat) &&
    !Number.isNaN(nLon) &&
    nLat >= -90 &&
    nLat <= 90 &&
    nLon >= -180 &&
    nLon <= 180
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/utils/validation.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/utils/validation.ts src/main/utils/validation.test.ts
git commit -m "feat: add shared isValidCoordinate utility"
```

---

## Task 4: Add `truncateError` to ipcHelpers

**Files:**

- Modify: `src/main/handlers/ipcHelpers.ts`

- [ ] **Step 1: Add `truncateError` function**

After the `checkMutationRateLimit` function (after line 24) in `src/main/handlers/ipcHelpers.ts`, add:

```typescript
/**
 * Converts an unknown error to a truncated string message.
 * Used across handlers for consistent error logging.
 */
export function truncateError(err: unknown, maxLength = 500): string {
  return String(getErrorMessage(err)).slice(0, maxLength);
}
```

- [ ] **Step 2: Remove dead `safeMutation` and `safeMutationWithValidation` functions**

Delete lines 26-89 (everything from the `safeMutation` JSDoc comment through end of `safeMutationWithValidation`). Also remove the now-unused imports: `ipcMain`, `IpcResult`, `validateIpcDataSafe`, `rateLimiters`, `z`.

The file should now only import:

```typescript
import { getErrorMessage } from '@shared/types';
import { rateLimiters } from '../rateLimiter';
import { loggers } from '../logger';
```

(Keep `rateLimiters` and `loggers` — they're used by `checkMutationRateLimit`.)

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors (safeMutation/safeMutationWithValidation are unused)

- [ ] **Step 4: Run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/main/handlers/ipcHelpers.ts
git commit -m "chore: add truncateError helper, remove unused safeMutation functions"
```

---

## Task 5: Move `pathValidation.ts` to utils

**Files:**

- Move: `src/main/pathValidation.ts` → `src/main/utils/pathValidation.ts`
- Move: `src/main/pathValidation.test.ts` → `src/main/utils/pathValidation.test.ts`
- Modify: `src/main/app/appState.ts` (update import)

- [ ] **Step 1: Move the files**

```bash
git mv src/main/pathValidation.ts src/main/utils/pathValidation.ts
git mv src/main/pathValidation.test.ts src/main/utils/pathValidation.test.ts
```

- [ ] **Step 2: Update import in appState.ts**

In `src/main/app/appState.ts` line 7, change:

```typescript
import { validateDataPath } from '../pathValidation';
```

to:

```typescript
import { validateDataPath } from '../utils/pathValidation';
```

- [ ] **Step 3: Check for other importers**

Run: `grep -r "pathValidation" src/ --include="*.ts" -l`
Update any other files that import from the old path. The test file uses relative imports (`./pathValidation`) so it should work after being moved alongside the source file. Verify the logger mock path in the test file — if it mocks `'../logger'` it may need updating to `'../../logger'`.

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move pathValidation.ts to src/main/utils/"
```

---

## Task 6: Un-export internal pathSafety helpers

**Files:**

- Modify: `src/main/utils/pathSafety.ts`

- [ ] **Step 1: Remove `export` from `isUncPath`**

In `src/main/utils/pathSafety.ts` line 8, change:

```typescript
export function isUncPath(path: string): boolean {
```

to:

```typescript
function isUncPath(path: string): boolean {
```

- [ ] **Step 2: Remove `export` from `safeRealPath`**

Line 16, change:

```typescript
export async function safeRealPath(path: string): Promise<string | null> {
```

to:

```typescript
async function safeRealPath(path: string): Promise<string | null> {
```

- [ ] **Step 3: Verify no external imports**

Run: `grep -r "isUncPath\|safeRealPath" src/ --include="*.ts" -l`
Expected: Only `src/main/utils/pathSafety.ts` (internal use only)

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/main/utils/pathSafety.ts
git commit -m "chore: un-export internal pathSafety helpers"
```

---

## Task 7: Replace duplicate coordinate validation in handlers

**Files:**

- Modify: `src/main/handlers/locationHandlers.ts`
- Modify: `src/main/handlers/weatherHandlers.ts`

- [ ] **Step 1: Update locationHandlers.ts**

Add import at top of `src/main/handlers/locationHandlers.ts`:

```typescript
import { isValidCoordinate } from '../utils/validation';
```

Replace the `validateLocationResponse` function (approximately lines 26-40) with a simpler version that uses the shared utility. The function validates a location API response — keep the function but replace the coordinate check inside it with `isValidCoordinate(data.lat, data.lon)`.

- [ ] **Step 2: Update weatherHandlers.ts**

Add import at top of `src/main/handlers/weatherHandlers.ts`:

```typescript
import { isValidCoordinate } from '../utils/validation';
```

In the GET_WEATHER handler, replace the inline coordinate validation block (approximately lines 85-95) with:

```typescript
if (!isValidCoordinate(lat, lon)) {
  loggers.weather.warn('Invalid coordinates for weather fetch', { lat, lon });
  throw new Error('Invalid coordinates');
}
```

In the GET_WEATHER_ALERTS handler, replace the inline coordinate validation block (approximately lines 195-205) with:

```typescript
if (!isValidCoordinate(lat, lon)) {
  loggers.weather.warn('Invalid coordinates for alerts fetch', { lat, lon });
  return [];
}
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/main/handlers/locationHandlers.ts src/main/handlers/weatherHandlers.ts
git commit -m "refactor: use shared isValidCoordinate in weather and location handlers"
```

---

## Task 8: Extract nonce validation in authHandlers

**Files:**

- Modify: `src/main/handlers/authHandlers.ts`

- [ ] **Step 1: Add helper function**

After the imports and before the `setupAuthHandlers` export in `src/main/handlers/authHandlers.ts`, add this file-local helper:

```typescript
function isValidNonce(nonce: unknown): nonce is string {
  return typeof nonce === 'string' && /^[a-f0-9]{64}$/i.test(nonce);
}
```

Note: AUTH_CANCEL uses `ipcMain.on` (fire-and-forget) so returning `void` is correct — this is not an inconsistency with the `.handle()` handlers that return `boolean`.

- [ ] **Step 2: Replace 3 inline nonce checks**

In AUTH_SUBMIT handler (~line 18), replace:

```typescript
if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/i.test(nonce)) {
```

with:

```typescript
if (!isValidNonce(nonce)) {
```

In AUTH_USE_CACHED handler (~line 43), replace:

```typescript
if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/i.test(nonce)) {
```

with:

```typescript
if (!isValidNonce(nonce)) {
```

In AUTH_CANCEL handler (~line 62), replace:

```typescript
if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/i.test(nonce)) {
```

with:

```typescript
if (!isValidNonce(nonce)) {
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/main/handlers/authHandlers.ts
git commit -m "refactor: extract nonce validation helper in authHandlers"
```

---

## Task 9: Replace error truncation pattern across handlers

**Files:**

- Modify: `src/main/handlers/cloudStatusHandlers.ts`
- Modify: `src/main/handlers/weatherHandlers.ts`
- Modify: `src/main/handlers/locationHandlers.ts`

- [ ] **Step 1: Find all instances**

Run: `grep -rn "\.slice(0, 500)" src/main/handlers/ --include="*.ts"`

This identifies every handler file with the magic-number truncation pattern.

- [ ] **Step 2: Replace in each file**

For each file found, add the import:

```typescript
import { truncateError } from './ipcHelpers';
```

Replace every instance of:

```typescript
String(getErrorMessage(someError)).slice(0, 500);
```

with:

```typescript
truncateError(someError);
```

If `getErrorMessage` is no longer used directly in the file after replacement, remove its import.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/main/handlers/
git commit -m "refactor: use truncateError helper across handlers"
```

---

## Task 10: Split cloudStatusHandlers into provider modules

**Files:**

- Create: `src/main/handlers/cloudStatus/types.ts`
- Create: `src/main/handlers/cloudStatus/rssProvider.ts`
- Create: `src/main/handlers/cloudStatus/statuspageProvider.ts`
- Create: `src/main/handlers/cloudStatus/googleProvider.ts`
- Create: `src/main/handlers/cloudStatus/salesforceProvider.ts`
- Create: `src/main/handlers/cloudStatus/index.ts`
- Delete: `src/main/handlers/cloudStatusHandlers.ts`
- Modify: `src/main/ipcHandlers.ts` (update import)

- [ ] **Step 1: Create the directory**

```bash
mkdir -p src/main/handlers/cloudStatus
```

- [ ] **Step 2: Create `types.ts`**

Extract all internal type definitions (RssItem, StatuspageIncident, GoogleCloudIncident, SalesforceIncident, and any severity mapping types) from `cloudStatusHandlers.ts` into `src/main/handlers/cloudStatus/types.ts`. Export each type.

- [ ] **Step 3: Create provider modules**

Extract each provider's fetch function and its helpers into its own file:

- `rssProvider.ts` — `extractTag`, `extractHref`, `decodeXmlEntities`, `parseRssItems`, `inferSeverity`, `fetchRssProvider`, `RSS_FEEDS` constant
- `statuspageProvider.ts` — `statuspageImpactToSeverity`, `fetchStatuspageProvider`, `STATUSPAGE_FEEDS` constant
- `googleProvider.ts` — `googleImpactToSeverity`, `fetchGoogleCloudProvider`, `GOOGLE_CLOUD_INCIDENTS_URL` constant
- `salesforceProvider.ts` — `fetchSalesforceProvider`, `SALESFORCE_ACTIVE_URL` constant

Each file imports types from `./types` and exports its fetch function.

- [ ] **Step 4: Create `index.ts`**

Move the IPC handler registration, `fetchProvider` dispatcher, cache logic, and `setupCloudStatusHandlers` export into `src/main/handlers/cloudStatus/index.ts`. Import provider functions from sibling modules.

- [ ] **Step 5: Update import in ipcHandlers.ts**

In `src/main/ipcHandlers.ts` line 6, change:

```typescript
import { setupCloudStatusHandlers } from './handlers/cloudStatusHandlers';
```

to:

```typescript
import { setupCloudStatusHandlers } from './handlers/cloudStatus';
```

- [ ] **Step 6: Delete old file**

```bash
rm src/main/handlers/cloudStatusHandlers.ts
```

- [ ] **Step 7: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: split cloudStatusHandlers into per-provider modules"
```

---

## Task 11: Fix configHandlers rate limit return

**Files:**

- Modify: `src/main/handlers/configHandlers.ts`

- [ ] **Step 1: Fix the handler**

In `src/main/handlers/configHandlers.ts` line 8, change:

```typescript
if (!checkMutationRateLimit()) return;
```

to:

```typescript
if (!checkMutationRateLimit()) return { success: false, error: 'Rate limited' };
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main/handlers/configHandlers.ts
git commit -m "fix: return error object when rate limited in configHandlers"
```

---

## Task 12: Type assertion cleanup in handlers

**Files:**

- Modify: `src/main/handlers/cloudStatus/` (after split) or `src/main/handlers/cloudStatusHandlers.ts` (if not yet split)
- Modify: `src/main/handlers/weatherHandlers.ts`
- Modify: `src/main/handlers/windowHandlers.ts`

- [ ] **Step 1: Remove `as RequestInit` casts**

Search for `as RequestInit` in all handler files:

```bash
grep -rn "as RequestInit" src/main/handlers/ --include="*.ts"
```

Remove each `as RequestInit` cast. The fetch options should type-check without it. If TypeScript complains, add `satisfies RequestInit` instead (which validates without asserting).

- [ ] **Step 2: Fix error type guard in windowHandlers.ts**

Find the `(err as NodeJS.ErrnoException).code` pattern in `windowHandlers.ts`. Replace with:

```typescript
if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')
  return { success: true };
```

This preserves the runtime safety check (`instanceof Error && 'code' in err`) while keeping the type assertion only for property access.

- [ ] **Step 3: Fix `getErrorMessage` usage in windowHandlers.ts**

Find all instances of `err instanceof Error ? err.message : String(err)` in `windowHandlers.ts` (there are 4 instances, at approximately lines 126, 148, 177, 218). Replace each with:

```typescript
getErrorMessage(err);
```

Add the import if not already present:

```typescript
import { getErrorMessage } from '@shared/types';
```

- [ ] **Step 4: Fix empty providers initialization in cloudStatus**

Find `{} as CloudStatusData['providers']` and replace with a properly initialized object using `Object.fromEntries`:

```typescript
const providers: CloudStatusData['providers'] = Object.fromEntries(
  CLOUD_STATUS_PROVIDER_ORDER.map((p) => [p, []]),
) as CloudStatusData['providers'];
```

- [ ] **Step 5: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/main/handlers/
git commit -m "refactor: clean up type assertions in handlers"
```

---

## Task 13: Review LOG_TO_MAIN logger routing

**Files:**

- Modify: `src/main/handlers/loggerHandlers.ts`

- [ ] **Step 1: Assess the routing**

Read `src/main/handlers/loggerHandlers.ts`. The `LOG_TO_MAIN` handler (lines 24-65) routes all renderer logs through `loggers.bridge.*`. The module name from the renderer is included in the message prefix `[${module}]`.

Decision: This is intentional — all renderer logs are bridged through the `bridge` logger to distinguish main-process vs renderer-process log sources. The module name differentiates within that stream. Add a clarifying comment.

- [ ] **Step 2: Add documentation comment**

Add a comment above the `LOG_TO_MAIN` handler:

```typescript
// Renderer-to-main log bridge: all renderer logs are routed through loggers.bridge
// to distinguish them from main-process logs. The renderer module name is included
// in the message prefix (e.g., "[weather] fetch failed") for filtering.
```

- [ ] **Step 3: Commit**

```bash
git add src/main/handlers/loggerHandlers.ts
git commit -m "docs: clarify LOG_TO_MAIN logger routing intent"
```

---

## Task 14: Remove dead code from main process root

**Files:**

- Modify: `src/main/dataUtils.ts`
- Modify: `src/main/dataUtils.test.ts`
- Modify: `src/main/app/appState.ts`
- Modify: `src/main/ipcHandlers.ts`

- [ ] **Step 1: Remove `copyDataFilesAsync` from dataUtils.ts**

Delete the `copyDataFilesAsync` function (lines 15-27) from `src/main/dataUtils.ts`.

- [ ] **Step 1b: Update dataUtils.test.ts**

In `src/main/dataUtils.test.ts`:

- Remove `copyDataFilesAsync` from the import on line 4
- Delete the entire `describe('copyDataFilesAsync', ...)` block (lines 60-72)

- [ ] **Step 2: Rename `ensureDataFilesAsync` → `ensureDataDirectoryAsync`**

In `src/main/dataUtils.ts`, rename the function on line 7:

```typescript
export async function ensureDataDirectoryAsync(targetRoot: string) {
```

Update all callers — run `grep -rn "ensureDataFilesAsync" src/ --include="*.ts"` and update each to `ensureDataDirectoryAsync`. This includes:

- `src/main/app/appState.ts` (import and usage)
- `src/main/dataUtils.test.ts` (import, describe block name, and function calls)

- [ ] **Step 3: Remove unused params from `setupIpcHandlers`**

In `src/main/ipcHandlers.ts`, remove lines 24-25 (the `_onDataPathChange` and `_getDefaultDataPath` parameters) from the function signature.

- [ ] **Step 4: Remove `guardedGetDataRoot` wrapper**

In `src/main/ipcHandlers.ts`, delete lines 42-49 (the `guardedGetDataRoot` function). Update line 61 to pass `getDataRoot` directly:

```typescript
safeSetup('window', () => setupWindowHandlers(getMainWindow, createAuxWindow, getDataRoot));
```

- [ ] **Step 5: Stop passing unused args from setupIpc**

In `src/main/app/appState.ts`, update `setupIpc` (lines 104-115). Remove the `handleDataPathChange` and `getDefaultDataPath` arguments from the `setupIpcHandlers` call:

```typescript
export function setupIpc(createAuxWindow?: (route: string) => void) {
  setupIpcHandlers(
    () => state.mainWindow,
    getDataRoot,
    createAuxWindow,
    () => state.appConfig,
    () => state.offlineCache,
    () => state.pendingChanges,
    () => state.syncManager,
  );
  setupAuthHandlers();
  setupAuthInterception(() => state.mainWindow);
  setupLoggerHandlers();
}
```

- [ ] **Step 6: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/main/dataUtils.ts src/main/app/appState.ts src/main/ipcHandlers.ts
git commit -m "chore: remove dead code from main process (copyDataFiles, unused params, guardedGetDataRoot)"
```

---

## Task 15: Create `usePolling` hook

**Files:**

- Create: `src/renderer/src/hooks/usePolling.ts`
- Create: `src/renderer/src/hooks/usePolling.test.ts`

- [ ] **Step 1: Write the test**

Create `src/renderer/src/hooks/usePolling.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePolling } from './usePolling';

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls callback on interval', () => {
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 1000));

    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('clears interval on unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => usePolling(callback, 1000));

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('uses latest callback without restarting interval', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const { rerender } = renderHook(({ cb }) => usePolling(cb, 1000), {
      initialProps: { cb: callback1 },
    });

    vi.advanceTimersByTime(500);
    rerender({ cb: callback2 });
    vi.advanceTimersByTime(500);

    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/hooks/usePolling.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/renderer/src/hooks/usePolling.ts`:

```typescript
import { useEffect, useRef } from 'react';

/**
 * Runs a callback on a fixed interval, automatically handling cleanup
 * and stale closure prevention via ref.
 */
export function usePolling(callback: () => void, intervalMs: number): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const id = setInterval(() => callbackRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/hooks/usePolling.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/usePolling.ts src/renderer/src/hooks/usePolling.test.ts
git commit -m "feat: add usePolling hook for interval-based polling"
```

---

## Task 16: Create `useHistory` generic hook

**Files:**

- Create: `src/renderer/src/hooks/useHistory.ts`

- [ ] **Step 1: Analyze shared pattern**

Read `src/renderer/src/hooks/useBridgeHistory.ts` and `src/renderer/src/hooks/useAlertHistory.ts`. Identify the shared structure:

- Both use `useCollection` for data
- Both have `useMemo` mapping with a converter
- Both have `addHistory`, `deleteHistory`, `clearHistory` with try/catch + toast

- [ ] **Step 2: Write the generic hook**

Create `src/renderer/src/hooks/useHistory.ts`:

```typescript
import { useCallback, useMemo } from 'react';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { useCollection } from './useCollection';

/**
 * Generic history hook for PocketBase-backed history collections.
 * Provides standard CRUD operations with toast feedback.
 *
 * @param collectionName - PocketBase collection name
 * @param toEntry - Converter from PocketBase record to app type
 * @param services - Service functions for create, delete, clear operations
 * @param labels - Human-readable labels for toast messages
 */
export function useHistory<TRecord extends { id: string }, TEntry>(
  collectionName: string,
  toEntry: (record: TRecord) => TEntry,
  services: {
    add: (data: Record<string, unknown>) => Promise<TRecord>;
    delete: (id: string) => Promise<void>;
    clear: () => Promise<void>;
  },
  labels: { name: string },
) {
  const { showToast } = useToast();
  const {
    data: records,
    loading,
    refetch: reloadHistory,
  } = useCollection<TRecord>(collectionName, { sort: '-created' });

  const entries = useMemo(() => records.map(toEntry), [records, toEntry]);

  const addHistory = useCallback(
    async (data: Record<string, unknown>): Promise<TEntry | null> => {
      try {
        const created = await services.add(data);
        return toEntry(created);
      } catch (error) {
        loggers.app.error(`Failed to add ${labels.name}`, { error });
        showToast(`Failed to save ${labels.name}`, 'error');
        return null;
      }
    },
    [services, toEntry, labels.name, showToast],
  );

  const deleteHistory = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await services.delete(id);
        showToast('History entry deleted', 'success');
        return true;
      } catch (error) {
        loggers.app.error(`Failed to delete ${labels.name}`, { error });
        showToast('Failed to delete history entry', 'error');
        return false;
      }
    },
    [services, labels.name, showToast],
  );

  const clearHistory = useCallback(async (): Promise<boolean> => {
    try {
      await services.clear();
      showToast(`${labels.name} cleared`, 'success');
      return true;
    } catch (error) {
      loggers.app.error(`Failed to clear ${labels.name}`, { error });
      showToast(`Failed to clear ${labels.name}`, 'error');
      return false;
    }
  }, [services, labels.name, showToast]);

  return { entries, loading, addHistory, deleteHistory, clearHistory, reloadHistory };
}
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useHistory.ts
git commit -m "feat: add generic useHistory hook for history collections"
```

---

## Task 17: Refactor `useBridgeHistory` to use `useHistory`

**Files:**

- Modify: `src/renderer/src/hooks/useBridgeHistory.ts`

- [ ] **Step 1: Rewrite to use generic hook**

Replace the contents of `src/renderer/src/hooks/useBridgeHistory.ts`:

```typescript
import { useMemo } from 'react';
import type { BridgeHistoryEntry } from '@shared/ipc';
import { useHistory } from './useHistory';
import {
  addBridgeHistory as pbAdd,
  deleteBridgeHistory as pbDelete,
  clearBridgeHistory as pbClear,
} from '../services/bridgeHistoryService';
import type { BridgeHistoryRecord } from '../services/bridgeHistoryService';

function toBridgeHistoryEntry(r: BridgeHistoryRecord): BridgeHistoryEntry {
  return {
    id: r.id,
    timestamp: new Date(r.created).getTime(),
    note: r.note,
    groups: r.groups || [],
    contacts: r.contacts || [],
    recipientCount: r.recipientCount,
  };
}

const services = {
  add: pbAdd,
  delete: pbDelete,
  clear: pbClear,
};

const labels = { name: 'bridge history' };

export function useBridgeHistory() {
  const base = useHistory<BridgeHistoryRecord, BridgeHistoryEntry>(
    'bridge_history',
    toBridgeHistoryEntry,
    services,
    labels,
  );

  return {
    history: base.entries,
    loading: base.loading,
    addHistory: async (entry: Omit<BridgeHistoryEntry, 'id' | 'timestamp'>) =>
      base.addHistory({
        note: entry.note,
        groups: entry.groups,
        contacts: entry.contacts,
        recipientCount: entry.recipientCount,
      }),
    deleteHistory: base.deleteHistory,
    clearHistory: base.clearHistory,
    reloadHistory: base.reloadHistory,
  };
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useBridgeHistory.ts
git commit -m "refactor: useBridgeHistory now uses generic useHistory hook"
```

---

## Task 18: Refactor `useAlertHistory` to use `useHistory`

**Files:**

- Modify: `src/renderer/src/hooks/useAlertHistory.ts`

- [ ] **Step 1: Rewrite to use generic hook, keeping extra methods**

Replace the contents of `src/renderer/src/hooks/useAlertHistory.ts`:

```typescript
import { useCallback } from 'react';
import type { AlertHistoryEntry } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { useHistory } from './useHistory';
import {
  addAlertHistory as pbAdd,
  deleteAlertHistory as pbDelete,
  clearAlertHistory as pbClear,
  pinAlertHistory as pbPinAlertHistory,
  updateAlertLabel as pbUpdateAlertLabel,
} from '../services/alertHistoryService';
import type { AlertHistoryRecord } from '../services/alertHistoryService';

function toAlertHistoryEntry(r: AlertHistoryRecord): AlertHistoryEntry {
  return {
    id: r.id,
    timestamp: new Date(r.created).getTime(),
    severity: r.severity,
    subject: r.subject,
    bodyHtml: r.bodyHtml,
    sender: r.sender,
    recipient: r.recipient || '',
    ...(r.pinned ? { pinned: true } : {}),
    ...(r.label ? { label: r.label } : {}),
  };
}

const services = {
  add: pbAdd,
  delete: pbDelete,
  clear: pbClear,
};

const labels = { name: 'alert history' };

export function useAlertHistory() {
  const { showToast } = useToast();
  const base = useHistory<AlertHistoryRecord, AlertHistoryEntry>(
    'alert_history',
    toAlertHistoryEntry,
    services,
    labels,
  );

  const pinHistory = useCallback(
    async (id: string, pinned: boolean) => {
      try {
        await pbPinAlertHistory(id, pinned);
        showToast(pinned ? 'Pinned as template' : 'Unpinned', 'success');
        return true;
      } catch (error) {
        loggers.app.error('Failed to update alert history pin', { error });
        showToast('Failed to update pin', 'error');
        return false;
      }
    },
    [showToast],
  );

  const updateLabel = useCallback(
    async (id: string, label: string) => {
      try {
        await pbUpdateAlertLabel(id, label);
        return true;
      } catch (error) {
        loggers.app.error('Failed to update alert history label', { error });
        showToast('Failed to update label', 'error');
        return false;
      }
    },
    [showToast],
  );

  return {
    history: base.entries,
    loading: base.loading,
    addHistory: async (entry: Omit<AlertHistoryEntry, 'id' | 'timestamp'>) =>
      base.addHistory({
        severity: entry.severity,
        subject: entry.subject,
        bodyHtml: entry.bodyHtml,
        sender: entry.sender,
        recipient: entry.recipient || '',
        pinned: entry.pinned || false,
        label: entry.label || '',
      }),
    deleteHistory: base.deleteHistory,
    clearHistory: base.clearHistory,
    pinHistory,
    updateLabel,
    reloadHistory: base.reloadHistory,
  };
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useAlertHistory.ts
git commit -m "refactor: useAlertHistory now uses generic useHistory hook"
```

---

## Task 19: Verify record converter sharing (may be no-op)

**Files:**

- Possibly create: `src/renderer/src/utils/recordConverters.ts`

- [ ] **Step 1: Search for multi-consumer converters**

Run: `grep -rn "toContactEntry\|toServerEntry\|toGroupEntry\|toSavedLocationEntry\|toBridgeHistoryEntry\|toAlertHistoryEntry" src/renderer/src/ --include="*.ts" --include="*.tsx" -l`

Identify which converter functions are used by more than one file. Based on the audit, no named `toContactEntry` or `toServerEntry` functions exist — converters are inline in each hook. If no multi-consumer converters are found, this task is a no-op. Skip to commit.

- [ ] **Step 2: If shared converters found, extract them**

If any converter function is defined in one file but imported in another, create `src/renderer/src/utils/recordConverters.ts` and extract only those.

- [ ] **Step 3: If no shared converters found, skip**

Log the result: "Verified no multi-consumer record converters exist. Inline converters stay co-located with their hooks."

- [ ] **Step 4: Commit (only if changes were made)**

```bash
git add -A
git commit -m "refactor: extract shared record converters to utils"
```

---

## Task 20: Extract mock data from `useAppData`

**Files:**

- Create: `src/renderer/src/utils/mockData.ts`
- Modify: `src/renderer/src/hooks/useAppData.ts`

- [ ] **Step 1: Identify mock data block**

Read `src/renderer/src/hooks/useAppData.ts`. Find the mock data generation section (the dev-mode mock contacts, servers, groups — approximately the first 250+ lines of the file).

- [ ] **Step 2: Extract to new file**

Create `src/renderer/src/utils/mockData.ts` and move all mock data generation functions and constants into it. Export the top-level function that returns the mock dataset.

- [ ] **Step 3: Update useAppData to import**

Replace the inline mock data section in `useAppData.ts` with an import from `../utils/mockData`.

- [ ] **Step 4: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/mockData.ts src/renderer/src/hooks/useAppData.ts
git commit -m "refactor: extract mock data from useAppData to utils/mockData"
```

---

## Task 21: Refactor polling in `useAppCloudStatus`

**Files:**

- Modify: `src/renderer/src/hooks/useAppCloudStatus.ts`

- [ ] **Step 1: Replace manual polling with `usePolling`**

Add import:

```typescript
import { usePolling } from './usePolling';
```

Replace the polling `useEffect` (approximately lines 129-135):

```typescript
// Initial fetch + polling
useEffect(() => {
  void fetchStatus(!!statusData); // silent if we already have cached data
  const interval = setInterval(() => fetchStatus(true), POLLING_INTERVAL_MS);
  return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- statusData intentionally excluded
}, [fetchStatus]);
```

With:

```typescript
// Initial fetch on mount
useEffect(() => {
  void fetchStatus(!!statusData);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
}, []);

// Background polling
usePolling(() => void fetchStatus(true), POLLING_INTERVAL_MS);
```

Note: The initial fetch needs to remain separate since `usePolling` doesn't fire immediately.

- [ ] **Step 2: Remove unused refs if applicable**

If there were any stale-closure prevention refs that `usePolling` now handles, remove them.

- [ ] **Step 3: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useAppCloudStatus.ts
git commit -m "refactor: use usePolling hook in useAppCloudStatus"
```

---

## Task 22: Refactor polling in `useAppWeather`

**Files:**

- Modify: `src/renderer/src/hooks/useAppWeather.ts`

- [ ] **Step 1: Add usePolling import**

```typescript
import { usePolling } from './usePolling';
```

- [ ] **Step 2: Replace manual polling interval**

Weather polling restarts when location changes (the `useEffect` depends on `weatherLocation`). The `usePolling` hook takes a fixed interval and doesn't support dynamic dependencies. **Keep the existing `useEffect` pattern for weather polling** — it correctly ties the interval to location changes. However, remove the manual `fetchWeatherRef` ref since the `useCallback` for `fetchWeather` already handles closure freshness via its dependency array.

In the polling `useEffect` (approximately lines 222-258), replace:

```typescript
fetchWeatherRef.current(weatherLocation.latitude, weatherLocation.longitude, true);
```

with:

```typescript
fetchWeather(weatherLocation.latitude, weatherLocation.longitude, true);
```

And remove the `fetchWeatherRef` ref declaration and assignment (approximately lines 212-213).

- [ ] **Step 3: Remove legacy format handling**

Remove the `lat`/`lon` fallback handling (approximately lines 74-78):

```typescript
latitude: Number(loc.latitude ?? loc.lat),
longitude: Number(loc.longitude ?? loc.lon),
```

Replace with:

```typescript
latitude: Number(loc.latitude),
longitude: Number(loc.longitude),
```

Remove the legacy cache format comment and early return (approximately lines 42-43):

```typescript
// Legacy cache format (raw WeatherData) is discarded to avoid timezone issues
return null;
```

These lines can be removed since the `if` block above already handles the version check.

- [ ] **Step 4: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useAppWeather.ts
git commit -m "refactor: simplify weather polling and remove legacy format handling"
```

---

## Task 23: Decompose App.tsx

**Files:**

- Create: `src/renderer/src/components/SetupScreen.tsx`
- Create: `src/renderer/src/components/ConnectionManager.tsx`
- Create: `src/renderer/src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Read App.tsx carefully**

Read the full `src/renderer/src/App.tsx`. Identify:

- `AppWithSetup` component (lines ~459-567) — setup/onboarding flow
- `ConnectedApp` component (lines ~569-623) — connection state management
- Keyboard shortcut handling within `MainApp`

- [ ] **Step 2: Extract SetupScreen**

Move the setup-related UI from `AppWithSetup` into `src/renderer/src/components/SetupScreen.tsx`. Keep the component self-contained with its own state and props interface.

- [ ] **Step 3: Extract ConnectionManager**

Move the connection state management from `ConnectedApp` into `src/renderer/src/components/ConnectionManager.tsx`.

- [ ] **Step 4: Extract keyboard shortcuts**

Create `src/renderer/src/hooks/useKeyboardShortcuts.ts` with the keyboard shortcut handling logic (Cmd/Ctrl+1-9 tab navigation, Cmd/Ctrl+, for settings).

- [ ] **Step 5: Update App.tsx**

Import the extracted components and hook. App.tsx should now be ~300 lines focused on the main shell and tab routing.

- [ ] **Step 6: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 7: Visual smoke test**

Run: `npx electron-vite dev`
Verify: App loads, tabs render, setup screen works, keyboard shortcuts work.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: decompose App.tsx into SetupScreen, ConnectionManager, and useKeyboardShortcuts"
```

---

## Task 24: CRUD error consistency audit

**Files:**

- Modify: Various renderer hooks

- [ ] **Step 1: Audit silent failures**

Run: `grep -rn "catch.*{" src/renderer/src/hooks/ --include="*.ts" -A5 | grep -v showToast`

Identify CRUD callbacks that catch errors but don't show a toast to the user.

- [ ] **Step 2: Add missing toast notifications**

For each hook with a silent failure pattern, add `showToast('Failed to [action]', 'error')` in the catch block.

- [ ] **Step 3: Run type check and tests**

Run: `npx tsc --noEmit && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/
git commit -m "fix: ensure all CRUD operations show toast on error"
```

---

## Task 25: Final verification

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

- [ ] **Step 3: Lint check**

Run: `npx eslint src/ --max-warnings=0 2>&1 | tail -30`
Expected: No new warnings or errors

- [ ] **Step 4: Dev server smoke test**

Run: `npx electron-vite dev`
Verify: App loads, all 9 tabs render, weather polling works, cloud status updates, keyboard shortcuts function.

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: Phase 1 cleanup verification pass"
```
