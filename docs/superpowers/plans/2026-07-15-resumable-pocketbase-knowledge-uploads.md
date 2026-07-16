# Resumable PocketBase Knowledge Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Relay's folder-backed Knowledge Base runtime with PocketBase-only PDF storage and
deliver paired-publisher, resumable 100-file VPN batch uploads.

**Architecture:** The Electron main process owns an encrypted, persistent upload queue and sends
4 MiB protected chunks through the existing privileged PocketBase client with two concurrent chunk
requests. Signed server commands create manifests, report authoritative missing chunks, finalize and
validate one PDF at a time, cancel uploads, and publish reviewed staging records. PocketBase remains
the only server authority; no folder watcher, filesystem fallback, additional endpoint, or cloud
service remains.

**Tech Stack:** Electron 42, TypeScript, React 19, PocketBase, Node.js `crypto`/`fs`, Vitest,
Testing Library, Playwright, existing privileged signed-command runtime.

## Global Constraints

- Use PocketBase as the only runtime authority for Knowledge Base PDFs.
- Remove folder watching, folder reconciliation, folder migration, and folder fallback reads.
- Accept at most 100 PDFs per batch and at most 50 MiB per PDF.
- Use 4 MiB protected chunks with at most two chunk requests in flight across the batch.
- Keep staged PDFs for seven days; delete chunks immediately after durable staging.
- Persist no PDF bytes on the publisher laptop; encrypt persisted source paths with Electron
  `safeStorage` and owner-only file permissions.
- Resume after VPN or process interruption from the server's authoritative missing-chunk state.
- Do not add a network port, external service, S3-compatible store, or cloud dependency.
- Require explicit publication; do not auto-publish validated PDFs.
- Keep the publisher limited to `knowledge.manage`; publisher pairing must not grant
  `devices.manage`.
- Preserve the Focus Reader, relative links, guarded web links, offline PDF cache, and Relay
  client/server connectivity.
- Keep all renderer IPC views free of local paths, PDF bytes, file tokens, auth tokens, and private
  keys.
- Use TDD for every production behavior: write the focused test, observe the intended failure, then
  implement the smallest passing change.

---

## File Structure

### Remove

- `src/main/knowledge/KnowledgeBaseManager.ts` — obsolete folder scanner/watcher.
- `src/main/knowledge/KnowledgeBaseManager.test.ts` — obsolete watcher tests.
- `src/main/knowledge/ManagedKnowledgeMigration.ts` — obsolete folder migration state machine.
- `src/main/knowledge/__tests__/ManagedKnowledgeMigration.test.ts` — obsolete migration tests.
- `src/main/knowledge/knowledgePathSafety.ts` — obsolete authoritative-folder scan helpers.
- `src/main/knowledge/knowledgePathSafety.test.ts` — obsolete folder scan tests.

### Create

- `src/main/knowledge/KnowledgeIndexStatusService.ts` — derive reader status from PocketBase.
- `src/main/knowledge/KnowledgeUploadCapacity.ts` — batch admission and free-space checks.
- `src/main/knowledge/KnowledgeUploadCoordinator.ts` — server manifest, status, finalize, and cancel
  behavior.
- `src/main/knowledge/KnowledgeUploadQueueStore.ts` — encrypted local queue persistence.
- `src/main/knowledge/knowledgeChunking.ts` — stream inspection, hash planning, and bounded reads.
- `src/main/knowledge/KnowledgeUploadScheduler.ts` — two-worker retry/resume scheduler.
- `src/main/knowledge/__tests__/KnowledgeIndexStatusService.test.ts`.
- `src/main/knowledge/__tests__/KnowledgeUploadCapacity.test.ts`.
- `src/main/knowledge/__tests__/KnowledgeUploadCoordinator.test.ts`.
- `src/main/knowledge/__tests__/KnowledgeUploadQueueStore.test.ts`.
- `src/main/knowledge/__tests__/knowledgeChunking.test.ts`.
- `src/main/knowledge/__tests__/KnowledgeUploadScheduler.test.ts`.
- `scripts/seedKnowledge.mjs` — reusable protected-PocketBase seed helper.
- `scripts/seedKnowledge.test.mjs` — seed helper contract test.
- `scripts/knowledge-upload-soak.mjs` — opt-in deterministic queue/assembly test.
- `scripts/knowledge-upload-soak.test.mjs` — bounded script contract test.

### Modify

- `src/shared/knowledge.ts` and `src/shared/knowledge.test.ts` — batch/chunk/queue contracts.
- `src/shared/privilegedCommands.ts` and `src/shared/__tests__/privilegedCommands.test.ts` — resumable
  upload commands and normalization.
- `src/shared/ipc.ts`, `src/shared/ipcValidation.ts`, and tests — queue controls and progress views.
- `src/main/pocketbase/CollectionBootstrap.ts` and tests — batch/chunk collections and upload
  manifest schema.
- `src/main/knowledge/KnowledgePdfService.ts` and tests — PocketBase-only server reads.
- `src/main/knowledge/knowledgeRuntime.ts` and tests — remove manager lifecycle.
- `src/main/app/appState.ts`, `src/main/index.ts`, `src/main/app/runtimeReconfigure.ts`, and tests —
  remove folder manager state and startup.
- `src/main/handlers/knowledgeHandlers.ts` and tests — status service and queue IPC.
- `src/main/ipcHandlers.ts` and `src/main/__tests__/ipcHandlers.test.ts` — upload service lifetime
  wiring.
- `src/main/privileged/privilegedRuntime.ts`, handlers, shared IPC, and tests — target-account
  challenges. `PrivilegedPairingService` already accepts an explicit account ID.
- `src/main/knowledge/KnowledgeUploadService.ts` and tests — enqueue quickly and run background
  upload orchestration.
- `src/main/knowledge/registerKnowledgeManagementCommands.ts` and tests — resumable server command
  registration.
- `src/main/knowledge/ManagedKnowledgeService.ts` and tests — cross-account admin access and remove
  staging after publish.
- `src/main/knowledge/KnowledgeManagementCleanup.ts` and tests — batches, chunks, and seven-day
  cleanup.
- `src/renderer/src/features/knowledge/useKnowledgeManagement.ts` and tests — queue controls and
  bulk publish.
- `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx`, `knowledge.css`, and tests
  — responsive batch UI.
- `src/renderer/src/contexts/PrivilegedAccessContext.tsx`, pairing settings components, and tests —
  pairing target selection.
- `tests/e2e/critical-path.spec.ts` — publisher pairing and interrupted upload recovery.
- `scripts/seed.mjs` — call the tested protected-PocketBase seed helper instead of writing a source
  folder.
- `docs/SECURITY.md` and `docs/architecture.md` — final authority, retention, VPN, and pairing model.

---

### Task 1: Remove Runtime Folder Authority

**Files:**

- Create: `src/main/knowledge/KnowledgeIndexStatusService.ts`
- Create: `src/main/knowledge/__tests__/KnowledgeIndexStatusService.test.ts`
- Modify: `src/main/knowledge/KnowledgePdfService.ts`
- Modify: `src/main/knowledge/KnowledgePdfService.test.ts`
- Modify: `src/main/knowledge/knowledgeRuntime.ts`
- Modify: `src/main/knowledge/knowledgeRuntime.test.ts`
- Modify: `src/main/handlers/knowledgeHandlers.ts`
- Modify: `src/main/handlers/knowledgeHandlers.test.ts`
- Modify: `src/main/app/appState.ts`
- Modify: `src/main/app/__tests__/appState.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/app/runtimeReconfigure.ts`
- Modify: `src/main/app/__tests__/runtimeReconfigure.test.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/main/__tests__/ipcHandlers.test.ts`
- Create: `scripts/seedKnowledge.mjs`
- Create: `scripts/seedKnowledge.test.mjs`
- Modify: `scripts/seed.mjs`
- Delete: the six folder manager/migration/path files listed under **Remove**.

**Interfaces:**

- Produces:

```ts
export class KnowledgeIndexStatusService {
  constructor(getPbClient: () => PocketBase | null);
  getStatus(): Promise<KnowledgeIndexStatus>;
}

export function initializeKnowledgePdfService(configDataDir: string): KnowledgePdfService;
export async function cleanupKnowledgePdfCache(): Promise<void>;
```

- `KnowledgePdfService.getPdf()` keeps its existing public signature.

- [ ] **Step 1: Write failing PocketBase-only reader tests**

Replace the folder-source expectations in `KnowledgePdfService.test.ts` with a server-mode test that
provides a protected PocketBase file and throws if any folder resolver is invoked:

```ts
it('reads server PDFs only from the protected PocketBase file', async () => {
  const fetchPdf = vi.fn(async () => new Response(pdfBytes));
  const service = new KnowledgePdfService({
    configDataDir,
    getConfig: () => ({ mode: 'server' }) as never,
    getPbClient: () => pocketBaseWithProtectedPdf(document, pdfBytes),
    fetch: fetchPdf as typeof fetch,
  });

  await expect(
    service.getPdf({ documentId: document.id, checksum: document.checksum }),
  ).resolves.toMatchObject({ ok: true, source: 'download' });
  expect(fetchPdf).toHaveBeenCalledOnce();
});
```

Add `KnowledgeIndexStatusService.test.ts` cases for no client, an empty collection, and multiple
categories. Update runtime tests to expect no manager construction, watcher, scan, or migration.
Create `scripts/seedKnowledge.test.mjs` with a failing contract that requires a PDF `Blob` on
`knowledge_documents.pdf` and rejects any filesystem write.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run \
  src/main/knowledge/KnowledgePdfService.test.ts \
  src/main/knowledge/knowledgeRuntime.test.ts \
  src/main/knowledge/__tests__/KnowledgeIndexStatusService.test.ts \
  src/main/handlers/knowledgeHandlers.test.ts \
  src/main/app/__tests__/appState.test.ts \
  src/main/app/__tests__/runtimeReconfigure.test.ts \
  scripts/seedKnowledge.test.mjs
```

Expected: failures show the server still attempts folder resolution, the manager lifecycle still
exists, and `KnowledgeIndexStatusService` is missing.

- [ ] **Step 3: Implement the PocketBase-only runtime**

Implement status derivation without filesystem state:

```ts
export class KnowledgeIndexStatusService {
  constructor(private readonly getPbClient: () => PocketBase | null) {}

  async getStatus(): Promise<KnowledgeIndexStatus> {
    const pb = this.getPbClient();
    if (!pb) return { state: 'idle', documentCount: 0, categoryCount: 0, lastIndexedAt: null };
    const records = await pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).getFullList<{
      category: string;
      indexedAt: string;
      lifecycleState: string;
    }>({ fields: 'category,indexedAt,lifecycleState', requestKey: null });
    const active = records.filter(({ lifecycleState }) => lifecycleState !== 'trashed');
    return {
      state: 'ready',
      documentCount: active.length,
      categoryCount: new Set(active.map(({ category }) => category)).size,
      lastIndexedAt: active.map(({ indexedAt }) => indexedAt).sort().at(-1) ?? null,
    };
  }
}
```

Remove `knowledgeRoot`, `readServerSource`, `scanKnowledgeRoot`, and `readKnowledgeSourceFile` from
`KnowledgePdfService`. In server mode, call `downloadProtectedPdf` directly after record and checksum
validation. Remove manager state/accessors, start/stop calls, runtime reconfigure hooks, broadcasts,
and handler dependencies. Wire `getKnowledgeIndexStatus` to the new service.

Delete the obsolete manager, migration, and path files only after imports and tests are updated.

- [ ] **Step 4: Update seed behavior to stop creating authoritative folders**

Extract the seed upload into `scripts/seedKnowledge.mjs` so the failing seed contract passes. Change
`scripts/seed.mjs` to call the helper. Preserve deterministic titles, categories, outlines, and
checksums; do not write `data/knowledge-base`.

- [ ] **Step 5: Run focused and regression tests**

Run the Step 2 command plus:

```bash
node scripts/run-renderer-tests.mjs KnowledgeTab.test.tsx useKnowledgeLibrary.test.tsx
npm run typecheck
```

Expected: all pass and `rg -n "KnowledgeBaseManager|scanKnowledgeRoot|knowledge-base" src/main`
returns no runtime folder-authority matches.

- [ ] **Step 6: Commit**

```bash
git add src/main src/shared scripts/seed.mjs scripts/seedKnowledge.mjs scripts/seedKnowledge.test.mjs
git commit -m "refactor(knowledge): make PocketBase the sole PDF authority"
```

---

### Task 2: Correct Publisher-Targeted Workstation Pairing

**Files:**

- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Modify: `src/shared/ipcValidation.test.ts`
- Modify: `src/main/handlers/privilegedAccessHandlers.ts`
- Modify: `src/main/handlers/privilegedAccessHandlers.test.ts`
- Modify: `src/main/privileged/privilegedRuntime.ts`
- Modify: `src/main/privileged/__tests__/privilegedRuntime.test.ts`
- Modify: `src/renderer/src/contexts/PrivilegedAccessContext.tsx`
- Modify: `src/renderer/src/contexts/PrivilegedAccessContext.test.tsx`
- Modify: `src/renderer/src/components/settings/PrivilegedAccessPanel.tsx`
- Modify: `src/renderer/src/components/settings/PrivilegedAccessPanel.test.tsx`

**Interfaces:**

```ts
type PrivilegedPairingChallengeTarget = {
  accountId: string;
  operatorId: string;
  operatorName: string;
  role: 'admin' | 'publisher';
};

createPrivilegedPairingChallenge(
  targetAccountId: string,
): Promise<IpcResult<PrivilegedPairingChallengeView>>;

PrivilegedRuntime.createPairingChallenge(
  targetAccountId: string,
): Promise<PrivilegedPairingChallengeView>;

type PrivilegedRuntimeOptions = {
  resolvePairingTarget?(targetAccountId: string): Promise<boolean>;
};
```

- [ ] **Step 1: Write failing target-account authorization tests**

Add cases that prove:

```ts
it('creates a challenge for the currently assigned publisher', async () => {
  runtimeView.mockReturnValue(activeAdminView);
  resolvePairingTarget.mockResolvedValue(true);

  await expect(runtime.createPairingChallenge('account-publisher')).resolves.toMatchObject({
    accountId: 'account-publisher',
  });
});

it.each(['account-ordinary', 'account-former-publisher']) (
  'rejects an ineligible pairing target %s',
  async (accountId) => {
    await expect(runtime.createPairingChallenge(accountId)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  },
);
```

Renderer tests must expect an Administrator/Knowledge Publisher target selector and must prove the
publisher receives no `devices.manage` capability after pairing.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run \
  src/main/handlers/privilegedAccessHandlers.test.ts \
  src/main/privileged/__tests__/privilegedRuntime.test.ts \
  src/shared/ipcValidation.test.ts
node scripts/run-renderer-tests.mjs PrivilegedAccessContext.test.tsx PrivilegedAccessPanel.test.tsx
```

Expected: the current no-argument challenge path remains bound to the active administrator account.

- [ ] **Step 3: Implement target resolution and IPC validation**

Add a bounded target-account schema and change the IPC handler to pass it to the runtime. Extend the
runtime options with `resolvePairingTarget` and have `createProductionPrivilegedRuntime` inject an
implementation backed by its server-superuser PocketBase client. The resolver reads the current
privileged state and active account records and returns `true` only for the current administrator or
designated publisher:

```ts
const eligible = new Set([
  state.adminAccountId,
  ...(state.publisherAccountId ? [state.publisherAccountId] : []),
]);
return eligible.has(targetAccountId);
```

The runtime rejects when the resolver returns false, then passes the approved account ID to the
existing `PrivilegedPairingService.createChallenge`; that service already accepts arbitrary account
IDs and does not need modification. Keep challenge creation gated by an active local administrator
with `devices.manage`. Do not add that capability to the publisher role.

- [ ] **Step 4: Add the pairing target UI**

Render a compact target selector containing the administrator and current publisher from the
existing bounded `RelayAdministrationSnapshot` (`privilegedAccounts`, `adminOperatorId`, and
`publisherOperatorId`). Do not add an unrestricted account-list endpoint. Disable code creation when
no target is selected. Pass the selected account ID through context and IPC, while showing only
operator names and role labels to the user.

- [ ] **Step 5: Verify pairing regressions**

Run the Step 2 commands plus:

```bash
npm run typecheck
npm run lint
```

Expected: all pass; administrator self-pairing, publisher pairing, one-time code expiry, five-attempt
lockout, and device revocation remain covered.

- [ ] **Step 6: Commit**

```bash
git add src/shared src/main/handlers src/main/privileged src/renderer/src
git commit -m "fix(access): pair designated publisher workstations"
```

---

### Task 3: Define Resumable Upload Contracts and Collections

**Files:**

- Modify: `src/shared/knowledge.ts`
- Modify: `src/shared/knowledge.test.ts`
- Modify: `src/shared/privilegedCommands.ts`
- Modify: `src/shared/__tests__/privilegedCommands.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Modify: `src/shared/ipcValidation.test.ts`
- Modify: `src/main/pocketbase/CollectionBootstrap.ts`
- Modify: `src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`

**Interfaces:**

```ts
export const KNOWLEDGE_UPLOAD_BATCHES_COLLECTION = 'knowledge_upload_batches';
export const KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION = 'knowledge_upload_chunks';
export const KNOWLEDGE_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const KNOWLEDGE_UPLOAD_MAX_FILES = 100;
export const KNOWLEDGE_UPLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const KNOWLEDGE_UPLOAD_MAX_RETRIES = 8;
export const KNOWLEDGE_UPLOAD_CONCURRENCY = 2;

type KnowledgeUploadCommandPayloads = {
  'knowledge.upload.batch.begin': {
    requestId: string;
    fileCount: number;
    totalBytes: number;
  };
  'knowledge.upload.file.begin': {
    batchId: string;
    fileName: string;
    byteSize: number;
    checksum: string;
    chunkCount: number;
  };
  'knowledge.upload.status': { batchId: string };
  'knowledge.upload.file.finalize': { uploadId: string; expectedRevision: number };
  'knowledge.upload.file.cancel': { uploadId: string; expectedRevision: number };
  'knowledge.upload.batch.cancel': { batchId: string; expectedRevision: number };
};
```

- [ ] **Step 1: Write failing normalization and schema tests**

Cover exact limits, invalid chunk counts, traversal/control characters in filenames, invalid SHA-256,
oversized payloads, relation IDs, queue views without paths, and every new command name.

```ts
expect(
  normalizePrivilegedCommandPayload('knowledge.upload.file.begin', {
    batchId: 'batch1',
    fileName: 'Runbook.pdf',
    byteSize: 50 * 1024 * 1024,
    checksum: 'a'.repeat(64),
    chunkCount: 13,
  }),
).toEqual(expect.objectContaining({ chunkCount: 13 }));
```

- [ ] **Step 2: Run shared/bootstrap tests and verify RED**

```bash
npx vitest run \
  src/shared/knowledge.test.ts \
  src/shared/__tests__/privilegedCommands.test.ts \
  src/shared/ipcValidation.test.ts \
  src/main/pocketbase/__tests__/CollectionBootstrap.test.ts
```

Expected: new constants, commands, schemas, collections, and relation field support are missing.

- [ ] **Step 3: Implement shared contracts**

Add normalized public views for batches, upload manifests, upload progress, queue state, and safe
errors. Extend `PublicPrivilegedCommandRequestSchema` with the six upload commands. Keep chunk bytes
and paths out of all shared types.

- [ ] **Step 4: Add non-destructive PocketBase schemas**

Extend `FieldDef` with relation metadata and add the helper shown below as an internal collection
definition. `CollectionBootstrap` must create dependency collections first, resolve every relation's
target collection name to its actual PocketBase collection ID, and only then serialize the field for
the schema request. Never send the target collection name as `collectionId`.

```ts
{
  name: KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
  type: 'base',
  fields: [
    relation('uploadId', KNOWLEDGE_UPLOADS_COLLECTION, true),
    relation('batchId', KNOWLEDGE_UPLOAD_BATCHES_COLLECTION, true),
    { type: 'text', name: 'accountId', required: true, max: 200 },
    { type: 'text', name: 'deviceId', required: true, max: 200 },
    { type: 'number', name: 'index', required: true },
    { type: 'number', name: 'byteSize', required: true },
    { type: 'text', name: 'checksum', required: true, max: 64 },
    {
      type: 'file',
      name: 'chunk',
      required: true,
      maxSelect: 1,
      maxSize: KNOWLEDGE_UPLOAD_CHUNK_BYTES,
      mimeTypes: ['application/octet-stream'],
      protected: true,
    },
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_knowledge_upload_chunk ON knowledge_upload_chunks (uploadId, `index`)',
  ],
  rules: KNOWLEDGE_UPLOAD_CHUNK_RULES,
}
```

Add the batch collection and patch `knowledge_uploads` so the staged `pdf` is optional before
finalization and the new manifest fields are present. Rules must bind the privileged auth account,
operator, batch relation, and upload relation; only server code updates or deletes records.

- [ ] **Step 5: Verify contracts and bootstrap**

Run Step 2 plus `npm run typecheck`. Expected: all pass and existing collections are patched without
dropping document records or protected PDFs.

- [ ] **Step 6: Commit**

```bash
git add src/shared src/main/pocketbase
git commit -m "feat(knowledge): define resumable upload storage"
```

---

### Task 4: Implement Server Admission, Resume, Finalize, and Cancel

**Files:**

- Create: `src/main/knowledge/KnowledgeUploadCapacity.ts`
- Create: `src/main/knowledge/__tests__/KnowledgeUploadCapacity.test.ts`
- Create: `src/main/knowledge/KnowledgeUploadCoordinator.ts`
- Create: `src/main/knowledge/__tests__/KnowledgeUploadCoordinator.test.ts`
- Modify: `src/main/knowledge/registerKnowledgeManagementCommands.ts`
- Modify: `src/main/knowledge/__tests__/registerKnowledgeManagementCommands.test.ts`
- Modify: `src/main/privileged/privilegedRuntime.ts`
- Modify: `src/main/privileged/__tests__/privilegedRuntime.test.ts`

**Interfaces:**

```ts
export type KnowledgeUploadCapacityProbe = {
  availableBytes(path: string): Promise<number>;
};

export class KnowledgeUploadCoordinator {
  start(): Promise<void>;
  beginBatch(context: UploadActor, input: BeginBatchInput): Promise<KnowledgeUploadBatchView>;
  beginFile(context: UploadActor, input: BeginFileInput): Promise<KnowledgeUploadView>;
  status(context: UploadActor, batchId: string): Promise<KnowledgeUploadBatchStatusView>;
  finalize(context: UploadActor, input: FinalizeUploadInput): Promise<KnowledgeUploadView>;
  cancelFile(context: UploadActor, input: CancelUploadInput): Promise<void>;
  cancelBatch(context: UploadActor, input: CancelBatchInput): Promise<void>;
  dispose(): Promise<void>;
}
```

- [ ] **Step 1: Write failing capacity tests**

Test the 2 GiB floor, batch bytes plus one 50 MiB assembly allowance, maximum file count/bytes, one
active batch per account, and injected filesystem failures.

```ts
await expect(
  capacity.assertBatch({ totalBytes: 5_000 * 1024 * 1024, fileCount: 100 }),
).rejects.toMatchObject({ code: 'insufficient-storage' });
```

- [ ] **Step 2: Write failing coordinator tests**

Use an in-memory PocketBase port and deterministic chunks to cover:

- account/device authorization;
- idempotent begin by request ID;
- authoritative missing chunk indexes;
- ordered assembly and checksum validation;
- duplicate and conflicting chunk behavior;
- one-file-at-a-time 50 MiB memory bound;
- finalize replay while `assembling`, `extracting`, and `ready`;
- immediate `processing` return while assembly/extraction continues in the background;
- restart recovery by scanning and resuming `assembling` and `extracting` manifests from
  `start()`;
- orderly `dispose()` behavior while a file is in progress;
- cancellation before and after ambiguous client responses; and
- administrator cross-account versus publisher own-account access.

- [ ] **Step 3: Run the focused server tests and verify RED**

```bash
npx vitest run \
  src/main/knowledge/__tests__/KnowledgeUploadCapacity.test.ts \
  src/main/knowledge/__tests__/KnowledgeUploadCoordinator.test.ts \
  src/main/knowledge/__tests__/registerKnowledgeManagementCommands.test.ts \
  src/main/privileged/__tests__/privilegedRuntime.test.ts
```

Expected: the capacity and coordinator modules and new command registrations do not exist.

- [ ] **Step 4: Implement storage admission**

Use `fs.promises.statfs` against the configured PocketBase data/storage filesystem. Reject when:

```ts
availableBytes - input.totalBytes - KNOWLEDGE_MAX_PDF_BYTES < 2 * 1024 * 1024 * 1024
```

Return only `invalid-request`, `conflict`, or `insufficient-storage` safe errors. Never return a path
or raw filesystem error.

- [ ] **Step 5: Implement coordinator state transitions**

Use manifest revisions and the existing `KnowledgeMutationCoordinator` to claim each transition.
Status returns only acknowledged indexes and safe views. The signed finalize command atomically
claims the manifest as `assembling`, enqueues it, and returns a `processing` view without awaiting
assembly or extraction so it stays within the existing command-poll window.

The coordinator owns one serialized background worker. That worker fetches protected chunks in index
order, verifies each declared checksum, concatenates one file, verifies full
length/checksum/signature, stores the protected staged PDF, extracts the outline, then deletes chunks
and writes `ready`; failures write a safe `failed` state while preserving data needed for retry.
`start()` scans `assembling` and `extracting` manifests and re-enqueues them after a server restart.
`dispose()` stops accepting work and lets the active transition reach a safe boundary. Wire
`createProductionPrivilegedRuntime` to await `start()` and include `dispose()` in its returned
disposable so runtime reconfigure and shutdown cannot orphan the worker.

- [ ] **Step 6: Register signed commands**

Register all six command names with `knowledge.manage`. Pass `context.device?.deviceId ??
'server-local'` into the upload actor and enforce current publisher/admin scope in the coordinator.

- [ ] **Step 7: Verify server behavior**

Run Step 3 plus:

```bash
npm run test:cache
npm run typecheck
```

Expected: all pass; finalization creates exactly one staged protected PDF and removes its chunks only
after durability.

- [ ] **Step 8: Commit**

```bash
git add src/main/knowledge src/main/privileged
git commit -m "feat(knowledge): finalize resumable uploads on the server"
```

---

### Task 5: Build the Encrypted Client Queue and Chunk Scheduler

**Files:**

- Create: `src/main/knowledge/KnowledgeUploadQueueStore.ts`
- Create: `src/main/knowledge/__tests__/KnowledgeUploadQueueStore.test.ts`
- Create: `src/main/knowledge/knowledgeChunking.ts`
- Create: `src/main/knowledge/__tests__/knowledgeChunking.test.ts`
- Create: `src/main/knowledge/KnowledgeUploadScheduler.ts`
- Create: `src/main/knowledge/__tests__/KnowledgeUploadScheduler.test.ts`
- Modify: `src/main/knowledge/KnowledgeUploadService.ts`
- Modify: `src/main/knowledge/__tests__/KnowledgeUploadService.test.ts`
- Modify: `src/main/handlers/knowledgeHandlers.ts`
- Modify: `src/main/handlers/knowledgeHandlers.test.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/main/__tests__/ipcHandlers.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.test.ts`

**Interfaces:**

```ts
export type KnowledgeUploadQueueController = {
  selectAndQueue(window?: BrowserWindow): Promise<KnowledgeUploadSelectionResult>;
  pause(batchId: string): Promise<void>;
  resume(batchId: string): Promise<void>;
  retry(uploadId: string): Promise<void>;
  reselect(uploadId: string, window?: BrowserWindow): Promise<void>;
  cancelFile(uploadId: string): Promise<void>;
  cancelBatch(batchId: string): Promise<void>;
  snapshot(): KnowledgeUploadQueueView;
  dispose(): Promise<void>;
};
```

- [ ] **Step 1: Write failing chunk planner tests**

Use temporary files to verify regular-file/no-symlink checks, `%PDF-`, zero-byte rejection, exact
4 MiB boundaries, a 50 MiB maximum, a smaller final chunk, streaming SHA-256, and bounded 4 MiB
reads.

- [ ] **Step 2: Write failing encrypted store tests**

Inject a fake `safeStorage` port and assert:

```ts
expect(await store.load()).toEqual(queue);
expect(await readFile(storePath, 'utf8')).not.toContain('/Users/publisher/Documents');
expect(await stat(storePath)).toMatchObject({ mode: expect.any(Number) });
```

Also prove unavailable safe storage keeps only an in-memory queue and reports `restartRecovery:
false` without plaintext persistence.

- [ ] **Step 3: Write failing scheduler tests**

Cover two-worker maximum concurrency, per-chunk byte progress, jittered 1/2/4/8/16/30-second backoff,
eight-attempt pause, non-retryable errors, ambiguous response reconciliation, process restore,
session-lock pause, missing-source reselection, and server missing-index authority.

- [ ] **Step 4: Run client upload tests and verify RED**

```bash
npx vitest run \
  src/main/knowledge/__tests__/knowledgeChunking.test.ts \
  src/main/knowledge/__tests__/KnowledgeUploadQueueStore.test.ts \
  src/main/knowledge/__tests__/KnowledgeUploadScheduler.test.ts \
  src/main/knowledge/__tests__/KnowledgeUploadService.test.ts \
  src/main/handlers/knowledgeHandlers.test.ts \
  src/main/__tests__/ipcHandlers.test.ts \
  src/preload/index.test.ts
```

Expected: missing planner/store/scheduler and the existing service still waits for sequential
whole-file uploads.

- [ ] **Step 5: Implement bounded source inspection and chunk reads**

Use `lstat`, `realpath`, `open`, and `FileHandle.read`. Stream the full checksum once, retain file
identity metadata, and read only requested ranges. Never use `readFile` for a source PDF.

- [ ] **Step 6: Implement encrypted persistence**

Store versioned queue JSON under the Relay data directory with encrypted source paths and mode
`0o600`. Write atomically through a temporary file plus rename. Bind each queue entry to account and
device IDs. Revalidate the source before resume.

- [ ] **Step 7: Implement the two-worker scheduler**

Create chunk `FormData` directly through `runtime.createPrivilegedRecord`. Use a shared semaphore of
two, acknowledged server indexes, retry classification, jittered backoff, online/session wakeups, and
abort controllers for pause/cancel. Emit one sanitized queue snapshot after every state or byte
change.

- [ ] **Step 8: Refactor `KnowledgeUploadService` into background orchestration**

`selectAndQueue` returns after selection, safe inspection, and local queue creation. Hashing and
upload continue in the main process. Keep one service instance for the app lifetime rather than
constructing one per IPC request. Dispose it during runtime reconfigure and app quit.

- [ ] **Step 9: Add typed IPC controls**

Expose select/queue, snapshot, pause, resume, retry, reselect, cancel-file, and cancel-batch. Validate
all IDs and trusted senders. Broadcast sanitized queue snapshots on the existing window channel
pattern.

- [ ] **Step 10: Verify client orchestration**

Run Step 4 plus:

```bash
npm run typecheck
npm run lint
```

Expected: all pass; test JSON and IPC output contain neither `%PDF-` bytes nor temporary source paths.

- [ ] **Step 11: Commit**

```bash
git add src/main/knowledge src/main/handlers src/main/ipcHandlers.ts src/preload src/shared
git commit -m "feat(knowledge): resume encrypted PDF upload queues"
```

---

### Task 6: Harden Publication and Seven-Day Cleanup

**Files:**

- Modify: `src/main/knowledge/ManagedKnowledgeService.ts`
- Modify: `src/main/knowledge/__tests__/ManagedKnowledgeService.test.ts`
- Modify: `src/main/knowledge/KnowledgeManagementCleanup.ts`
- Modify: `src/main/knowledge/__tests__/KnowledgeManagementCleanup.test.ts`
- Modify: `src/main/pocketbase/RetentionManager.test.ts`

**Interfaces:**

- `ManagedKnowledgeService.publish` and `replace` keep their command signatures.
- `KnowledgeManagementCleanup.run()` returns batch, upload, chunk, and audit deletion counts.

- [ ] **Step 1: Write failing publication lifecycle tests**

Prove the durable order:

```ts
expect(callOrder).toEqual([
  'create-document',
  'create-audit',
  'delete-staged-upload',
]);
```

Add an injected document-create failure and audit failure; each must preserve the staging record for
retry. Add administrator cross-account publication and publisher cross-account rejection.

- [ ] **Step 2: Write failing seven-day cleanup tests**

Create ready, uploading, failed, cancelled, and published fixtures around the exact seven-day cutoff.
Expect expired chunks before manifest/batch deletion, bounded audit metadata, and no deletion of
active or durable documents.

- [ ] **Step 3: Run lifecycle tests and verify RED**

```bash
npx vitest run \
  src/main/knowledge/__tests__/ManagedKnowledgeService.test.ts \
  src/main/knowledge/__tests__/KnowledgeManagementCleanup.test.ts \
  src/main/pocketbase/RetentionManager.test.ts
```

Expected: current publish leaves a staging duplicate for 24 hours and cleanup knows no chunks or
batches.

- [ ] **Step 4: Implement durable publish-then-delete**

Create/update the protected document first, write the audit event second, and delete staging third.
Use the existing request ID and coordinator for replay safety. Remove `completeUpload`'s
`state: 'published'` behavior.

- [ ] **Step 5: Implement hierarchical cleanup**

For each expired upload, delete chunks, then upload, then close an empty batch. For batch cancellation,
use the same idempotent order. Retain audit events for one year and never put source paths, tokens, or
checksums in audit details.

- [ ] **Step 6: Verify lifecycle and retention**

Run Step 3 plus `npm run typecheck`. Expected: all pass and published PDFs have only the durable
document copy after the command completes.

- [ ] **Step 7: Commit**

```bash
git add src/main/knowledge src/main/pocketbase
git commit -m "feat(knowledge): expire staged upload data safely"
```

---

### Task 7: Build the Responsive Batch Management UI

**Required skill before UI changes:** `impeccable`

**Files:**

- Modify: `src/renderer/src/features/knowledge/useKnowledgeManagement.ts`
- Modify: `src/renderer/src/features/knowledge/__tests__/useKnowledgeManagement.test.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx`
- Modify: `src/renderer/src/features/knowledge/knowledge.css`

**Interfaces:**

```ts
type KnowledgeUploadUiFilter = 'uploading' | 'staged' | 'failed' | 'all';

type KnowledgeManagementActions = {
  stagePdfs(): Promise<KnowledgeUploadSelectionResult>;
  pauseBatch(batchId: string): Promise<void>;
  resumeBatch(batchId: string): Promise<void>;
  cancelBatch(batchId: string): Promise<void>;
  retryUpload(uploadId: string): Promise<void>;
  reselectUpload(uploadId: string): Promise<void>;
  publishSelected(uploadIds: string[]): Promise<KnowledgeBulkPublishResult>;
};
```

- [ ] **Step 1: Audit the existing management workspace with Impeccable**

Preserve the established Relay visual language and document the minimal component hierarchy in the
task notes: batch summary, filter rail, virtualizable queue list, staged metadata editor, and actions.
Do not redesign the reader or unrelated tabs.

- [ ] **Step 2: Write failing hook tests**

Cover sanitized queue subscription, start/pause/resume/retry/cancel IPC, conflict refresh, sequential
bulk publish with per-file results, and cleanup on unmount.

- [ ] **Step 3: Write failing workspace tests**

Test:

- overall acknowledged bytes and file counts;
- per-file byte progress rather than milestones;
- uploading/staged/failed/all filters;
- paused-network, source-required, extracting, ready, and failed labels;
- Retry, Reselect, Pause, Resume, and Cancel actions;
- seven-day expiry copy;
- selected ready rows and `Publish selected`;
- exclusion of duplicate/conflict/failed rows; and
- usable ordering and labels at a 900px-wide viewport.

- [ ] **Step 4: Run renderer tests and verify RED**

```bash
node scripts/run-renderer-tests.mjs \
  useKnowledgeManagement.test.tsx \
  KnowledgeManagementWorkspace.test.tsx
```

Expected: queue controls, states, actual byte progress, and bulk selection do not exist.

- [ ] **Step 5: Implement hook orchestration**

Subscribe to sanitized queue snapshots, merge them with server staging snapshots by upload ID, expose
typed control methods, and publish selected ready uploads sequentially with independent results.
Refresh documents/staging after the batch completes or a server realtime update arrives.

- [ ] **Step 6: Implement the responsive workspace**

Use existing Relay typography, border, surface, chip, button, and focus tokens. Show a compact batch
summary, exact bytes, queue filters, row states, retry copy, selected count, and explicit publication.
At half-1080p widths stack the summary and controls, wrap row actions, truncate filenames with title
text, and preserve touch/click targets and keyboard focus.

- [ ] **Step 7: Verify UI and accessibility**

Run Step 4 plus:

```bash
node scripts/run-renderer-tests.mjs KnowledgeTab.test.tsx
npm run typecheck
npx eslint src/renderer/src/features/knowledge
```

Expected: all pass with state text independent of color and no renderer exposure of local paths.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/features/knowledge
git commit -m "feat(knowledge): manage resumable PDF batches"
```

---

### Task 8: Add Integration, VPN Recovery, and Soak Verification

**Files:**

- Create: `scripts/knowledge-upload-soak.mjs`
- Create: `scripts/knowledge-upload-soak.test.mjs`
- Modify: `tests/e2e/critical-path.spec.ts`
- Modify: `docs/SECURITY.md`
- Modify: `docs/architecture.md`
- Modify: `package.json`

**Interfaces:**

```json
{
  "scripts": {
    "test:knowledge-upload-soak": "node scripts/knowledge-upload-soak.mjs"
  }
}
```

- [ ] **Step 1: Write failing E2E coverage**

Extend the critical path to:

1. assign and configure a publisher locally;
2. create a publisher-targeted pairing challenge;
3. pair the simulated client laptop;
4. select a multi-file batch;
5. interrupt transport after at least one acknowledged chunk;
6. reconnect and verify only missing chunks transfer;
7. restart the client upload service;
8. reach staged ready state;
9. publish selected files; and
10. open a final protected PDF as an ordinary operator.

- [ ] **Step 2: Run the E2E test and verify RED**

```bash
npm run test:electron -- --grep "publisher resumes a Knowledge batch"
```

Expected: the current whole-file path and administrator-bound pairing cannot satisfy the flow.

- [ ] **Step 3: Add the bounded soak contract test**

Test the script's deterministic manifest, argument validation, cleanup, and summary using tiny fixture
sizes. The script must require an explicit `--full` flag before generating 50 MiB files.

- [ ] **Step 4: Implement the opt-in soak runner**

Default mode generates 100 small valid deterministic PDFs and reports file count, bytes, elapsed
time, retries, checksum failures, peak main-process memory, and server storage high-water mark. Full
mode generates up to 100 50 MiB PDFs only when explicitly requested and always removes artifacts in
a `finally` block.

- [ ] **Step 5: Update operational and security documentation**

Document PocketBase-only authority, 4 MiB chunks, two-request concurrency, encrypted local queue
metadata, seven-day staging, disk admission, target-account pairing, HTTP/VPN confidentiality, and
the no-new-port property. Remove folder watcher/migration descriptions.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:electron
npm run build
node scripts/knowledge-upload-soak.mjs
git diff --check
```

Expected:

- typecheck, lint, format, unit, cache, renderer, Electron, and build commands exit 0;
- the default 100-file soak reports 100 staged files and zero checksum failures;
- the worktree contains only intentional source, test, and documentation changes; and
- `rg -n "KnowledgeBaseManager|ManagedKnowledgeMigration|scanKnowledgeRoot" src` has no runtime
  matches.

- [ ] **Step 7: Perform a manual VPN-shaped acceptance check**

On the real server and paired publisher laptop, upload a representative batch while disconnecting
and reconnecting VPN once. Confirm acknowledged bytes do not fall backward, completed chunks are not
resent, the queue survives restarting Relay, staged PDFs remain private, and publication appears on
ordinary clients.

- [ ] **Step 8: Commit**

```bash
git add tests scripts docs package.json package-lock.json
git commit -m "test(knowledge): verify resumable publisher uploads"
```

---

## Final Review Gate

Before pushing or merging:

- Re-read `docs/superpowers/specs/2026-07-15-resumable-pocketbase-knowledge-uploads-design.md` and
  map every acceptance criterion to a passing test or explicit manual result.
- Inspect the committed diff for secrets, source paths, test PDFs, generated PocketBase data,
  ignored queue files, or binary artifacts.
- Confirm the server and one client can still connect through the existing PocketBase address.
- Confirm ordinary operators can read published PDFs but cannot list staged uploads or chunks.
- Confirm the publisher can pair and publish but cannot manage devices, operators, settings, or role
  assignments.
- Confirm no push occurs until the user explicitly asks to push.
