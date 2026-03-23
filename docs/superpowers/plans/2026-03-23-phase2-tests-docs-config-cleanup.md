# Phase 2: Tests, Docs & Config Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update all documentation to reflect the PocketBase architecture, expand test coverage for PB infrastructure and renderer services, audit CSS and dependencies.

**Architecture:** Documentation rewrites first (sets context), then test expansion (validates implementations), then audits (standalone). Doc tasks read the current source code to write accurate replacements. Test tasks mock the PocketBase SDK and verify CRUD + error handling.

**Tech Stack:** Electron 41, React 19, TypeScript 5.9, Vitest 4, PocketBase SDK

**Working directory:** `/Users/ryan/Apps/Relay/.worktrees/pocketbase`

---

## Task 1: Rewrite architecture.md

**Files:**

- Modify: `docs/architecture.md`

- [ ] **Step 1: Read the current architecture and PB source**

Read these files to understand the current architecture:

- `docs/architecture.md` (current doc to rewrite)
- `src/main/pocketbase/PocketBaseProcess.ts` (process lifecycle)
- `src/main/cache/SyncManager.ts` (conflict resolution)
- `src/main/cache/OfflineCache.ts` (local SQLite cache)
- `src/main/cache/PendingChanges.ts` (offline write queue)
- `src/main/config/AppConfig.ts` (config management)
- `src/renderer/src/services/pocketbase.ts` (renderer PB client)

- [ ] **Step 2: Rewrite stale sections**

Update these sections in `docs/architecture.md`:

- **Stack table** (~line 7): Remove "File Watching: Chokidar 5", add "Database: PocketBase (embedded SQLite)", add "SDK: pocketbase 0.26"
- **Data Handling section** (~lines 93-130): Replace JSON files/FileWatcher/DataCacheManager description with:
  - PocketBase embedded SQLite database
  - Renderer talks directly to PB REST API (not through IPC for data ops)
  - OfflineCache for local SQLite fallback
  - PendingChanges queue for offline writes
  - SyncManager for conflict resolution on reconnect
- **Storage Format** (~lines 98-109): Replace JSON file table with PB collections table (contacts, servers, bridge_groups, on_call, etc.)
- **Atomic Writes** (~lines 112-123): Replace fileLock description with PB ACID transactions + offline queue
- **File Watching** (~lines 125-127): Replace chokidar description with PB realtime subscriptions + cache invalidation
- **IPC Contracts** (~lines 133-168): Note that data CRUD bypasses IPC — renderer calls PB REST directly. IPC is now used only for window management, weather/location APIs, auth, clipboard, and setup.
- **Preload Bridge** (~lines 72-78): Update to reflect reduced IPC surface

Preserve all sections that are still accurate (security, logging, build targets, tab behaviors).

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: rewrite architecture.md for PocketBase architecture"
```

---

## Task 2: Rewrite SECURITY.md

**Files:**

- Modify: `docs/SECURITY.md`

- [ ] **Step 1: Read current file**

Read `docs/SECURITY.md`. Identify the File Locking and Atomic Operations subsections (~lines 120-135) that reference `fileLock.ts` and `FileManager.ts`.

- [ ] **Step 2: Update stale sections**

Replace the File Locking/Atomic Operations subsections with:

- PocketBase handles data integrity through SQLite ACID transactions
- Offline writes queued in PendingChanges (local SQLite)
- SyncManager handles conflict resolution on reconnect
- BackupManager creates PB API-based backups with retention

Preserve all other security sections (CSP, webview isolation, credential management, path validation, threat model).

- [ ] **Step 3: Commit**

```bash
git add docs/SECURITY.md
git commit -m "docs: update SECURITY.md storage model for PocketBase"
```

---

## Task 3: Rewrite AGENTS.md

**Files:**

- Modify: `docs/AGENTS.md`

- [ ] **Step 1: Read current file and source**

Read `docs/AGENTS.md` and scan the actual directory structure:

```bash
ls src/main/handlers/ src/main/pocketbase/ src/main/cache/ src/main/config/ src/main/migration/
ls src/renderer/src/services/ src/renderer/src/hooks/
```

- [ ] **Step 2: Near-total rewrite**

This file needs a near-total rewrite. Replace:

- **Overview** (~line 5): "JSON files" → "embedded PocketBase"
- **Business Logic** (~lines 33-42): Remove Operations pattern. Describe: renderer services call PB REST directly; main process handles PB lifecycle, auth, backup, sync
- **Data Flow diagram**: Replace with: Renderer → PB REST API → SQLite (server mode) or Renderer → PB REST → OfflineCache → PendingChanges → SyncManager (client mode)
- **Key Directories** (~lines 44-76): Update to current structure. Add `src/main/pocketbase/`, `src/main/cache/`, `src/main/config/`, `src/main/migration/`, `src/renderer/src/services/`
- **Operations Modules table** → Remove entirely. Replace with renderer services table (contactService, serverService, oncallService, etc.)
- **Handler Modules table** → Update to current handler list (cloudStatus/, authHandlers, weatherHandlers, etc.)
- **Adding a New Feature** (~lines 113-124): Rewrite for PB service pattern (create service file → create hook → wire to component)
- **Code Patterns** (~lines 128-260): Replace fileLock/readWithLock/modifyJsonWithLock examples with PB SDK patterns (`getPb().collection('x').create()`, `requireOnline()`, etc.)
- **Coverage thresholds**: Update to 80/80/75 for both suites

- [ ] **Step 3: Commit**

```bash
git add docs/AGENTS.md
git commit -m "docs: rewrite AGENTS.md for PocketBase architecture"
```

---

## Task 4: Rewrite DEVELOPMENT.md

**Files:**

- Modify: `docs/DEVELOPMENT.md`

- [ ] **Step 1: Read current file**

Read `docs/DEVELOPMENT.md`. Nearly every section before "Renderer Patterns" needs rewriting.

- [ ] **Step 2: Near-total rewrite of main process sections**

Replace:

- **Operations Pattern** (~lines 14-66): Replace with PB Service Pattern. Show how to create a new renderer service, call PB SDK, handle errors with `handleApiError`, use `requireOnline`.
- **IPC and Validation** (~lines 68-85): Keep Zod validation for remaining IPC channels. Note that data CRUD no longer uses IPC.
- **File I/O and Locking** (~lines 87-110): Remove entirely. Replace with section on PocketBase data access patterns.
- **File Watching** (~lines 112-130): Remove. Replace with PB realtime subscriptions section.
- **Data Cache** (~lines 132-152): Remove. Replace with OfflineCache + PendingChanges description.
- **Testing Operations** (~lines 274-308): Replace with testing PB services pattern (mock PB SDK, test CRUD + error handling).
- **Coverage thresholds** (~lines 269-272): Update to 80/80/75 for both suites.

Preserve: Renderer Patterns, Virtual Lists, DnD, Accessibility, CSS, Code Style sections.

- [ ] **Step 3: Commit**

```bash
git add docs/DEVELOPMENT.md
git commit -m "docs: rewrite DEVELOPMENT.md for PocketBase architecture"
```

---

## Task 5: Update README.md

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update stale lines**

- Line 9: Change "Local-first data model with atomic JSON writes and live file-watcher sync" to "Embedded PocketBase with offline-first cache and realtime sync"
- Lines 31-32: Change "file/data services" to "PocketBase services, offline cache"
- Coverage thresholds section (~lines 67-70): Update to 80/80/75 for both suites

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README.md for PocketBase architecture"
```

---

## Task 6: Move IMPLEMENTATION_SUMMARY.md to historical

**Files:**

- Move: `docs/IMPLEMENTATION_SUMMARY.md` → `docs/historical/IMPLEMENTATION_SUMMARY.md`

- [ ] **Step 1: Move the file**

```bash
mkdir -p docs/historical
git mv docs/IMPLEMENTATION_SUMMARY.md docs/historical/IMPLEMENTATION_SUMMARY.md
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: move IMPLEMENTATION_SUMMARY.md to docs/historical/"
```

---

## Task 7: Expand BackupManager tests

**Files:**

- Create: `src/main/pocketbase/BackupManager.test.ts`

- [ ] **Step 1: Read the source**

Read `src/main/pocketbase/BackupManager.ts` (70 lines). It has:

- `constructor(dataDir)` — creates backups directory
- `setPocketBase(pb)` — sets PB client
- `backup()` — creates timestamped backup via PB API, prunes old ones
- `pruneOldBackups()` — keeps max 10 backups
- `listBackups()` — returns sorted list with name/date/size

- [ ] **Step 2: Write tests**

Create `src/main/pocketbase/BackupManager.test.ts`. Mock `fs` and PocketBase. Test:

- Constructor creates backups directory
- `backup()` calls `pb.backups.create()` with timestamped name
- `backup()` returns null when no PB client set
- `backup()` returns null on PB API error
- `pruneOldBackups()` removes files beyond maxBackups (10)
- `listBackups()` returns empty array when dir doesn't exist
- `listBackups()` returns sorted list of .zip/.db files

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/main/pocketbase/BackupManager.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/main/pocketbase/BackupManager.test.ts
git commit -m "test: add BackupManager unit tests"
```

---

## Task 8: Expand RetentionManager tests

**Files:**

- Create: `src/main/pocketbase/RetentionManager.test.ts`

- [ ] **Step 1: Read the source**

Read `src/main/pocketbase/RetentionManager.ts` (108 lines). Understand its retention policy, cleanup methods, and scheduling.

- [ ] **Step 2: Write tests**

Mock filesystem operations. Test retention policy enforcement, age-based cleanup, and error handling.

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/main/pocketbase/RetentionManager.test.ts --reporter=verbose
git add src/main/pocketbase/RetentionManager.test.ts
git commit -m "test: add RetentionManager unit tests"
```

---

## Task 9: Expand PocketBaseProcess tests

**Files:**

- Modify: `src/main/pocketbase/PocketBaseProcess.test.ts`

- [ ] **Step 1: Read source and existing tests**

Read `src/main/pocketbase/PocketBaseProcess.ts` and `PocketBaseProcess.test.ts`. The existing test file is ~1.6KB — identify gaps.

- [ ] **Step 2: Add tests for**

- Process start with correct spawn args
- Process stop (graceful kill)
- Restart on crash (up to max restarts)
- `isRunning()` returns correct state
- `getUrl()` and `getLocalUrl()` format
- Port detection from stdout
- `onCrash()` callback invocation
- Platform-specific behavior (Windows vs Unix process management)

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/main/pocketbase/PocketBaseProcess.test.ts --reporter=verbose
git add src/main/pocketbase/PocketBaseProcess.test.ts
git commit -m "test: expand PocketBaseProcess test coverage"
```

---

## Task 10: Expand SyncManager tests

**Files:**

- Modify: `src/main/cache/SyncManager.test.ts`

- [ ] **Step 1: Read source and existing tests**

Read `src/main/cache/SyncManager.ts` and `SyncManager.test.ts`.

- [ ] **Step 2: Add tests for**

- `applyChange()` routing (create/update/delete)
- Conflict resolution when server record differs
- Multi-record sync batch
- Authentication check before sync
- Reauthentication flow
- Error handling for network failures
- Token expiry handling

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/main/cache/SyncManager.test.ts --reporter=verbose
git add src/main/cache/SyncManager.test.ts
git commit -m "test: expand SyncManager test coverage"
```

---

## Task 11: Expand OfflineCache tests

**Files:**

- Modify: `src/main/cache/OfflineCache.test.ts`

- [ ] **Step 1: Read source and existing tests**

Read `src/main/cache/OfflineCache.ts` and `OfflineCache.test.ts`.

- [ ] **Step 2: Add tests for**

- `writeCollection()` transactional write
- `readCollection()` returns parsed records
- `updateRecord()` for individual record updates
- `deleteRecord()` removes from cache
- Empty collection handling
- Database initialization (WAL mode)
- Schema version mismatch handling

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/main/cache/OfflineCache.test.ts --reporter=verbose
git add src/main/cache/OfflineCache.test.ts
git commit -m "test: expand OfflineCache test coverage"
```

---

## Task 12: Expand PendingChanges tests

**Files:**

- Modify: `src/main/cache/PendingChanges.test.ts`

- [ ] **Step 1: Read source and existing tests**

Read `src/main/cache/PendingChanges.ts` and `PendingChanges.test.ts`.

- [ ] **Step 2: Add tests for**

- `enqueue()` for create, update, delete actions
- `getAll()` returns ordered changes
- `remove()` deletes processed changes
- `clear()` empties the queue
- Queue ordering by timestamp
- Multiple changes to same record (coalescing or ordering)
- Database initialization

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/main/cache/PendingChanges.test.ts --reporter=verbose
git add src/main/cache/PendingChanges.test.ts
git commit -m "test: expand PendingChanges test coverage"
```

---

## Task 13: Expand AppConfig tests

**Files:**

- Modify: `src/main/config/AppConfig.test.ts`

- [ ] **Step 1: Read source and existing tests**

Read `src/main/config/AppConfig.ts` and `AppConfig.test.ts`.

- [ ] **Step 2: Add tests for**

- `load()` returns null when no config file
- `load()` parses valid config
- `save()` writes encrypted secret via safeStorage
- Mode switching (server ↔ client)
- `configPath` resolution from dataDir
- Invalid config file handling
- Missing fields in config

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/main/config/AppConfig.test.ts --reporter=verbose
git add src/main/config/AppConfig.test.ts
git commit -m "test: expand AppConfig test coverage"
```

---

## Task 14: Expand JsonMigrator tests

**Files:**

- Modify: `src/main/migration/JsonMigrator.test.ts`

- [ ] **Step 1: Read source and existing tests**

Read `src/main/migration/JsonMigrator.ts` (296 lines) and `JsonMigrator.test.ts` (89 lines).

- [ ] **Step 2: Add tests for**

- `transformContact()` maps legacy fields correctly
- `transformServer()` maps legacy fields correctly
- `transformOnCall()` handles schedule format
- `transformNotes()` handles per-entity notes
- `migrate()` creates backup before migration
- `migrateCollection()` handles batch processing (30-record batches)
- `migrateOncallLayout()` handles layout-specific data
- `hasLegacyData()` detects existing JSON files
- Partial migration recovery (some collections succeed, some fail)
- Error handling and logging

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/main/migration/JsonMigrator.test.ts --reporter=verbose
git add src/main/migration/JsonMigrator.test.ts
git commit -m "test: expand JsonMigrator test coverage"
```

---

## Task 15: Create migration guide

**Files:**

- Create: `docs/MIGRATION_GUIDE.md`

- [ ] **Step 1: Read JsonMigrator source**

Read `src/main/migration/JsonMigrator.ts` to understand the migration process.

- [ ] **Step 2: Write the guide**

Create `docs/MIGRATION_GUIDE.md` covering:

- **Overview**: JSON file storage → PocketBase embedded SQLite
- **When it happens**: Automatic on first launch with PB-enabled build
- **What migrates**: contacts, servers, bridge_groups, on_call, on_call_layout, bridge_history, alert_history, notes, saved_locations
- **Pre-migration**: Backup your data directory (copy `userData/data/`)
- **During migration**: App creates PB backup, migrates in 30-record batches, logs progress
- **Post-migration**: Verify data in app; old JSON files preserved in original location
- **Rollback**: Revert to pre-PB version; JSON files are untouched
- **Troubleshooting**: Check logs at `userData/logs/` for migration errors

- [ ] **Step 3: Commit**

```bash
git add docs/MIGRATION_GUIDE.md
git commit -m "docs: add JSON to PocketBase migration guide"
```

---

## Task 16: Create renderer service tests (contactService)

**Files:**

- Create: `src/renderer/src/services/contactService.test.ts`

This task establishes the test pattern for all renderer services. Subsequent service test tasks follow this pattern.

- [ ] **Step 1: Write tests**

Create `src/renderer/src/services/contactService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addContact,
  updateContact,
  deleteContact,
  findContactByEmail,
  bulkUpsertContacts,
} from './contactService';

// Mock the pocketbase module
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockGetFirstListItem = vi.fn();

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
      getFirstListItem: mockGetFirstListItem,
    }),
  }),
  handleApiError: vi.fn(),
  escapeFilter: (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
  requireOnline: vi.fn(),
}));

describe('contactService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addContact', () => {
    it('creates a contact via PB SDK', async () => {
      const input = { name: 'Alice', email: 'a@b.com', phone: '555', title: 'Eng' };
      const expected = { id: '1', ...input, created: '', updated: '' };
      mockCreate.mockResolvedValue(expected);

      const result = await addContact(input);
      expect(result).toEqual(expected);
      expect(mockCreate).toHaveBeenCalledWith(input);
    });

    it('throws and calls handleApiError on failure', async () => {
      mockCreate.mockRejectedValue(new Error('Network error'));
      await expect(addContact({ name: '', email: '', phone: '', title: '' })).rejects.toThrow();
    });
  });

  describe('updateContact', () => {
    it('updates a contact by ID', async () => {
      const updated = {
        id: '1',
        name: 'Bob',
        email: '',
        phone: '',
        title: '',
        created: '',
        updated: '',
      };
      mockUpdate.mockResolvedValue(updated);

      const result = await updateContact('1', { name: 'Bob' });
      expect(result).toEqual(updated);
      expect(mockUpdate).toHaveBeenCalledWith('1', { name: 'Bob' });
    });
  });

  describe('deleteContact', () => {
    it('deletes a contact by ID', async () => {
      mockDelete.mockResolvedValue(undefined);
      await deleteContact('1');
      expect(mockDelete).toHaveBeenCalledWith('1');
    });
  });

  describe('findContactByEmail', () => {
    it('returns contact when found', async () => {
      const contact = {
        id: '1',
        name: 'Alice',
        email: 'a@b.com',
        phone: '',
        title: '',
        created: '',
        updated: '',
      };
      mockGetFirstListItem.mockResolvedValue(contact);
      const result = await findContactByEmail('a@b.com');
      expect(result).toEqual(contact);
    });

    it('returns null on 404', async () => {
      const err = Object.assign(new Error('Not found'), { status: 404 });
      mockGetFirstListItem.mockRejectedValue(err);
      const result = await findContactByEmail('missing@b.com');
      expect(result).toBeNull();
    });
  });

  describe('bulkUpsertContacts', () => {
    it('creates new and updates existing contacts', async () => {
      const existing = {
        id: '1',
        name: 'Alice',
        email: 'a@b.com',
        phone: '',
        title: '',
        created: '',
        updated: '',
      };
      mockGetFirstListItem
        .mockResolvedValueOnce(existing) // first contact exists
        .mockRejectedValueOnce(Object.assign(new Error(''), { status: 404 })); // second is new

      mockUpdate.mockResolvedValue({ ...existing, name: 'Alice Updated' });
      mockCreate.mockResolvedValue({
        id: '2',
        name: 'Bob',
        email: 'b@b.com',
        phone: '',
        title: '',
        created: '',
        updated: '',
      });

      const result = await bulkUpsertContacts([
        { name: 'Alice Updated', email: 'a@b.com', phone: '', title: '' },
        { name: 'Bob', email: 'b@b.com', phone: '', title: '' },
      ]);
      expect(result).toHaveLength(2);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/renderer/src/services/contactService.test.ts --config vitest.renderer.config.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/services/contactService.test.ts
git commit -m "test: add contactService unit tests"
```

---

## Task 17: Create remaining renderer service tests

**Files:**

- Create: `src/renderer/src/services/serverService.test.ts`
- Create: `src/renderer/src/services/oncallService.test.ts`
- Create: `src/renderer/src/services/bridgeGroupService.test.ts`
- Create: `src/renderer/src/services/bridgeHistoryService.test.ts`
- Create: `src/renderer/src/services/alertHistoryService.test.ts`
- Create: `src/renderer/src/services/notesService.test.ts`
- Create: `src/renderer/src/services/savedLocationService.test.ts`
- Create: `src/renderer/src/services/oncallLayoutService.test.ts`
- Create: `src/renderer/src/services/importExportService.test.ts`

- [ ] **Step 1: Read each service file**

Each service follows the same pattern as contactService: exports CRUD functions that call `getPb().collection('x').create/update/delete()`, wrapped in try/catch with `handleApiError`.

Read each service to understand its specific functions and types.

- [ ] **Step 2: Write tests for each service**

Follow the pattern established in Task 16. For each service:

1. Mock `./pocketbase` with `getPb`, `handleApiError`, `requireOnline`, `escapeFilter`
2. Test each exported CRUD function
3. Test error handling (network failure → handleApiError called, error rethrown)
4. Test any special behavior (e.g., `importExportService` has Excel/CSV handling)

For `importExportService.test.ts`, also mock `exceljs` since it handles Excel import/export.

- [ ] **Step 3: Run all service tests**

```bash
npx vitest run src/renderer/src/services/ --config vitest.renderer.config.ts --reporter=verbose
```

- [ ] **Step 4: Commit all at once**

```bash
git add src/renderer/src/services/*.test.ts
git commit -m "test: add unit tests for all renderer PocketBase services"
```

---

## Task 18: CSS audit

**Files:**

- Create: `docs/superpowers/reports/2026-03-23-unused-css-audit.md`

- [ ] **Step 1: Extract class names from CSS**

```bash
grep -oP '\.[a-zA-Z_-][a-zA-Z0-9_-]*' src/renderer/src/styles/components.css | sort -u > /tmp/css-classes.txt
wc -l /tmp/css-classes.txt
```

- [ ] **Step 2: Check each class against TSX files**

For each class in the list, check if it appears in any `.tsx` file:

```bash
while read cls; do
  name="${cls#.}"
  if ! grep -rq "$name" src/renderer/src/ --include="*.tsx" --include="*.ts"; then
    echo "$cls"
  fi
done < /tmp/css-classes.txt > /tmp/unused-classes.txt
wc -l /tmp/unused-classes.txt
```

- [ ] **Step 3: Write the report**

Create `docs/superpowers/reports/2026-03-23-unused-css-audit.md` with:

- Total classes found
- Unused classes with their line numbers in components.css
- Note: Review visually before removing — some classes may be dynamically constructed

- [ ] **Step 4: Commit**

```bash
mkdir -p docs/superpowers/reports
git add docs/superpowers/reports/2026-03-23-unused-css-audit.md
git commit -m "docs: add unused CSS audit report"
```

---

## Task 19: Dependency audit (csv-parse)

**Files:**

- Possibly modify: `package.json`

- [ ] **Step 1: Check usage**

```bash
grep -r "csv-parse" src/ --include="*.ts" --include="*.tsx"
grep -r "csv-parse" package.json
```

- [ ] **Step 2: If unused, remove**

```bash
npm uninstall csv-parse
```

- [ ] **Step 3: Run tests to verify nothing breaks**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
npx vitest run --config vitest.renderer.config.ts --reporter=verbose 2>&1 | tail -30
```

- [ ] **Step 4: Commit (only if changed)**

```bash
git add package.json package-lock.json
git commit -m "chore: remove unused csv-parse dependency"
```

---

## Task 20: Final verification

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Full test suite (both configs)**

```bash
npx vitest run --reporter=verbose
npx vitest run --config vitest.renderer.config.ts --reporter=verbose
```

Expected: All tests pass

- [ ] **Step 3: Lint check**

Run: `npx eslint src/ --max-warnings=0 2>&1 | tail -30`

- [ ] **Step 4: Verify no stale references remain**

```bash
grep -r "FileManager\|FileWatcher\|DataCacheManager\|readWithLock\|modifyJsonWithLock\|fileLock" docs/ README.md --include="*.md" -l
```

Expected: No matches (except docs/historical/)

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: Phase 2 cleanup verification pass"
```
