# Phase 1: Code Quality & Architecture Cleanup

**Date:** 2026-03-23
**Branch:** pb
**Scope:** Dead code removal, deduplication, file splitting, consistency fixes

---

## 1. Dead Code Removal

Remove all confirmed dead code:

| Target                                                   | Location                                 | Impact                                        |
| -------------------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| `featureFlags` module + test                             | `src/shared/featureFlags.ts` + test file | ~306 lines removed                            |
| `copyDataFilesAsync`                                     | `src/main/dataUtils.ts`                  | ~13 lines removed                             |
| `handleDataPathChange`                                   | `src/main/app/appState.ts`               | ~12 lines removed                             |
| `safeMutation` + `safeMutationWithValidation`            | `src/main/handlers/ipcHelpers.ts`        | ~60 lines removed                             |
| Unused params `_onDataPathChange`, `_getDefaultDataPath` | `src/main/ipcHandlers.ts`                | 2 params removed                              |
| `guardedGetDataRoot` wrapper                             | `src/main/ipcHandlers.ts`                | ~8 lines removed; pass `getDataRoot` directly |
| Un-export `isUncPath`, `safeRealPath`                    | `src/main/utils/pathSafety.ts`           | Visibility change only (remove `export`)      |

Rename `ensureDataFilesAsync` → `ensureDataDirectoryAsync` in `dataUtils.ts` (only creates a directory, name is misleading).

---

## 2. Deduplication — Shared Utilities (Main Process)

### 2a. Coordinate Validation

New file: `src/main/utils/validation.ts`

```typescript
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

Replaces:

- `locationHandlers.ts` `validateLocationResponse()` (lines 27-40)
- `weatherHandlers.ts` inline validation (lines 88-95)
- `weatherHandlers.ts` inline validation (lines 198-205)

### 2b. Error Message Truncation

Add to `src/main/handlers/ipcHelpers.ts`:

```typescript
export function truncateError(err: unknown, maxLength = 500): string {
  return String(getErrorMessage(err)).slice(0, maxLength);
}
```

Replaces 10+ instances of `String(getErrorMessage(...)).slice(0, 500)` across handlers.

### 2c. Nonce Validation

File-local helper in `authHandlers.ts`:

```typescript
function isValidNonce(nonce: unknown): nonce is string {
  return typeof nonce === 'string' && /^[a-f0-9]{64}$/i.test(nonce);
}
```

Replaces 3 copies. Fix inconsistent return on AUTH_CANCEL (returns void vs false).

### 2d. Path Validation Consolidation

Merge `src/main/pathValidation.ts` and `src/main/utils/pathSafety.ts` into single `src/main/utils/pathValidation.ts`:

```typescript
export async function validatePath(
  path: string,
  root: string,
  options?: {
    checkSymlinks?: boolean;
    checkFilesystem?: boolean;
  },
): Promise<{ valid: boolean; error?: string }>;
```

Remove old `src/main/pathValidation.ts`. Update imports in `appState.ts` and `windowHandlers.ts`.

---

## 3. Deduplication — Renderer Hooks

### 3a. Generic History Hook

New file: `src/renderer/src/hooks/useHistory.ts`

```typescript
export function useHistory<T>(
  collectionName: string,
  toEntry: (record: RecordModel) => T,
): {
  entries: T[];
  loading: boolean;
  addHistory: (data: Partial<T>) => Promise<boolean>;
  deleteHistory: (id: string) => Promise<boolean>;
  clearHistory: () => Promise<boolean>;
};
```

`useBridgeHistory` and `useAlertHistory` become thin wrappers that call `useHistory` with their specific converter function.

### 3b. Generic Cached Data Hook

New file: `src/renderer/src/hooks/useCachedData.ts`

```typescript
export function useCachedData<T>(
  key: string,
  ttl: number,
  fetcher: () => Promise<T>,
): { data: T | null; loading: boolean; refresh: () => void };
```

Encapsulates the stale-while-revalidate + secureStorage pattern. Replaces duplicated logic in `useAppWeather` and `useAppCloudStatus`.

### 3c. Polling Hook

New file: `src/renderer/src/hooks/usePolling.ts`

```typescript
export function usePolling(callback: () => void, intervalMs: number): void;
```

Handles ref-based stale closure prevention internally. Replaces duplicated polling setup in `useAppWeather` and `useAppCloudStatus`.

### 3d. Record Converter Utilities

New file: `src/renderer/src/utils/recordConverters.ts`

Move all `toXxxEntry()` converter functions from individual hooks into one file:

- `toContactEntry`
- `toServerEntry`
- `toBridgeHistoryEntry`
- `toAlertHistoryEntry`
- `toGroupEntry`
- `toSavedLocationEntry`
- Any other record → app type converters

Each hook imports what it needs.

### 3e. CRUD Error Consistency

Not extracting a generic CRUD hook (too many differences between hooks). Instead standardize:

- All CRUD callbacks show toast on error (no silent failures)
- All mutation functions return `boolean` for success/failure consistently

---

## 4. Architecture — File Splitting

### 4a. Cloud Status Handlers

Split `src/main/handlers/cloudStatusHandlers.ts` (388 lines) into:

```
src/main/handlers/cloudStatus/
├── index.ts              — IPC handler registration + fetchProvider dispatcher (~50 lines)
├── types.ts              — RssItem, StatuspageIncident, GoogleCloudIncident, etc. (~40 lines)
├── rssProvider.ts         — RSS parsing + fetchRssProvider (~80 lines)
├── statuspageProvider.ts  — fetchStatuspageProvider (~50 lines)
├── googleProvider.ts      — fetchGoogleCloudProvider (~40 lines)
└── salesforceProvider.ts  — fetchSalesforceProvider (~50 lines)
```

### 4b. App.tsx Decomposition

Split `src/renderer/src/App.tsx` (641 lines) into:

- `src/renderer/src/components/SetupScreen.tsx` — setup/onboarding UI
- `src/renderer/src/components/ConnectionManager.tsx` — PocketBase connection state
- `src/renderer/src/hooks/useKeyboardShortcuts.ts` — keyboard shortcut handling

App.tsx retains the main shell and tab routing (~300 lines).

### 4c. useAppData Decomposition

Split `src/renderer/src/hooks/useAppData.ts` (451 lines):

- `src/renderer/src/utils/mockData.ts` — mock data generation (~250 lines)
- Record converters move to `recordConverters.ts` (section 3d)
- `useAppData.ts` retains collection fetching and state (~150 lines)

### 4d. CSS Audit (Deferred)

Run CSS usage audit to identify unused classes in `components.css` (6,674 lines). Actual splitting deferred to Phase 2 to avoid visual regressions.

---

## 5. Consistency Fixes

### 5a. Handler Error Handling

Standardize all IPC handlers:

- `.handle()` handlers return `{ success: boolean; error?: string; data?: T }`
- `.on()` handlers (fire-and-forget) return void — document with comment at top of file
- Rate-limited handlers return `{ success: false, error: 'Rate limited' }` instead of `undefined`
  - Fixes: `configHandlers.ts`

### 5b. Type Assertion Cleanup

- Remove `as RequestInit` casts in `cloudStatusHandlers.ts` (4 instances)
- Replace `(err as NodeJS.ErrnoException).code` with type guard in `windowHandlers.ts`
- Replace `{} as CloudStatusData['providers']` with properly initialized object

### 5c. Logging Consistency

- Pattern: first provider failure = `warn`, all providers exhausted = `error`
- Fix `LOG_BRIDGE` to use appropriate logger category
- Standardize error metadata: always `{ error: getErrorMessage(err) }`

### 5d. Legacy Format Removal

- Remove `lat`/`lon` fallback in `useAppWeather.ts` (lines 72-79) — PB records use `latitude`/`longitude`
- Remove legacy cache format handling dead code in `useAppWeather.ts` (lines 42-43)

### 5e. Missing Type Exports

- Export `IpLocationResult` from `ipc.ts`
- Remove or export `LocationSearchResult` from `ipc.ts`

---

## 6. Out of Scope (Deferred to Phase 2)

| Item                                         | Reason                                   |
| -------------------------------------------- | ---------------------------------------- |
| CSS splitting/cleanup                        | Visual regression risk; needs audit tool |
| Test coverage expansion                      | Tests come after code settles            |
| Documentation rewrites                       | Docs reflect final code state            |
| Coverage threshold alignment                 | Depends on test expansion                |
| Migration guide                              | Documentation phase                      |
| `dataUtils.ts` config → PocketBase migration | Functional change, separate ticket       |
| Unused dependency audit (`csv-parse`)        | Needs runtime verification               |
| Playwright Firefox config                    | Low priority                             |
| `useOnCallManager` complexity                | Risky without tests; defer               |

---

## Module Order

Work proceeds module by module, all cleanup passes per module before moving on:

1. `src/shared/` — dead code, type exports
2. `src/main/utils/` — new validation utilities, path consolidation
3. `src/main/handlers/` — deduplication, splitting, consistency
4. `src/main/` — dead code, rename, unused params
5. `src/renderer/src/hooks/` — new shared hooks, deduplication
6. `src/renderer/src/utils/` — record converters, mock data extraction
7. `src/renderer/src/components/` — App.tsx decomposition
8. `src/renderer/src/` — legacy format removal, CRUD consistency

Each module gets its own commit for reviewability.
