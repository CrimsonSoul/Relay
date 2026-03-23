# Phase 1: Code Quality & Architecture Cleanup

**Date:** 2026-03-23
**Branch:** pb
**Scope:** Dead code removal, deduplication, file splitting, consistency fixes

---

## 1. Dead Code Removal

Remove all confirmed dead code:

| Target                                                   | Location                                 | Impact                                                                                          |
| -------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `featureFlags` module + test                             | `src/shared/featureFlags.ts` + test file | ~306 lines removed                                                                              |
| `copyDataFilesAsync`                                     | `src/main/dataUtils.ts`                  | ~13 lines removed                                                                               |
| `safeMutation` + `safeMutationWithValidation`            | `src/main/handlers/ipcHelpers.ts`        | ~60 lines removed                                                                               |
| Unused params `_onDataPathChange`, `_getDefaultDataPath` | `src/main/ipcHandlers.ts`                | 2 params removed; stop passing `handleDataPathChange` from `setupIpc` in `appState.ts`          |
| `guardedGetDataRoot` wrapper                             | `src/main/ipcHandlers.ts`                | ~8 lines removed; pass `getDataRoot` directly (intentionally drops empty-string diagnostic log) |
| Un-export `isUncPath`, `safeRealPath`                    | `src/main/utils/pathSafety.ts`           | Visibility change only (remove `export`)                                                        |

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

### 2d. Path Validation Cleanup

Keep `pathValidation.ts` and `pathSafety.ts` as separate files — they serve different concerns (user-facing data path validation vs. IPC security sandboxing). Changes:

- Move `src/main/utils/pathSafety.ts` to stay where it is (already in utils)
- Move `src/main/pathValidation.ts` → `src/main/utils/pathValidation.ts` for consistent location
- Un-export `isUncPath` and `safeRealPath` from `pathSafety.ts` (only used internally by `validatePath`)
- Update import in `appState.ts` to new path

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
  addHistory: (data: Record<string, unknown>) => Promise<T | null>;
  deleteHistory: (id: string) => Promise<boolean>;
  clearHistory: () => Promise<boolean>;
};
```

`useBridgeHistory` and `useAlertHistory` become thin wrappers that call `useHistory` with their specific converter function. Wrappers can add extra methods (e.g., `useAlertHistory` adds `pinHistory` and `updateLabel`) on top of the base return value.

### 3b. Polling Hook

New file: `src/renderer/src/hooks/usePolling.ts`

```typescript
export function usePolling(callback: () => void, intervalMs: number): void;
```

Handles ref-based stale closure prevention internally. Replaces duplicated polling setup in `useAppWeather` and `useAppCloudStatus`.

### 3c. Record Converter Utilities

New file: `src/renderer/src/utils/recordConverters.ts`

Only extract converters that are used by more than one consumer. Converters used by exactly one hook stay co-located with that hook for easier maintenance.

Known multi-consumer converters (verify during implementation):

- `toContactEntry` — used by `useAppData` and `useDirectoryContacts`
- `toServerEntry` — used by `useAppData` and `useServers`

Single-consumer converters (e.g., `toBridgeHistoryEntry`, `toAlertHistoryEntry`, `toGroupEntry`, `toSavedLocationEntry`) stay in their respective hooks.

### 3d. CRUD Error Consistency

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
- Multi-consumer record converters move to `recordConverters.ts` (section 3c)
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

- Remove `as RequestInit` casts in `cloudStatusHandlers.ts` (4 instances) and `weatherHandlers.ts` (1 instance)
- Replace `(err as NodeJS.ErrnoException).code` with type guard in `windowHandlers.ts`
- Replace `err instanceof Error ? err.message : String(err)` with `getErrorMessage(err)` in `windowHandlers.ts` (2 instances)
- Replace `{} as CloudStatusData['providers']` with properly initialized object

### 5c. Logging Consistency

- Pattern: first provider failure = `warn`, all providers exhausted = `error`
- Review `LOG_TO_MAIN` handler in `loggerHandlers.ts` — currently routes all renderer logs through `loggers.bridge.*` regardless of module. Consider routing by the module name passed in the payload, or document why bridge is correct
- Standardize error metadata: always `{ error: getErrorMessage(err) }`

### 5d. Legacy Format Removal

- Remove `lat`/`lon` fallback in `useAppWeather.ts` — the app now consistently uses `latitude`/`longitude` in the `Location` type; the fallback keys were for legacy secureStorage cache entries that have rotated out
- Remove legacy cache format handling dead code in `useAppWeather.ts`

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
2. `src/main/utils/` — new validation utilities, path relocation
3. `src/main/handlers/` — deduplication, splitting, consistency
4. `src/main/` — dead code, rename, unused params
5. `src/renderer/src/utils/` — record converters, mock data extraction (created before hooks that depend on them)
6. `src/renderer/src/hooks/` — new shared hooks (useHistory, usePolling), deduplication
7. `src/renderer/src/components/` — App.tsx decomposition
8. `src/renderer/src/` — legacy format removal, CRUD consistency

Each module gets its own commit for reviewability.
