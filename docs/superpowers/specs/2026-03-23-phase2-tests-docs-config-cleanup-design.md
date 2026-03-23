# Phase 2: Tests, Docs & Config Cleanup

**Date:** 2026-03-23
**Branch:** pb
**Scope:** Documentation rewrites, test coverage expansion, coverage threshold alignment, CSS audit, dependency audit, migration guide

---

## 1. Documentation Rewrites

Rewrite all docs that still reference the removed JSON/FileWatcher/DataCacheManager architecture to reflect PocketBase:

| Document                         | Key Changes                                                                                                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture.md`           | Data handling diagram → PocketBase SQLite; key services → PocketBaseProcess, OfflineCache, SyncManager, PendingChanges; storage format → PB collections; atomic writes → PB REST API + offline queue; file watching → PB realtime subscriptions |
| `docs/AGENTS.md`                 | Operations modules table → renderer services (contactService, serverService, etc.); data flow → REST API calls; file lock discussion → PB API + offline queue                                                                                   |
| `docs/DEVELOPMENT.md`            | Operations pattern section → PB service pattern; modules table → current services; file watching section → PB realtime; coverage thresholds → actual 80/80/75 values                                                                            |
| `docs/IMPLEMENTATION_SUMMARY.md` | Move to `docs/historical/` — documents a different branch's work, not pb                                                                                                                                                                        |
| `README.md`                      | Line 9: "atomic JSON writes and live file-watcher sync" → "embedded PocketBase with offline-first cache and realtime sync"; line 31-32: "file/data services" → "PocketBase services"                                                            |

Each document gets its own commit for reviewability.

---

## 2. Coverage Threshold Alignment

The vitest configs enforce 80/80/75 (lines/functions/branches) for all suites. README and DEVELOPMENT.md document outdated thresholds (52/52/38 for main/shared). All tests currently pass at 80%.

**Action:** Update the documented thresholds in README.md and DEVELOPMENT.md to match the actual vitest config values (80/80/75). Done as part of the documentation rewrites in Section 1.

---

## 3. Test Coverage Expansion

### 3a. Tier 1 — PocketBase Infrastructure (main process)

Write/expand unit tests for core PB systems. All use mocked filesystem and mocked PocketBase SDK.

| Module                 | Test File                         | Focus Areas                                                                                  |
| ---------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| `BackupManager.ts`     | Create `BackupManager.test.ts`    | Backup creation, scheduling, retention cleanup, error recovery                               |
| `RetentionManager.ts`  | Create `RetentionManager.test.ts` | Retention policy enforcement, age-based cleanup, size limits                                 |
| `PocketBaseProcess.ts` | Expand existing test              | Process lifecycle (start/stop/restart), port detection, crash recovery, platform differences |
| `SyncManager.ts`       | Expand existing test              | Conflict resolution, multi-record sync, token expiry, reconnection                           |
| `OfflineCache.ts`      | Expand existing test              | Cache read/write, schema version mismatch, concurrent access                                 |
| `PendingChanges.ts`    | Expand existing test              | Queue ordering, batch operations, durability across restart                                  |
| `AppConfig.ts`         | Expand existing test              | Config load/save, encryption via safeStorage, mode switching (server/client)                 |

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

1. Documentation rewrites (architecture.md, AGENTS.md, DEVELOPMENT.md, README.md, IMPLEMENTATION_SUMMARY.md)
2. Migration guide
3. Test coverage — Tier 1 (PB infrastructure)
4. Test coverage — Tier 2 (renderer services)
5. CSS audit (report only)
6. Dependency audit (csv-parse)

Each module gets its own commit(s).
