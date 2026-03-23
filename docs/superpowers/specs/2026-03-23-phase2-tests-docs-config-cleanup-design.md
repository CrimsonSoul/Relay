# Phase 2: Tests, Docs & Config Cleanup

**Date:** 2026-03-23
**Branch:** pb
**Scope:** Documentation rewrites, test coverage expansion, coverage threshold alignment, CSS audit, dependency audit, migration guide

---

## 1. Documentation Rewrites

Rewrite all docs that still reference the removed JSON/FileWatcher/DataCacheManager architecture to reflect PocketBase:

| Document                         | Key Changes                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture.md`           | Data handling diagram → PocketBase SQLite; key services → PocketBaseProcess, OfflineCache, SyncManager, PendingChanges; storage format → PB collections; atomic writes → PB REST API + offline queue; file watching → PB realtime subscriptions; Stack table: remove Chokidar, add PocketBase; IPC Contracts section: note that data CRUD now goes through PB REST directly, not IPC; Preload section: update to reflect reduced IPC surface |
| `docs/AGENTS.md`                 | Effectively a near-total rewrite. Overview sentence, Business Logic section, Key Directories, Operations Modules table, Handler Modules table, "Adding a New Feature" guide, and all Code Patterns sections reference the removed JSON/fileLock architecture. Replace with PB service patterns, current directory structure, and updated code examples. Also update coverage thresholds to 80/80/75.                                         |
| `docs/DEVELOPMENT.md`            | Effectively a near-total rewrite. Operations Pattern section, IPC and Validation, File I/O and Locking, File Watching, Data Cache, Testing Operations sections all reference removed architecture. Replace with PB service patterns, current test patterns, and actual coverage thresholds (80/80/75).                                                                                                                                       |
| `docs/SECURITY.md`               | File Locking and Atomic Operations subsections (~lines 120-135) still reference `fileLock.ts` and `FileManager.ts`. Update to describe PocketBase storage model.                                                                                                                                                                                                                                                                             |
| `docs/IMPLEMENTATION_SUMMARY.md` | Move to `docs/historical/` — documents a different branch's work, not pb                                                                                                                                                                                                                                                                                                                                                                     |
| `README.md`                      | Line 9: "atomic JSON writes and live file-watcher sync" → "embedded PocketBase with offline-first cache and realtime sync"; line 31-32: "file/data services" → "PocketBase services"; update coverage thresholds to 80/80/75                                                                                                                                                                                                                 |

**Verified clean (no stale references):** `docs/LOGGING.md`, `docs/DESIGN.md` — no updates needed.

Each document gets its own commit for reviewability.

---

## 2. Coverage Threshold Alignment

The vitest configs enforce 80/80/75 (lines/functions/branches) for all suites. Three docs contain outdated thresholds:

- README.md — both main and renderer thresholds outdated
- DEVELOPMENT.md — both main and renderer thresholds outdated
- AGENTS.md — both main and renderer thresholds outdated

All tests currently pass at the 80/80/75 threshold.

**Action:** Update all three docs to match the actual vitest config values (80/80/75 for both suites). Done as part of the documentation rewrites in Section 1.

---

## 3. Test Coverage Expansion

### 3a. Tier 1 — PocketBase Infrastructure (main process)

Write/expand unit tests for core PB systems. All use mocked filesystem and mocked PocketBase SDK.

| Module                 | Test File                                           | Focus Areas                                                                                  |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `BackupManager.ts`     | Create `BackupManager.test.ts`                      | Backup creation, scheduling, retention cleanup, error recovery                               |
| `RetentionManager.ts`  | Create `RetentionManager.test.ts`                   | Retention policy enforcement, age-based cleanup, size limits                                 |
| `PocketBaseProcess.ts` | Expand existing test                                | Process lifecycle (start/stop/restart), port detection, crash recovery, platform differences |
| `SyncManager.ts`       | Expand existing test                                | Conflict resolution, multi-record sync, token expiry, reconnection                           |
| `OfflineCache.ts`      | Expand existing test                                | Cache read/write, schema version mismatch, concurrent access                                 |
| `PendingChanges.ts`    | Expand existing test                                | Queue ordering, batch operations, durability across restart                                  |
| `AppConfig.ts`         | Expand existing test                                | Config load/save, encryption via safeStorage, mode switching (server/client)                 |
| `JsonMigrator.ts`      | Expand existing test (89 lines for 295-line module) | Migration of each data type, partial migration recovery, schema evolution, error handling    |

### 3b. Tier 2 — Renderer Services

Create test files for all PocketBase service modules. Each service wraps PB SDK calls — tests mock the SDK and verify:

- CRUD operations (create, read, update, delete)
- Data transformation/serialization
- Error handling (network failure, validation errors)

| Service                   | Test File                             |
| ------------------------- | ------------------------------------- |
| `contactService.ts`       | Create `contactService.test.ts`       |
| `serverService.ts`        | Create `serverService.test.ts`        |
| `oncallService.ts`        | Create `oncallService.test.ts`        |
| `bridgeGroupService.ts`   | Create `bridgeGroupService.test.ts`   |
| `bridgeHistoryService.ts` | Create `bridgeHistoryService.test.ts` |
| `alertHistoryService.ts`  | Create `alertHistoryService.test.ts`  |
| `notesService.ts`         | Create `notesService.test.ts`         |
| `savedLocationService.ts` | Create `savedLocationService.test.ts` |
| `oncallLayoutService.ts`  | Create `oncallLayoutService.test.ts`  |
| `importExportService.ts`  | Create `importExportService.test.ts`  |

Note: `pocketbase.ts` (PB SDK client init) is excluded — it is a thin wrapper with no meaningful logic to test.

---

## 4. CSS Audit

Run static analysis on `src/renderer/src/styles/components.css` (6,674 lines) to identify unused CSS classes.

**Approach:** Grep each class name against all `.tsx` files to find classes with zero references. Produce a report listing unused classes with line numbers.

**Action:** Report only — actual removal deferred to avoid visual regressions. Output saved to `docs/superpowers/reports/2026-03-23-unused-css-audit.md`.

---

## 5. Unused Dependency Audit

Verify `csv-parse` usage: `grep -r "csv-parse" src/`

If unused (papaparse already handles browser CSV parsing), remove from `package.json` and run `npm install` to update the lock file.

---

## 6. Migration Guide

Create `docs/MIGRATION_GUIDE.md` based on reading `src/main/migration/JsonMigrator.ts`:

- How migration triggers (automatic on first PB launch)
- What data is migrated (contacts, servers, groups, on-call, history, notes, locations)
- What happens to old JSON files (preserved in original location)
- Pre-migration backup recommendation
- Post-migration validation steps
- Rollback procedure (revert to pre-PB version)

---

## 7. Out of Scope

| Item                                         | Reason                                                 |
| -------------------------------------------- | ------------------------------------------------------ |
| `dataUtils.ts` config → PocketBase migration | Functional change, separate ticket                     |
| Playwright Firefox config                    | Low priority                                           |
| `useOnCallManager` refactor                  | Needs test coverage first; defer to Phase 3            |
| CSS class removal                            | Phase 2 identifies; removal needs manual visual review |

---

## Module Order

1. Documentation rewrites (architecture.md, SECURITY.md, AGENTS.md, DEVELOPMENT.md, README.md, IMPLEMENTATION_SUMMARY.md)
2. Test coverage — Tier 1 (PB infrastructure, including JsonMigrator)
3. Migration guide (written after JsonMigrator tests deepen understanding)
4. Test coverage — Tier 2 (renderer services)
5. CSS audit (report only)
6. Dependency audit (csv-parse)

Each module gets its own commit(s).
