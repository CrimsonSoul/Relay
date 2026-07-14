# Read-Only PDF Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Relay's approved read-only Focus Reader Knowledge tab, with server-side filesystem ingestion, locally extracted PDF headings, realtime LAN metadata synchronization, protected PDF transport, and on-demand offline client caching.

**Architecture:** The server owns a `knowledge-base` source folder and a single-concurrency `KnowledgeBaseManager` that validates, hashes, parses, and mirrors PDFs into a server-owned PocketBase collection. Metadata follows Relay's existing collection-store and SQLite cache path; PDF bytes move only through a trusted, typed main-process IPC service backed by validated server files or a content-addressed client cache. The renderer uses bundled PDF.js canvas/text layers and a focused category/document/outline tree without edit controls.

**Tech Stack:** Electron 42, TypeScript 6, React 19, PocketBase 0.26, PDF.js (`pdfjs-dist` 5.4.624), Node worker threads, Vitest, Testing Library, Playwright, electron-vite/Vite.

## Global Constraints

- Preserve Relay's current server/client authentication, discovery, presence, realtime, reconnect, and centralized `initializeClientOfflineInfrastructure` path.
- Keep all document parsing, transport, storage, and rendering on the Relay server/client LAN path. Do not add external requests, telemetry, OCR, or cloud processing.
- Keep the feature read-only in the renderer and out of `WRITABLE_CACHE_COLLECTIONS` and the offline mutation queue.
- Do not weaken `object-src 'none'`, sandboxing, context isolation, Node isolation, trusted-sender checks, navigation lockdown, or URL policy.
- Use test-driven development for each behavior: add the focused failing test, confirm the expected failure, implement the smallest production change, and rerun the focused test.
- Use `apply_patch` for source edits. Preserve unrelated worktree changes.
- Commit each coherent task after its focused tests pass. Run the complete regression gate before claiming completion.

---

## File Structure

### Shared contracts

- Create `src/shared/knowledge.ts` for collection constants, limits, record/outline/index-status/PDF-result types, record normalization, search normalization, and sort helpers.
- Update `src/shared/ipc.ts` for `Knowledge` navigation, narrow bridge methods, and IPC channels.
- Update `src/shared/ipcValidation.ts` for strict document-ID and checksum request validation.
- Create `src/shared/__tests__/knowledge.test.ts` and extend `src/shared/__tests__/ipcValidation.test.ts`.

### Main process

- Create `src/main/knowledge/knowledgePathSafety.ts` for source discovery, category derivation, symlink/traversal/signature/size checks, and healthy-scan results.
- Create `src/main/knowledge/knowledgeOutline.ts` for native outline normalization and deterministic text-layer heading inference.
- Create `src/main/knowledge/knowledgeExtractor.ts` for PDF.js metadata/page/outline extraction.
- Create `src/main/knowledge/knowledgeExtractor.worker.ts` as the worker-thread entry point.
- Create `src/main/knowledge/KnowledgeExtractorWorker.ts` for the single-concurrency worker client, timeout, termination, and error mapping.
- Create `src/main/knowledge/KnowledgeBaseManager.ts` for startup scan, watcher debounce, reconciliation, deletion guard, and PocketBase upserts.
- Create `src/main/knowledge/KnowledgePdfService.ts` for server reads, authenticated client downloads, checksum validation, atomic cache writes, LRU cleanup, and typed IPC results.
- Create `src/main/handlers/knowledgeHandlers.ts` for trusted, validated PDF/status IPC.
- Add focused tests under `src/main/knowledge/__tests__/` and `src/main/handlers/knowledgeHandlers.test.ts`.
- Update `src/main/pocketbase/CollectionBootstrap.ts`, `src/main/handlers/cacheHandlers.ts`, `src/main/ipcHandlers.ts`, `src/main/app/appState.ts`, `src/main/app/pocketbaseBootstrap.ts`, `src/main/app/runtimeReconfigure.ts`, `src/main/app/maintenanceTasks.ts`, and `src/main/index.ts` for lifecycle integration.
- Update `electron.vite.config.ts` so the parser worker is emitted as `dist/main/knowledgeExtractorWorker.js`.

### Preload and renderer

- Update `src/preload/index.ts` with only `getKnowledgePdf()` and `getKnowledgeIndexStatus()`.
- Create `src/renderer/src/services/knowledgeService.ts` for the read-only `CollectionStore` binding.
- Create `src/renderer/src/tabs/knowledge/knowledgeModel.ts` for grouped/searchable view data.
- Create `src/renderer/src/tabs/knowledge/useKnowledgeLibrary.ts` for metadata subscription and selection/realtime reconciliation.
- Create `src/renderer/src/tabs/knowledge/KnowledgeTree.tsx` for accessible category/document/heading navigation.
- Create `src/renderer/src/tabs/knowledge/KnowledgePdfViewer.tsx` for local PDF.js rendering and resource cleanup.
- Create `src/renderer/src/tabs/KnowledgeTab.tsx` and `src/renderer/src/tabs/knowledge/knowledge.css` for the Focus Reader shell and states.
- Add focused renderer tests under `src/renderer/src/tabs/knowledge/__tests__/` and `src/renderer/src/tabs/__tests__/KnowledgeTab.test.tsx`.
- Update `src/renderer/src/App.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/sidebar/SidebarIcons.tsx`, related tests, and global-search routing.

### Documentation

- Update `docs/architecture.md` with the server indexer, protected file mirror, client cache, and renderer flow.
- Update `docs/SECURITY.md` with path containment, worker/parser limits, protected file transport, PDF.js restrictions, and LAN-only handling.

---

## Task 1: Add Shared Knowledge Contracts and PDF.js Dependency

**Files:**

- Create: `src/shared/knowledge.ts`
- Create: `src/shared/__tests__/knowledge.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Write failing shared tests covering limits, record normalization, `General`-first category sort, case/diacritic-insensitive search text, valid outline levels, and stable document sorting.
- [ ] Run `npx vitest run src/shared/__tests__/knowledge.test.ts` and confirm it fails because `@shared/knowledge` does not exist.
- [ ] Install the pinned runtime package with `npm install pdfjs-dist@5.4.624`.
- [ ] Implement the exact shared domain:

```ts
export const KNOWLEDGE_DOCUMENTS_COLLECTION = 'knowledge_documents';
export const KNOWLEDGE_MAX_PDF_BYTES = 50 * 1024 * 1024;
export const KNOWLEDGE_MAX_PAGES = 1_000;
export const KNOWLEDGE_MAX_OUTLINE_NODES = 500;

export type KnowledgeOutlineNode = {
  id: string;
  label: string;
  level: 1 | 2;
  pageIndex: number;
  top: number | null;
};

export type KnowledgeDocumentRecord = {
  id: string;
  sourceKey: string;
  category: string;
  title: string;
  fileName: string;
  pdf: string;
  checksum: string;
  byteSize: number;
  pageCount: number;
  outline: KnowledgeOutlineNode[];
  outlineSource: 'native' | 'inferred' | 'none';
  sourceModifiedAt: string;
  indexedAt: string;
  created: string;
  updated: string;
};
```

- [ ] Add `KnowledgeIndexStatus`, `KnowledgePdfRequest`, and a discriminated `KnowledgePdfResult` whose success member contains `ArrayBuffer`, checksum, and `server | cache | download` source and whose failure codes include `not-found`, `not-available-offline`, `invalid-document`, `download-failed`, and `checksum-mismatch`.
- [ ] Keep normalization pure and discard unknown/malformed outline nodes rather than passing untrusted PocketBase JSON into the tree.
- [ ] Run the focused shared tests and `npm run typecheck`.
- [ ] Commit with `feat(knowledge): add shared contracts`.

## Task 2: Add Strict IPC Contracts

**Files:**

- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Modify: `src/shared/__tests__/ipcValidation.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.test.ts`

- [ ] Add failing tests that accept a PocketBase-style document ID plus a 64-character lowercase SHA-256 checksum and reject traversal, uppercase/short checksums, unknown keys, overlong IDs, and malformed values.
- [ ] Add `KnowledgePdfRequestSchema` as a strict Zod object and export its inferred input type.
- [ ] Add `Knowledge` to `TabName`.
- [ ] Add `KNOWLEDGE_GET_PDF` and `KNOWLEDGE_GET_INDEX_STATUS` to `IPC_CHANNELS`.
- [ ] Add narrow bridge methods:

```ts
getKnowledgePdf: (request: KnowledgePdfRequest) => Promise<KnowledgePdfResult>;
getKnowledgeIndexStatus: () => Promise<KnowledgeIndexStatus>;
```

- [ ] Expose exactly those methods from preload using `ipcRenderer.invoke`; do not expose file paths, directory enumeration, PocketBase credentials, file tokens, uploads, or mutation methods.
- [ ] Run the focused shared/preload tests and `npm run typecheck`.
- [ ] Commit with `feat(knowledge): define trusted IPC bridge`.

## Task 3: Bootstrap the Server-Owned PocketBase Collection

**Files:**

- Modify: `src/main/pocketbase/CollectionBootstrap.ts`
- Modify: `src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`
- Modify: `src/main/handlers/cacheHandlers.ts`
- Modify: `src/main/handlers/cacheHandlers.test.ts`

- [ ] Add failing collection-bootstrap tests for all managed fields, the unique `sourceKey` index, a required protected `application/pdf` file field limited to one file and 50 MiB, authenticated list/view rules, and null create/update/delete rules.
- [ ] Extend `FieldDef` with the PocketBase file options actually emitted by the installed SDK/API: `maxSelect`, `maxSize`, `mimeTypes`, and `protected`.
- [ ] Define `knowledge_documents` with text fields, numeric fields, outline JSON, outline-source select values, source/index dates, the protected file field, and autodate fields.
- [ ] Add `KNOWLEDGE_DOCUMENTS_COLLECTION` to `VALID_COLLECTIONS` only.
- [ ] Add failing cache-handler tests proving metadata snapshots are accepted while offline mutations for the collection remain rejected.
- [ ] Run `npx vitest run src/main/pocketbase/__tests__/CollectionBootstrap.test.ts src/main/handlers/cacheHandlers.test.ts`.
- [ ] Commit with `feat(knowledge): bootstrap protected document collection`.

## Task 4: Implement Safe Source Discovery

**Files:**

- Create: `src/main/knowledge/knowledgePathSafety.ts`
- Create: `src/main/knowledge/__tests__/knowledgePathSafety.test.ts`

- [ ] Add failing tests using temporary directories for root-level `General` PDFs, immediate category PDFs, ignored deeper directories, alphabetical/category sorting, control-character rejection, symbolic-link rejection, canonical containment, case-insensitive `.pdf`, empty file, bad `%PDF-` signature, and oversize rejection.
- [ ] Implement a `scanKnowledgeRoot(root): Promise<KnowledgeSourceScan>` that distinguishes a healthy empty scan from a missing/unreadable/invalid root.
- [ ] Use `lstat`, `realpath`, `relative`, and canonical containment checks. Never follow symlinks and never infer a source path from renderer data.
- [ ] Return only validated source descriptors containing canonical path, normalized source key, category, filename, size, and modification time.
- [ ] Limit source keys to 512 characters, categories to 120, and filenames/titles to 240; reject control characters and empty normalized names.
- [ ] Run the focused path-safety tests.
- [ ] Commit with `feat(knowledge): validate server PDF sources`.

## Task 5: Extract Native and Inferred PDF Headings in a Bounded Worker

**Files:**

- Create: `src/main/knowledge/knowledgeOutline.ts`
- Create: `src/main/knowledge/knowledgeExtractor.ts`
- Create: `src/main/knowledge/knowledgeExtractor.worker.ts`
- Create: `src/main/knowledge/KnowledgeExtractorWorker.ts`
- Create: `src/main/knowledge/__fixtures__/native-outline.pdf`
- Create: `src/main/knowledge/__fixtures__/inferred-outline.pdf`
- Create: `src/main/knowledge/__fixtures__/image-only.pdf`
- Create: `src/main/knowledge/__tests__/knowledgeOutline.test.ts`
- Create: `src/main/knowledge/__tests__/knowledgeExtractor.test.ts`
- Create: `src/main/knowledge/__tests__/KnowledgeExtractorWorker.test.ts`
- Modify: `electron.vite.config.ts`

- [ ] Add failing pure tests for native outline flattening, destination resolution inputs, sibling destination deduplication, two-level cap, label cap, deterministic IDs, typography level clustering, repeated header/footer exclusion, page-number exclusion, and body-line rejection.
- [ ] Implement native-outline normalization separately from PDF I/O so outline policy is deterministic and cheap to test.
- [ ] Implement inference from PDF.js text items by grouping baselines into lines, calculating predominant body size, detecting repeated margin lines, accepting short isolated larger/bold candidates, and clustering accepted sizes into levels 1 and 2.
- [ ] Add fixture extraction tests proving native, inferred, and no-outline behavior and proving only outline labels/destinations are returned.
- [ ] Load documents with PDF.js evaluation disabled and no external fetches. Reject password/encryption errors and documents over 1,000 pages.
- [ ] Cap persisted outlines at 500 nodes and labels at 240 characters.
- [ ] Implement the worker client as a FIFO queue with concurrency 1, a 30-second job timeout, explicit worker termination, and sanitized failure categories.
- [ ] Add a second main Rollup input named `knowledgeExtractorWorker` and assert `npm run build` emits `dist/main/knowledgeExtractorWorker.js`.
- [ ] Run the three focused suites plus `npm run build`.
- [ ] Commit with `feat(knowledge): extract PDF outlines in worker`.

## Task 6: Implement Incremental Server Indexing and Deletion Safety

**Files:**

- Create: `src/main/knowledge/KnowledgeBaseManager.ts`
- Create: `src/main/knowledge/__tests__/KnowledgeBaseManager.test.ts`

- [ ] Add failing tests for source-folder creation, startup scan, unchanged-file skip, checksum-based update with stable record ID, protected-file create/update payloads, one-second watcher debounce, five-minute fallback reconciliation, individual removal, unhealthy-root preservation, bulk-deletion warning, and repeated missing-set confirmation after five minutes.
- [ ] Inject filesystem scan, worker extractor, PocketBase client getter, clock, watcher, logger, and status broadcaster so tests do not start real processes.
- [ ] On a healthy scan, compare normalized source keys against existing records. Hash only changed size/mtime candidates; parse/upload only when the checksum differs.
- [ ] Use `FormData`/`Blob` supported by the installed PocketBase SDK to create or update the protected `pdf` file while retaining the record ID for an unchanged `sourceKey`.
- [ ] If upload or extraction fails, preserve the last valid record and continue indexing other files.
- [ ] Never delete records for an unavailable/unreadable root. When more than 25% of known records are missing, require the identical missing set in two healthy scans at least five minutes apart before deletion.
- [ ] Broadcast bounded `idle | indexing | warning | error` status without document text.
- [ ] Ensure `stop()` closes watcher, clears debounce/reconcile timers, aborts queued work, and terminates the parser worker.
- [ ] Run `npx vitest run src/main/knowledge/__tests__/KnowledgeBaseManager.test.ts`.
- [ ] Commit with `feat(knowledge): index server PDF library`.

## Task 7: Implement Protected PDF Resolution and the Client Cache

**Files:**

- Create: `src/main/knowledge/KnowledgePdfService.ts`
- Create: `src/main/knowledge/__tests__/KnowledgePdfService.test.ts`

- [ ] Add failing tests for validated server-source reads, mirrored-file fallback, cache hits, client app-user authentication, protected file token/download URL creation, byte-size and checksum verification, atomic temporary-file promotion, retry after checksum mismatch, offline uncached result, and typed failures.
- [ ] Add cache-cleanup tests for a 2 GiB LRU budget, active-checksum protection, orphan retention for 30 days, referenced-file retention, stale temporary-file cleanup, and no prefetch.
- [ ] Keep cache paths content-addressed as `<config data>/knowledge-cache/<checksum>.pdf`; validate every filename against the lowercase SHA-256 format before access.
- [ ] Authenticate using Relay's existing app email and configured connection secret. Reuse current LAN URL/auth policy; do not add permissive fetch or certificate bypasses.
- [ ] Verify a downloaded PDF's signature, length, and SHA-256 before `rename()` promotion. Remove partial/bad files and retry only once when online.
- [ ] Return a bounded `ArrayBuffer`; never return a path, token, password, or arbitrary fetch URL.
- [ ] Run the focused PDF-service tests.
- [ ] Commit with `feat(knowledge): cache protected PDFs on demand`.

## Task 8: Wire Trusted Handlers and Application Lifecycle

**Files:**

- Create: `src/main/handlers/knowledgeHandlers.ts`
- Create: `src/main/handlers/knowledgeHandlers.test.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/main/__tests__/ipcHandlers.test.ts`
- Modify: `src/main/app/appState.ts`
- Modify: `src/main/app/__tests__/appState.test.ts`
- Modify: `src/main/app/pocketbaseBootstrap.ts`
- Modify: `src/main/app/__tests__/pocketbaseBootstrap.test.ts`
- Modify: `src/main/app/runtimeReconfigure.ts`
- Modify: `src/main/app/__tests__/runtimeReconfigure.test.ts`
- Modify: `src/main/app/maintenanceTasks.ts`
- Modify: `src/main/app/__tests__/maintenanceTasks.test.ts`
- Modify: `src/main/index.ts`

- [ ] Add failing handler tests for trusted sender enforcement, strict request validation, service absence, successful ArrayBuffer transport, and index-status fallback.
- [ ] Register handlers through `setupIpcHandlers` using service/manager getters rather than captured instances.
- [ ] Add `KnowledgeBaseManager` and `KnowledgePdfService` state getters/setters and pass them through `setupIpcHandlers`.
- [ ] Create the PDF service in both modes after configuration is known. Start the index manager only after server PocketBase bootstrap and collection creation succeed.
- [ ] Stop the manager before server shutdown/reconfigure and restart it only in server mode after PocketBase is ready.
- [ ] Keep client reconfiguration routed through `initializeClientOfflineInfrastructure`; add the PDF service beside that initializer without replacing, duplicating, or bypassing it.
- [ ] Invoke PDF cache cleanup from the existing 24-hour maintenance callback instead of introducing another daily interval.
- [ ] Add lifecycle regression assertions that switching server → client and client → server leaves exactly the correct manager/service resources alive.
- [ ] Run the focused handler/app lifecycle suites and `npm run typecheck`.
- [ ] Commit with `feat(knowledge): integrate app lifecycle`.

## Task 9: Build the Read-Only Metadata Store and View Model

**Files:**

- Create: `src/renderer/src/services/knowledgeService.ts`
- Create: `src/renderer/src/services/__tests__/knowledgeService.test.ts`
- Create: `src/renderer/src/tabs/knowledge/knowledgeModel.ts`
- Create: `src/renderer/src/tabs/knowledge/__tests__/knowledgeModel.test.ts`
- Create: `src/renderer/src/tabs/knowledge/useKnowledgeLibrary.ts`
- Create: `src/renderer/src/tabs/knowledge/__tests__/useKnowledgeLibrary.test.tsx`

- [ ] Add failing service tests proving `CollectionStore` online snapshot, realtime ingestion, metadata cache snapshot, cached cold start, and unsubscribe-on-no-subscribers behavior.
- [ ] Bind a read-only store to `knowledge_documents`; expose subscribe/getSnapshot functions but no create/update/delete methods.
- [ ] Add failing model tests for `General` first, case-insensitive category/document sorting, grouped category/document/heading matches, diacritic-insensitive search, heading selection, and empty outlines.
- [ ] Implement the hook so only one category is expanded, only the active document exposes headings, removed active records clear the viewer, and checksum changes invalidate the active PDF request.
- [ ] Do not register offline mutations or attribution for this collection.
- [ ] Run the focused service/model/hook tests.
- [ ] Commit with `feat(knowledge): synchronize read-only metadata`.

## Task 10: Build the Local PDF.js Viewer

**Files:**

- Create: `src/renderer/src/tabs/knowledge/KnowledgePdfViewer.tsx`
- Create: `src/renderer/src/tabs/knowledge/__tests__/KnowledgePdfViewer.test.tsx`
- Modify: `electron.vite.config.ts`

- [ ] Add failing tests for loading bytes through `getKnowledgePdf`, offline-uncached state, retry, page count, previous/next page, zoom bounds, fit mode, heading page/top jumps, text-layer rendering, adjacent-page pre-render intent, hidden-tab resource release, and document destruction on checksum/document change.
- [ ] Configure PDF.js with the bundled worker URL; add a dedicated `pdf-vendor` manual chunk rather than loading code from a CDN.
- [ ] Load with `isEvalSupported: false`, `disableAutoFetch: true`, and no exposed annotation/link/form/attachment/download/print actions.
- [ ] Render the active page canvas and text layer, pre-render at most one adjacent page, and release distant canvases.
- [ ] Preserve keyboard-accessible native controls with explicit labels and visible focus states.
- [ ] Run the focused viewer tests and `npm run build:renderer`.
- [ ] Commit with `feat(knowledge): render PDFs locally`.

## Task 11: Build the Focus Reader Category and Outline Tree

**Files:**

- Create: `src/renderer/src/tabs/knowledge/KnowledgeTree.tsx`
- Create: `src/renderer/src/tabs/knowledge/__tests__/KnowledgeTree.test.tsx`
- Create: `src/renderer/src/tabs/KnowledgeTab.tsx`
- Create: `src/renderer/src/tabs/__tests__/KnowledgeTab.test.tsx`
- Create: `src/renderer/src/tabs/knowledge/knowledge.css`

- [ ] Add failing tree tests for one expanded category, selected document outline, two visible levels, page labels, document/heading activation, Up/Down/Left/Right/Enter/Space behavior, and focus retention after a jump.
- [ ] Use semantic buttons and `aria-expanded`, `aria-current`, and tree/treeitem ownership without adding mouse-only rows.
- [ ] Add failing tab tests for Relay-matched shell, breadcrumb/current-section labels, search, loading skeletons, server/client empty copy, no-outline opening, offline unavailable state, render retry, removal notification, index warning/status, and absence of edit/upload/download/print/annotation controls.
- [ ] Implement the approved Focus Reader proportions and visual system using Relay's existing CSS variables, IBM Plex typography, squared borders, compact spacing, and selected-state accent.
- [ ] Virtualize the scrollable document area through the existing list strategy only when list size exceeds the visible threshold; preserve semantic keyboard navigation.
- [ ] Run the focused tree/tab tests, renderer lint on new files, and accessibility assertions.
- [ ] Commit with `feat(knowledge): add Focus Reader interface`.

## Task 12: Integrate Navigation and Global Search

**Files:**

- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/__tests__/App.test.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/sidebar/SidebarIcons.tsx`
- Modify: `src/renderer/src/components/__tests__/Sidebar.test.tsx`
- Modify: `src/renderer/src/components/__tests__/sidebar/SidebarIcons.test.tsx`
- Modify: `src/renderer/src/components/HeaderSearch.tsx`
- Modify: `src/renderer/src/components/__tests__/HeaderSearch.test.tsx`

- [ ] Add failing sidebar tests proving `Knowledge` appears immediately after `Notes`, uses the new book/document icon, and changes the active tab.
- [ ] Lazy-load `KnowledgeTab`, add `Relay / Knowledge`, and preserve the mount-once tab pattern.
- [ ] Pass the active/hidden state so the viewer releases PDF resources when the tab is hidden.
- [ ] Register Knowledge search results in the existing header search and route category/document/heading selections into the tab without duplicating a detached search experience.
- [ ] Add App tests for mount, retain/hide, breadcrumb, and no changes to existing tab navigation.
- [ ] Run the focused App/sidebar/header-search tests.
- [ ] Commit with `feat(knowledge): add primary navigation`.

## Task 13: Document the Operational and Security Model

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/SECURITY.md`
- Modify: `README.md`

- [ ] Document the server folder layout, one-level category rule, `General` behavior, file limits, no in-app edits, watcher/reconciliation timing, and deletion guard.
- [ ] Document metadata versus PDF-byte synchronization, the on-demand 2 GiB cache, offline behavior, and backup/restore behavior.
- [ ] Document trusted IPC, canonical path containment, protected PocketBase files, worker bounds, PDF.js evaluation/link/form restrictions, and LAN-only handling.
- [ ] Add a concise administrator setup section to `README.md` without presenting content controls to operators.
- [ ] Run `npx prettier --check README.md docs/architecture.md docs/SECURITY.md docs/superpowers/specs/2026-07-14-read-only-pdf-knowledge-base-design.md docs/superpowers/plans/2026-07-14-read-only-pdf-knowledge-base.md`.
- [ ] Commit with `docs: explain knowledge base operations`.

## Task 14: Complete Regression and Security Verification

**Files:**

- Modify as required by failures; do not weaken tests to obtain a pass.

- [ ] Run formatting: `npm run format:check`.
- [ ] Run lint: `npm run lint`.
- [ ] Run type checking: `npm run typecheck`.
- [ ] Run all unit/cache/renderer tests: `npm test`.
- [ ] If cache tests fail after a packaged Windows build, run `npm rebuild better-sqlite3 --build-from-source` and rerun `npm run test:cache`.
- [ ] Run production build: `npm run build`.
- [ ] Run Electron E2E: `npm run test:electron`.
- [ ] Launch a server copy and a client copy and verify: authentication, discovery/connection, presence, realtime metadata add/replace/remove, heading jump, protected PDF download, cached offline reopen, uncached offline state, and runtime reconfigure cleanup.
- [ ] Inspect the production output/network panel and prove there is no PDF CDN, OCR, telemetry, external link, arbitrary path, upload, or mutation path.
- [ ] Run `git diff --check` and `git status --short`.
- [ ] Review the completed diff against every Acceptance Criteria item in the approved specification.
- [ ] Use `superpowers:verification-before-completion` before reporting success.
- [ ] Commit any verification-driven fixes with a specific message; do not create a generic empty verification commit.

## Plan Self-Review

- [ ] Confirm every design-spec section maps to at least one implementation task and test.
- [ ] Confirm client/server connection preservation is explicitly tested in lifecycle and final regression tasks.
- [ ] Confirm no task adds renderer writes, arbitrary filesystem APIs, cloud processing, built-in PDF embedding, or credential exposure.
- [ ] Scan the plan for unfinished markers and remove any deferred or vague implementation language.
- [ ] Confirm all named files, types, commands, limits, intervals, and failure results are internally consistent with the approved spec.
