# Cross-Instance Sync Fixes

## Goal

Fix three sync gaps so that on-call alert dismissals, on-call board edits, and alert history propagate instantly between server and client Relay instances.

## Background

Relay runs as either a **server** (embeds PocketBase) or **client** (connects to a remote PocketBase). All shared data flows through PocketBase with SSE realtime subscriptions via `useCollection`. Three issues break cross-instance sync:

1. **On-call alert dismissals** ("Update DBAs", "Update Oracle", etc.) are stored in `localStorage` via `secureStorage` and broadcast only within the same Electron process via `broadcastToAllWindows`. They never reach other machines.
2. **`useOptimisticList` drops queued realtime events** — when a mutation finishes, it discards any external data that arrived during the mutation instead of applying it. This causes stale state on the non-editing instance.
3. **No persistent dismissal record** — dismissals are ephemeral; restarting the app loses them even on the same machine.

## Architecture

### Change 1: New `oncall_dismissals` PocketBase Collection

**Collection schema:**

| Field | Type | Description |
|-------|------|-------------|
| `alertType` | text | One of: `first-responder`, `general`, `sql`, `oracle` |
| `dateKey` | text | `YYYY-MM-DD` — the day the dismissal applies to |

**Auth rule:** `@request.auth.id != ""` (same as all other collections).

**Retention:** Records older than 7 days are auto-cleaned by `RetentionManager` using the `created` timestamp (same approach as all other collections). Since `created` and `dateKey` are always the same day, this is safe.

**Idempotency:** Duplicate dismissals (two instances dismissing the same alert simultaneously) are harmless. The `dismissedAlerts` set is derived from existence of matching records, so duplicates don't affect behavior. No unique constraint needed.

**Service layer:** New `oncallDismissalService.ts` following the existing `createCrudService` pattern with:
- `getDismissalsForDate(dateKey: string)` — fetch today's dismissals
- `dismissAlert(alertType: string, dateKey: string)` — create a dismissal record
- `undismissAlert(id: string)` — delete a dismissal record (if needed in future)

### Change 2: Refactor `useAlertDismissal` Hook

**Current:** Reads/writes `secureStorage` (localStorage). Broadcasts via IPC `ONCALL_ALERT_DISMISSED` to same-process windows only.

**New:**
- Subscribe to `oncall_dismissals` collection via `useCollection`
- Derive `dismissedAlerts` set by filtering collection data to today's `dateKey`
- `dismissAlert(type)` creates a PocketBase record instead of writing localStorage
- Keep `broadcastToAllWindows` IPC as a fast path for popout windows on the same instance (fires immediately; PB SSE follows shortly)
- Day rollover: existing 60s interval timer filters PB data by today's date instead of reading localStorage
- Remove all `secureStorage` calls for dismissal keys

**Consumer API change:** The current `getAlertKey(type)` returns `YYYY-M-D-type` (zero-indexed month, no padding, type appended). Consumers check `dismissedAlerts.has(getAlertKey(config.type))`. With the new PB-backed model, `dismissedAlerts` becomes a `Set<string>` of alert types (e.g., `"oracle"`, `"sql"`) for the current day only. So:
- `getAlertKey` is removed — no longer needed
- Consumer checks change from `dismissedAlerts.has(getAlertKey(type))` to `dismissedAlerts.has(type)`
- Affected consumers: `PersonnelTab.tsx`, `PopoutBoard.tsx`
- The `tick` value (used to force re-renders every 60s for day rollover) is preserved — the hook still runs a 60s interval to detect midnight and recompute the filtered set

**Offline behavior:** The service does NOT call `requireOnline()` — instead, dismissals use the standard PocketBase SDK call which, on failure, is caught by the hook and the dismissal is optimistically added to local state. When the connection restores, the `useCollection` re-fetch on reconnect (via `connectGeneration` bump) will pull the authoritative state. This matches how the on-call board already handles offline gracefully via optimistic updates.

### Change 3: Fix `useOptimisticList` Stale Data Bug

**Current (`finishMutation`):**
```ts
if (pendingRef.current === 0) {
  // Discards queued external data
  queuedRef.current = null;
}
```

**Fixed:**
```ts
if (pendingRef.current === 0 && queuedRef.current) {
  setLocalData(queuedRef.current);
  queuedRef.current = null;
}
```

**Why this is safe:** The original comment worried that PocketBase delete+create cycles scramble ordering. However, `useCollection` already applies the sort comparator via `applyRealtimeEvent`, so queued data arrives correctly ordered. Applying it is safe and prevents dropped updates.

**Impact:** Fixes sync for on-call board, contacts, servers, bridge groups — anything using `useOptimisticList`.

## What Does NOT Change

- **SSE subscription layer** (`useCollection`, `pocketbase.ts`) — architecturally sound, no changes needed
- **Alert history sync** — already backed by PocketBase with realtime subscriptions; the `useOptimisticList` fix resolves any lag
- **Footer logo persistence** — already handled at the app level via IPC (saved to disk as `footer-logo.png`), not per-alert
- **`broadcastToAllWindows`** — retained for same-process popout window fast path

## Files Affected

| File | Change |
|------|--------|
| `src/main/pocketbase/CollectionBootstrap.ts` | Add `oncall_dismissals` collection schema |
| `src/main/pocketbase/RetentionManager.ts` | Add 7-day retention rule for `oncall_dismissals` |
| `src/renderer/src/services/oncallDismissalService.ts` | **New** — CRUD service for dismissals |
| `src/renderer/src/hooks/useAlertDismissal.ts` | Rewrite: PB-backed instead of localStorage, remove `getAlertKey` |
| `src/renderer/src/tabs/PersonnelTab.tsx` | Update dismissal checks: `dismissedAlerts.has(type)` instead of `dismissedAlerts.has(getAlertKey(type))` |
| `src/renderer/src/components/PopoutBoard.tsx` | Same dismissal check update |
| `src/renderer/src/hooks/useOptimisticList.ts` | Fix: apply queued data instead of discarding |
| `src/renderer/src/hooks/__tests__/useOptimisticList.test.ts` | Add test for queued data application |
| `src/renderer/src/hooks/__tests__/useAlertDismissal.test.ts` | Update tests for PB-backed dismissals |
| `src/renderer/src/services/oncallDismissalService.test.ts` | **New** — service tests |

## Testing

- **Unit:** Service CRUD, hook state derivation, optimistic list queued data application
- **Integration:** Dismiss on one instance, verify it appears on another via PB realtime (manual verification or e2e)
- **Edge cases:** Midnight rollover, duplicate dismissal attempts, offline behavior (dismissal queued via pending changes, synced on reconnect)
