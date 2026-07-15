# Managed Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Invoke `superpowers:test-driven-development` before each production change and `superpowers:verification-before-completion` before each completion claim. Use `impeccable` for the management workspace UI pass.

**Goal:** Replace Relay's server-folder watcher with a managed, audited Knowledge Base where the designated publisher or administrator can add, validate, publish, replace, organize, trash, restore, and permanently delete PDFs from a paired work laptop or the server PC while every operator keeps the current read-only Focus Reader.

**Architecture:** The existing protected `knowledge_documents` collection remains the live library and stable source of reader metadata/PDFs. A privileged laptop selects local PDFs through Electron main process, uploads them with the separate privileged PocketBase client into a protected staging collection, and submits a signed validation/publication command. The server repeats all validation and extraction, promotes only reviewed ready uploads, and records every outcome through an idempotent mutation coordinator. Active document records continue over the existing realtime/offline metadata pipeline; trashed records, staging, audit, and management commands remain behind the privileged server boundary. A one-time migration imports the existing watched-folder state and then permanently switches authority to managed mode without deleting source files.

**Tech Stack:** Electron 42, TypeScript 6, React 19, PocketBase SDK 0.26.8, PDF.js 5.4.624, Node worker threads/crypto/filesystem, Zod 4, Vitest, Testing Library, Playwright.

**Dependencies:** Complete and verify both `docs/superpowers/plans/2026-07-15-privileged-access-foundation.md` and `docs/superpowers/plans/2026-07-15-remote-operator-administration.md` first. Reuse their session, capability, paired-device, signed-command, operator attribution, current-revision, and reauthentication boundaries.

## Global Constraints

- Preserve the existing Focus Reader, category/document/heading tree, PDF.js renderer, relative-PDF-link resolution, external web links, realtime metadata updates, on-demand PDF cache, and disconnected read-only behavior.
- Preserve original PDF filenames. Relay display-title changes do not rename stored filenames or authored link targets.
- Management requires a live server, a selected operator matching the active privileged account, and `knowledge.manage`. It never enters the ordinary offline mutation queue.
- Administrator and designated publisher can perform every Knowledge Base action. No other operator can see or invoke management actions.
- PDF selection happens in Electron main process. Renderer state, logs, audit, commands, and responses never contain local filesystem paths or raw PDF bytes.
- The server repeats signature, extension, `%PDF-` signature, containment, size, checksum, encryption, page-count, extraction-timeout, metadata, outline, title, and category validation.
- Maximum PDF size remains 50 MiB; maximum page count 1,000; extraction timeout 30 seconds; outline cap 500; category length 120; title/filename length 240.
- Upload alone never publishes. A ready upload requires explicit `Publish` or `Replace`.
- Mutable targets use expected revisions. Request IDs make retry after disconnect idempotent.
- Trashed documents have no automatic purge. Permanent delete requires fresh password re-entry. Audit remains append-only and retained for at least one year.
- The managed authority switch never deletes, renames, or writes into the legacy `knowledge-base` source folder.
- Keep ordinary app-user access limited to active document records and protected active PDFs. Staging, trash, audit, and management state never enter ordinary cache snapshots.

---

## File Structure

### Shared contracts

- Extend `src/shared/knowledge.ts` with managed fields, upload/audit/library-state types, management snapshots, actions, validation results, and normalizers.
- Extend `src/shared/privilegedCommands.ts` with paginated Knowledge management reads and mutation payload/result entries.
- Extend `src/shared/ipc.ts` and `src/shared/ipcValidation.ts` with a narrow file-picker/staging bridge; keep paths and bytes main-process-only.
- Add focused tests under `src/shared/__tests__/`.

### Main process

- Extend `src/main/pocketbase/CollectionBootstrap.ts` with managed document fields and `knowledge_uploads`, `knowledge_audit_events`, and `knowledge_library_state`.
- Create `src/main/knowledge/ManagedKnowledgeMigration.ts` for the one-time watcher-to-managed transition.
- Create `src/main/knowledge/KnowledgeUploadService.ts` for local file selection, privileged staging upload, validation request, and safe progress.
- Create `src/main/knowledge/ManagedKnowledgeService.ts` for listing and document/category lifecycle operations.
- Create `src/main/knowledge/KnowledgeMutationCoordinator.ts` for idempotent ordered mutation/audit recovery.
- Create `src/main/knowledge/KnowledgeManagementCleanup.ts` for 24-hour staging cleanup, audit retention, and command recovery.
- Create `src/main/knowledge/registerKnowledgeManagementCommands.ts` to register handlers with `PrivilegedCommandProcessor`.
- Update `src/main/knowledge/knowledgeRuntime.ts`, `src/main/knowledge/KnowledgeBaseManager.ts`, `src/main/knowledge/KnowledgePdfService.ts`, app lifecycle, backups, retention, and cache allowlists.

### Preload and renderer

- Add only safe upload-selection/progress methods to `src/preload/index.ts`; all other management reads/mutations use signed commands.
- Create `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx`.
- Create `src/renderer/src/features/knowledge/management/` components for Documents, Uploads, Trash, Audit, dialogs, drawers, and responsive rows.
- Create `src/renderer/src/features/knowledge/useKnowledgeManagement.ts` for session/capability gating, paginated reads, signed mutations, retries, and conflict refresh.
- Extend `src/renderer/src/features/knowledge/KnowledgeTab.tsx` and `knowledge.css` with the management entry/exit and compact layout.

### Documentation

- Update `docs/architecture.md` and `docs/SECURITY.md` with managed authority, staging, server revalidation, lifecycle, relative links, offline behavior, recovery, audit, and retention.

---

## Task 1: Extend Managed Knowledge Contracts Without Breaking Readers

**Files:**

- Modify: `src/shared/knowledge.ts`
- Modify: `src/shared/knowledge.test.ts`
- Modify: `src/renderer/src/features/knowledge/knowledgeModel.ts`
- Modify: `src/renderer/src/features/knowledge/__tests__/knowledgeModel.test.ts`

- [ ] Add failing tests that normalize legacy records without managed fields, normalize active/trashed managed records, prefer `displayTitle` over legacy `title`, reject invalid revisions/lifecycle values, preserve original filenames, and exclude trashed rows from the reader model as defense in depth.
- [ ] Run `npx vitest run src/shared/knowledge.test.ts src/renderer/src/features/knowledge/__tests__/knowledgeModel.test.ts` and confirm RED at the missing fields/behavior.
- [ ] Extend the existing record non-destructively:

```ts
export type KnowledgeLifecycleState = 'active' | 'trashed';

export type ManagedKnowledgeFields = {
  lifecycleState: KnowledgeLifecycleState;
  displayTitle: string;
  revision: number;
  publishedByOperatorId: string;
  publishedByName: string;
  publishedAt: string;
  trashedByOperatorId: string | null;
  trashedByName: string | null;
  trashedAt: string | null;
};
```

- [ ] For pre-migration records, normalize `lifecycleState` as `active`, `displayTitle` from `title`, and `revision` as `1` without weakening bounds.
- [ ] Update document comparison/search/tree labels to use `displayTitle`; keep `title` as the fallback compatibility field until the migration has patched every record.
- [ ] Define `KnowledgeUploadView`, `KnowledgeAuditEventView`, `KnowledgeManagementDocumentView`, paginated result types, safe error codes, and library mode `legacy-watch | migrating | managed | recovery-required`.
- [ ] Rerun the preceding focused command, then run `npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(knowledge): define managed library records`.

## Task 2: Bootstrap Managed Collections and Active-Only Reader Rules

**Files:**

- Modify: `src/main/pocketbase/CollectionBootstrap.ts`
- Modify: `src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`
- Modify: `src/main/handlers/cacheHandlers.ts`
- Modify: `src/main/handlers/cacheHandlers.test.ts`

- [ ] Add failing bootstrap tests for every managed document field, legacy-safe defaults, active-only ordinary list/view rules, protected staging files, unique upload request IDs, append-only server-owned audit, singleton library state, and non-destructive patching.
- [ ] Add failing cache tests proving active `knowledge_documents` metadata remains cacheable/read-only while staging, audit, library state, privileged commands, and trashed records cannot be snapshotted or queued for mutation.
- [ ] Run `npx vitest run src/main/pocketbase/__tests__/CollectionBootstrap.test.ts src/main/handlers/cacheHandlers.test.ts` and confirm RED at the new schema/rule assertions.
- [ ] Extend `knowledge_documents` with the managed fields and a lifecycle index. Set ordinary authenticated rules to active records only:

```ts
const ACTIVE_KNOWLEDGE_RULE =
  '@request.auth.id != "" && lifecycleState = "active"';
```

- [ ] Add `knowledge_uploads` with protected single PDF, account/device/operator attribution, checksum/size/extraction fields, proposed metadata, state, safe error, expiry, and revision. Permit only the authenticated privileged account to create/view its own staging record; keep updates/promotion/deletion server-only.
- [ ] Add server-owned `knowledge_audit_events` and `knowledge_library_state`. Audit has no client create/update/delete rules; state uses a unique `key = "primary"` index.
- [ ] Do not expose trash/audit/staging through ordinary PocketBase collections or `VALID_COLLECTIONS`; privileged server commands page them.
- [ ] Rerun the preceding focused command, then run `npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(knowledge): bootstrap managed collections`.

## Task 3: Migrate the Watched Library to Managed Authority Once

**Files:**

- Create: `src/main/knowledge/ManagedKnowledgeMigration.ts`
- Create: `src/main/knowledge/__tests__/ManagedKnowledgeMigration.test.ts`
- Modify: `src/main/knowledge/knowledgeRuntime.ts`
- Modify: `src/main/knowledge/knowledgeRuntime.test.ts`
- Modify: `src/main/knowledge/KnowledgeBaseManager.ts`
- Modify: `src/main/app/runtimeReconfigure.ts`
- Modify: `src/main/app/__tests__/runtimeReconfigure.test.ts`

- [ ] Add failing tests for empty/new installs, existing mirrored records, a healthy final folder scan, an unavailable legacy folder, interrupted `migrating` state, idempotent restart, field backfill, no duplicate PDFs, and no legacy source deletion/write.
- [ ] Run `npx vitest run src/main/knowledge/__tests__/ManagedKnowledgeMigration.test.ts src/main/knowledge/knowledgeRuntime.test.ts src/main/app/__tests__/runtimeReconfigure.test.ts` and confirm RED because managed mode does not exist.
- [ ] Implement this state transition:

```text
legacy-watch -> migrating -> managed
                     `-----> recovery-required
```

- [ ] On an unset/new install, run the existing index manager through one healthy reconciliation, backfill managed fields on current records without changing IDs/checksums/files, then set mode to `managed` only after verification.
- [ ] If the source root is unreadable and live records already exist, preserve them and permit an explicit local-admin `Adopt current library` recovery action. If both root and records are absent, initialize an empty managed library.
- [ ] Once `managed`, do not start the filesystem watcher or fallback reconciliation interval. Start managed cleanup/recovery services instead.
- [ ] Never auto-return to legacy mode, never delete source files, and never infer publication from future folder changes.
- [ ] Keep `KnowledgePdfService` and active metadata cache behavior unchanged.
- [ ] Rerun the preceding focused command, then run `npm run typecheck && npm run build`; confirm all exit 0.
- [ ] Commit with `feat(knowledge): adopt managed library authority`.

## Task 4: Stage PDFs From a Server or Paired Laptop Safely

**Files:**

- Create: `src/main/knowledge/KnowledgeUploadService.ts`
- Create: `src/main/knowledge/__tests__/KnowledgeUploadService.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Modify: `src/shared/ipcValidation.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.test.ts`
- Modify: `src/main/handlers/knowledgeHandlers.ts`
- Modify: `src/main/handlers/knowledgeHandlers.test.ts`
- Modify: `src/main/ipcHandlers.ts`

- [ ] Add failing service tests for multi-select, cancel, `.pdf` filtering, symlink rejection, file size/signature precheck, sequential bounded upload, privileged-client use, selected-operator/account match, safe progress, individual failure isolation, and path/byte redaction.
- [ ] Add failing IPC/preload tests proving the renderer can request selection/staging and subscribe to safe progress but cannot pass a path, read arbitrary bytes, choose a destination, or receive a local path.
- [ ] Run `npx vitest run src/main/knowledge/__tests__/KnowledgeUploadService.test.ts src/shared/ipcValidation.test.ts src/preload/index.test.ts src/main/handlers/knowledgeHandlers.test.ts` and confirm RED at the absent service/bridge.
- [ ] Implement a main-process file picker with `properties: ['openFile', 'multiSelections']` and a PDF filter. Keep returned paths inside the main-process service only.
- [ ] Define the renderer-safe result:

```ts
export type KnowledgeUploadSelectionResult =
  | { ok: true; uploads: KnowledgeUploadView[] }
  | { ok: false; error: 'cancelled' | 'offline' | 'unauthorized' | 'invalid-file' | 'upload-failed' };
```

- [ ] Use the separate active privileged PocketBase client to create each protected staging record. Upload a `Blob`/`FormData` from the selected local file; do not use the shared app-user client.
- [ ] Before upload, create/sign a request descriptor binding request ID, file name, preliminary checksum/size, account, device, and operator. After staging, submit `knowledge.upload.validate` referencing the staging ID and same request ID.
- [ ] Send only safe states (`queued`, `uploading`, `validating`, `extracting`, `ready`, `failed`) plus filename/size/progress/error code to the renderer.
- [ ] Rerun the preceding focused command, then run `npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(knowledge): stage PDFs from clients`.

## Task 5: Revalidate and Extract Every Staged PDF on the Server

**Files:**

- Create: `src/main/knowledge/registerKnowledgeManagementCommands.ts`
- Create: `src/main/knowledge/__tests__/registerKnowledgeManagementCommands.test.ts`
- Modify: `src/main/knowledge/KnowledgeExtractorWorker.ts`
- Modify: `src/main/knowledge/KnowledgeExtractorWorker.test.ts`
- Modify: `src/shared/privilegedCommands.ts`
- Modify: `src/shared/__tests__/privilegedCommands.test.ts`

- [ ] Add failing command tests for `knowledge.upload.validate`, account/device/operator binding, current publisher/admin role, staging ownership, signed descriptor match, server checksum repeat, size/signature/encryption/page/timeout/outline limits, duplicate warnings, safe error mapping, and one bad upload not blocking others.
- [ ] Run `npx vitest run src/main/knowledge/__tests__/registerKnowledgeManagementCommands.test.ts src/main/knowledge/KnowledgeExtractorWorker.test.ts src/shared/__tests__/privilegedCommands.test.ts` and confirm RED at the missing command path.
- [ ] Add exact Knowledge commands:

```ts
type KnowledgeCommandPayloads = {
  'knowledge.snapshot.read': { query: string; cursor: string | null; pageSize: number };
  'knowledge.upload.validate': { uploadId: string; preliminaryChecksum: string };
  'knowledge.document.publish': { uploadId: string; title: string; category: string };
  'knowledge.document.replace': {
    uploadId: string;
    documentId: string;
    expectedRevision: number;
    title: string;
    category: string;
  };
  'knowledge.document.title.set': { documentId: string; title: string; expectedRevision: number };
  'knowledge.document.category.set': {
    documentId: string;
    category: string;
    expectedRevision: number;
  };
  'knowledge.category.rename': {
    from: string;
    to: string;
    expectedDocumentRevisions: Record<string, number>;
  };
  'knowledge.document.trash': { documentId: string; expectedRevision: number };
  'knowledge.document.restore': { documentId: string; expectedRevision: number };
  'knowledge.document.delete': {
    documentId: string;
    expectedRevision: number;
    reauthRequestId: string;
  };
  'knowledge.audit.read': { cursor: string | null; pageSize: number; targetId: string | null };
};
```

- [ ] The server downloads/reads the protected staging file itself and repeats the existing extraction pipeline with evaluation disabled, 30-second timeout, 1,000-page cap, and bounded outline.
- [ ] Update staging state to `ready` only after validation succeeds. Populate proposed metadata and duplicate/replacement warnings; never automatically publish.
- [ ] Unsafe/invalid files receive a safe error and may have staging bytes removed immediately. Recoverable extraction/server errors retain bytes until expiry for retry.
- [ ] Rerun the preceding focused command, then run `npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(knowledge): validate staged PDFs`.

## Task 6: Coordinate Publish, Replace, Organize, Trash, Restore, and Delete

**Files:**

- Create: `src/main/knowledge/ManagedKnowledgeService.ts`
- Create: `src/main/knowledge/KnowledgeMutationCoordinator.ts`
- Create: `src/main/knowledge/__tests__/ManagedKnowledgeService.test.ts`
- Create: `src/main/knowledge/__tests__/KnowledgeMutationCoordinator.test.ts`
- Modify: `src/main/knowledge/registerKnowledgeManagementCommands.ts`
- Modify: `src/main/knowledge/__tests__/registerKnowledgeManagementCommands.test.ts`

- [ ] Add failing tests for new publish, stable-ID replacement, original-filename retention, title-only rename, category/source-key move, category batch rename, duplicate filename conflicts, trash, restore conflicts, permanent delete, operator/name snapshots, current revisions, signed replay, and capability matrix.
- [ ] Add failure/restart tests for command claimed before mutation, mutation before audit, audit before command completion, duplicate retry, lost client response, and deterministic reconciliation.
- [ ] Run `npx vitest run src/main/knowledge/__tests__/ManagedKnowledgeService.test.ts src/main/knowledge/__tests__/KnowledgeMutationCoordinator.test.ts src/main/knowledge/__tests__/registerKnowledgeManagementCommands.test.ts` and confirm RED because the services/coordinator are absent.
- [ ] Implement `ManagedKnowledgeService` with PocketBase superuser authority and no renderer/PocketBase-client access. Every operation rechecks role, upload/document state, expected revision, title/category bounds, and link-relevant filename conflicts immediately before mutation.
- [ ] New publish creates one active protected record using validated staging metadata and publisher attribution. Replace updates the same record ID and original `fileName`, changes protected bytes/checksum/page/outline/published fields, and increments revision only after file update succeeds.
- [ ] Title changes update `displayTitle` only. Category moves keep document ID, PDF, checksum, and original filename; update logical category/source key and revision.
- [ ] Trash sets lifecycle/attribution/timestamp and removes the record from ordinary readers through the active-only rule. Restore clears trash fields after conflict checks.
- [ ] Permanent delete consumes a fresh reauthentication proof and records the command's final metadata/checksum before deletion. A reconciler completes audit/command state after crashes; the UI receives success only after authoritative mutation and audit completion.
- [ ] `KnowledgeMutationCoordinator` uses the existing unique request ID record as the durable saga: `claimed -> mutating -> auditing -> completed` or `reconciliation-required`. Never execute a completed request twice.
- [ ] Rerun the preceding focused command, then run `npm run typecheck`; confirm all exit 0.
- [ ] Commit with `feat(knowledge): manage document lifecycle`.

## Task 7: Add Staging Cleanup, Audit Retention, and Backup Recovery

**Files:**

- Create: `src/main/knowledge/KnowledgeManagementCleanup.ts`
- Create: `src/main/knowledge/__tests__/KnowledgeManagementCleanup.test.ts`
- Modify: `src/main/knowledge/knowledgeRuntime.ts`
- Modify: `src/main/knowledge/knowledgeRuntime.test.ts`
- Modify: `src/main/app/maintenanceTasks.ts`
- Modify: `src/main/app/maintenanceTasks.test.ts`
- Modify: `src/main/pocketbase/BackupManager.ts`
- Modify: `src/main/pocketbase/BackupManager.test.ts`
- Modify: `src/main/pocketbase/RetentionManager.ts`
- Modify: `src/main/pocketbase/RetentionManager.test.ts`

- [ ] Add fake-clock tests for unpublished upload expiry at 24 hours, successful cleanup audit, active publication immunity, failed cleanup retry, no automatic trash purge, minimum one-year audit retention, backup prerequisite before older audit deletion, and command reconciliation.
- [ ] Add backup/restore tests for active/trashed PDFs, staging within expiry, outlines, accounts, role assignment, device public keys, command states, and audit history; private device keys must not appear.
- [ ] Run `npx vitest run src/main/knowledge/__tests__/KnowledgeManagementCleanup.test.ts src/main/knowledge/knowledgeRuntime.test.ts src/main/app/maintenanceTasks.test.ts src/main/pocketbase/BackupManager.test.ts src/main/pocketbase/RetentionManager.test.ts` and confirm RED at the new retention/recovery assertions.
- [ ] Integrate cleanup into the existing maintenance schedule rather than adding an unbounded interval. Cleanup must be single-flight and stop on reconfigure/shutdown.
- [ ] Retain audit for at least 365 days. Delete older audit only when an explicit retention setting permits it and the latest backup completed successfully after those records were created.
- [ ] After restore, set library state to `recovery-required`, reconcile `processing` commands by request ID, verify collection/file integrity, and require administrator reauthentication before management resumes. Read-only active documents remain available when integrity checks pass.
- [ ] Rerun the preceding focused command, then run `npm run typecheck && npm run build`; confirm all exit 0.
- [ ] Commit with `feat(knowledge): retain and recover managed data`.

## Task 8: Build the Dedicated Management Workspace

**Files:**

- Create: `src/renderer/src/features/knowledge/useKnowledgeManagement.ts`
- Create: `src/renderer/src/features/knowledge/useKnowledgeManagement.test.tsx`
- Create: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx`
- Create: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.test.tsx`
- Create: `src/renderer/src/features/knowledge/management/KnowledgeDocumentsView.tsx`
- Create: `src/renderer/src/features/knowledge/management/KnowledgeUploadsView.tsx`
- Create: `src/renderer/src/features/knowledge/management/KnowledgeTrashView.tsx`
- Create: `src/renderer/src/features/knowledge/management/KnowledgeAuditView.tsx`
- Create: `src/renderer/src/features/knowledge/management/KnowledgeManagementDialogs.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgeTab.tsx`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx`
- Modify: `src/renderer/src/features/knowledge/knowledge.css`

- [ ] Use `impeccable` to audit the approved dedicated-workspace mockup against current Relay tokens, typography, density, focus states, and half-width behavior before editing components.
- [ ] Add failing hook tests for capability/selected-operator matching, online-only entry, snapshot paging, upload progress, request-result recovery, conflict refresh, session lock, exit-to-reader, and cached reader preservation.
- [ ] Add failing UI tests for `Manage library` visibility, authentication prompt, Documents/Uploads/Trash/Audit navigation, multi-file queue, heading preview, explicit publish/replace, title/category actions, destructive confirmations, reauthentication, safe errors, audit paging, keyboard navigation, live regions, and focus restoration.
- [ ] Run `npx vitest run src/renderer/src/features/knowledge/useKnowledgeManagement.test.tsx src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx` and confirm RED at the new management workspace.
- [ ] Keep `KnowledgeTab` as the normal reader. Show `Manage library` only when selected operator ID matches the active admin/publisher account; enforce the same condition again on the server.
- [ ] Implement four top-level management views. Documents has search/category rail and compact rows; Uploads shows the validation pipeline and editable proposed title/category; Trash has restore/permanent delete; Audit is read-only, paginated, and filterable.
- [ ] Preserve `Open in reader` by exiting management and routing through `requestKnowledgeDocumentOpen(documentId, headingId)`.
- [ ] At half of a 1080p display, convert the category rail to a drawer, stack document row metadata, retain page title/session/upload action, use bounded panel scrolling, hide the global clock through the existing breakpoint, and keep every confirmation/action inside the visible panel.
- [ ] Use color plus text/icon: active red where Relay currently uses active severity, addressed/local blue conventions where relevant, ready/published green, warnings amber, and destructive actions clearly labeled. Do not rely on color alone.
- [ ] Rerun the preceding focused command, then run `npm run typecheck && npm run build`; confirm all exit 0.
- [ ] Commit with `feat(knowledge): add management workspace`.

## Task 9: Verify Realtime, Offline Reader, Links, and Full Lifecycle

**Files:**

- Modify: `tests/e2e/critical-path.spec.ts`
- Modify: `tests/fixtures/knowledgePdfFixtures.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/SECURITY.md`

- [ ] Add deterministic E2E PDFs with native headings, inferred headings, no outline, same-document links, category-relative PDF links, duplicate filename cases, and HTTPS web links.
- [ ] Add E2E flows from a paired client for multi-select stage, validation, publish, reader realtime appearance, display-title change, category move, replacement with stable ID/original filename, trash realtime removal, restore, permanent delete reauthentication, audit entries, and one invalid upload alongside valid uploads.
- [ ] Add disconnected-client coverage proving already-snapshotted active metadata and cached PDFs remain readable, management exits/locks when offline, no privileged mutation queues, server-completed request results recover after reconnect, and newest active library state reconciles without duplicate commands.
- [ ] Add link regression coverage proving display-title changes do not break filename-relative links, uniquely named targets survive category moves, ambiguous filenames remain blocked, category-qualified paths follow the documented category name, and HTTPS web links open through the existing safe system-browser handler.
- [ ] Run `npm run test:electron -- --grep "managed knowledge base"` and confirm RED at the first unimplemented flow before adding only the necessary fixture/test hooks.
- [ ] Document authoring syntax (`Other Guide.pdf`, `../Category/Other Guide.pdf`, `Other Guide.pdf#page=3`, and HTTPS links), managed authority, staging, validation, audit, retention, backup, recovery, and offline limits.
- [ ] Run the complete gates:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:electron
npm run build
```

- [ ] Confirm every command exits 0, run `git diff --check`, inspect the production renderer bundle for paths/secrets, and manually resize the server and client windows to roughly half of 1920x1080.
- [ ] Commit with `docs(knowledge): document managed publishing`.

## Plan Completion Checklist

- [ ] Search changed files for `TODO|TBD|FIXME|placeholder|appropriate error handling|write tests for above` and resolve every introduced match.
- [ ] Verify every mutation has a typed command, capability check, selected-operator/account match, expected revision, idempotent request ID, safe result, and audit outcome.
- [ ] Verify active reader metadata is the only managed Knowledge collection in ordinary cache snapshots; staging, trash, audit, library state, and privileged commands remain excluded.
- [ ] Verify local paths, PDF bytes, passwords, tokens, private keys, secret values, full PDF text, and raw exceptions never enter renderer state, logs, command results, or audit details.
- [ ] Verify the legacy watched folder is untouched after the managed authority switch and never resumes automatically.
- [ ] Verify normal reader, relative/web links, realtime sync, offline reading, client/server reconfigure, and backup/restore regressions all pass.
- [ ] Invoke `superpowers:requesting-code-review`, address accepted findings with `superpowers:receiving-code-review`, then invoke `superpowers:verification-before-completion` before declaring this phase complete.
