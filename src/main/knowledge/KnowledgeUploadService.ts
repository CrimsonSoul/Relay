import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import type { PublicPrivilegedCommandRequest } from '@shared/ipc';
import {
  KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  KNOWLEDGE_UPLOAD_MAX_FILES,
  normalizeKnowledgeUploadBatchStatusView,
  normalizeKnowledgeUploadBatchView,
  normalizeKnowledgeUploadManifestView,
  type KnowledgeManagementErrorCode,
  type KnowledgeUploadBatchStatusView,
  type KnowledgeUploadManifestView,
  type KnowledgeUploadQueueItemState,
  type KnowledgeUploadQueueItemView,
  type KnowledgeUploadQueueView,
  type KnowledgeUploadSelectionResult,
} from '@shared/knowledge';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';
import {
  KnowledgeSourceError,
  inspectKnowledgePdfCandidate,
  planKnowledgePdfSource,
  readKnowledgePdfChunk,
  revalidateKnowledgePdfSource,
  type KnowledgePdfCandidate,
  type KnowledgePdfSourcePlan,
} from './knowledgeChunking';
import {
  createEmptyKnowledgeUploadQueue,
  type KnowledgeUploadQueueEntry,
  type KnowledgeUploadQueueStore,
} from './KnowledgeUploadQueueStore';
import {
  KnowledgeUploadScheduler,
  type KnowledgeUploadSchedulerTask,
} from './KnowledgeUploadScheduler';

type KnowledgeUploadRuntime = {
  getView(): PrivilegedSessionView;
  createPrivilegedRecord(
    collection: string,
    data: Record<string, unknown> | FormData,
  ): Promise<Record<string, unknown> & { id: string }>;
  submitPublicCommand(input: PublicPrivilegedCommandRequest): Promise<PrivilegedCommandResult>;
};

type QueueStorePort = Pick<KnowledgeUploadQueueStore, 'load' | 'save'>;

type KnowledgeUploadServiceOptions = {
  getRuntime: () => KnowledgeUploadRuntime | null;
  store: QueueStorePort;
  scheduler?: KnowledgeUploadScheduler;
  selectFiles?: (window?: BrowserWindow, single?: boolean) => Promise<string[]>;
  inspectCandidate?: (path: string) => Promise<KnowledgePdfCandidate>;
  planSource?: (candidate: KnowledgePdfCandidate) => Promise<KnowledgePdfSourcePlan>;
  readChunk?: (plan: KnowledgePdfSourcePlan, index: number) => Promise<Uint8Array>;
  revalidateSource?: (plan: KnowledgePdfSourcePlan) => Promise<boolean>;
  emitSnapshot?: (snapshot: KnowledgeUploadQueueView) => void;
  createId?: () => string;
};

type ActiveUploadSession = PrivilegedSessionView & {
  accountId: string;
  deviceId: string;
  localSourceId: string;
};

async function defaultSelectFiles(window?: BrowserWindow, single = false): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    properties: single ? ['openFile'] : ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}

function activeUploadSession(
  runtime: KnowledgeUploadRuntime | null,
  localSourceId?: string,
): ActiveUploadSession | null {
  const session = runtime?.getView();
  if (
    !runtime ||
    session?.state !== 'active' ||
    !session.accountId ||
    !session.capabilities.includes('knowledge.manage')
  ) {
    return null;
  }
  return {
    ...session,
    accountId: session.accountId,
    deviceId: session.deviceId ?? 'server-local',
    localSourceId: localSourceId ?? session.deviceId ?? 'server-local',
  };
}

function sourcePlan(entry: KnowledgeUploadQueueEntry): KnowledgePdfSourcePlan | null {
  return entry.source.checksum ? { ...entry.source, checksum: entry.source.checksum } : null;
}

function acknowledgedBytes(entry: KnowledgeUploadQueueEntry): number {
  return entry.acknowledgedChunkIndexes.reduce((total, index) => {
    const start = index * KNOWLEDGE_UPLOAD_CHUNK_BYTES;
    return (
      total + Math.max(0, Math.min(KNOWLEDGE_UPLOAD_CHUNK_BYTES, entry.source.byteSize - start))
    );
  }, 0);
}

function isTerminal(state: KnowledgeUploadQueueItemState): boolean {
  return state === 'cancelled' || state === 'published' || state === 'ready';
}

function validReplacementSelection(
  paths: readonly string[],
  replacementDocumentId?: string,
): boolean {
  return (
    !replacementDocumentId ||
    (paths.length === 1 && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(replacementDocumentId))
  );
}

function needsServerReconciliation(state: KnowledgeUploadQueueItemState): boolean {
  return state !== 'cancelled' && state !== 'published';
}

function reconciliationFingerprint(entry: KnowledgeUploadQueueEntry): string {
  return JSON.stringify([
    entry.batchId,
    entry.batchRevision,
    entry.uploadId,
    entry.uploadRevision,
    entry.state,
    entry.safeError,
    entry.acknowledgedChunkIndexes,
  ]);
}

function isRetryablePreparationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  const status = (error as { status?: unknown }).status;
  return (
    status === 0 ||
    status === 408 ||
    status === 429 ||
    (typeof status === 'number' && status >= 500 && status <= 599)
  );
}

function privilegedErrorStatus(error: string): number {
  if (error === 'offline') return 0;
  if (error === 'server-error') return 500;
  return 400;
}

function resultError(error: string): never {
  throw Object.assign(new Error(error), {
    status: privilegedErrorStatus(error),
    code: error,
  });
}

function preparationFailure(error: unknown): {
  state: KnowledgeUploadQueueItemState;
  safeError: KnowledgeManagementErrorCode;
} {
  if (error instanceof KnowledgeSourceError && error.code === 'source-required') {
    return { state: 'source-required', safeError: 'source-required' };
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  if (code === 'unauthorized' || code === 'locked' || code === 'pairing-required') {
    return { state: 'failed', safeError: 'unauthorized' };
  }
  if (code === 'insufficient-storage') {
    return { state: 'failed', safeError: 'insufficient-storage' };
  }
  if (isRetryablePreparationError(error)) {
    return { state: 'paused-network', safeError: 'offline' };
  }
  return { state: 'failed', safeError: 'upload-failed' };
}

export class KnowledgeUploadService {
  private readonly getRuntime: () => KnowledgeUploadRuntime | null;
  private readonly store: QueueStorePort;
  private readonly scheduler: KnowledgeUploadScheduler;
  private readonly selectFiles: NonNullable<KnowledgeUploadServiceOptions['selectFiles']>;
  private readonly inspectCandidate: NonNullable<KnowledgeUploadServiceOptions['inspectCandidate']>;
  private readonly planSource: NonNullable<KnowledgeUploadServiceOptions['planSource']>;
  private readonly readChunk: NonNullable<KnowledgeUploadServiceOptions['readChunk']>;
  private readonly revalidateSource: NonNullable<KnowledgeUploadServiceOptions['revalidateSource']>;
  private readonly emitSnapshot: NonNullable<KnowledgeUploadServiceOptions['emitSnapshot']>;
  private readonly createId: () => string;
  private queue = createEmptyKnowledgeUploadQueue(false);
  private preparationTail: Promise<void> = Promise.resolve();
  private readonly preparationsByLocalId = new Map<string, Promise<void>>();
  private persistTail: Promise<void> = Promise.resolve();
  private activeSessionKey: string | null | undefined;
  private localSourceId: string | null = null;
  private started = false;
  private disposed = false;

  constructor(options: KnowledgeUploadServiceOptions) {
    this.getRuntime = options.getRuntime;
    this.store = options.store;
    this.scheduler = options.scheduler ?? new KnowledgeUploadScheduler();
    this.selectFiles = options.selectFiles ?? defaultSelectFiles;
    this.inspectCandidate = options.inspectCandidate ?? inspectKnowledgePdfCandidate;
    this.planSource = options.planSource ?? planKnowledgePdfSource;
    this.readChunk = options.readChunk ?? readKnowledgePdfChunk;
    this.revalidateSource = options.revalidateSource ?? revalidateKnowledgePdfSource;
    this.emitSnapshot = options.emitSnapshot ?? (() => undefined);
    this.createId = options.createId ?? randomUUID;
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    this.queue = await this.store.load();
    this.emit();
    const session = this.activeUploadSession();
    this.activeSessionKey = session ? `${session.accountId}\u0000${session.localSourceId}` : null;
    this.scheduler.setSessionActive(Boolean(session));
    if (!session) return;
    for (const entry of this.queue.entries) {
      if (
        entry.accountId === session.accountId &&
        this.entryLocalSourceId(entry) === session.localSourceId &&
        !isTerminal(entry.state)
      ) {
        this.enqueuePreparation(entry.localId, true);
      }
    }
  }

  async selectAndQueue(
    window?: BrowserWindow,
    replacementDocumentId?: string,
  ): Promise<KnowledgeUploadSelectionResult> {
    if (this.disposed) return { ok: false, error: 'offline' };
    const runtime = this.getRuntime();
    const session = activeUploadSession(runtime);
    if (!runtime || !session) {
      return { ok: false, error: runtime ? 'unauthorized' : 'offline' };
    }
    const paths = await this.selectFiles(window, Boolean(replacementDocumentId));
    if (paths.length === 0) return { ok: false, error: 'cancelled' };
    return this.queuePaths(paths, session.localSourceId, replacementDocumentId);
  }

  async queuePaths(
    paths: readonly string[],
    localSourceId: string,
    replacementDocumentId?: string,
  ): Promise<KnowledgeUploadSelectionResult> {
    if (this.disposed) return { ok: false, error: 'offline' };
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(localSourceId)) {
      return { ok: false, error: 'invalid-file' };
    }
    if (!validReplacementSelection(paths, replacementDocumentId)) {
      return { ok: false, error: 'invalid-file' };
    }
    if (this.localSourceId && this.localSourceId !== localSourceId) {
      return { ok: false, error: 'unauthorized' };
    }
    this.localSourceId = localSourceId;
    const runtime = this.getRuntime();
    const session = this.activeUploadSession();
    if (!runtime || !session) {
      return { ok: false, error: runtime ? 'unauthorized' : 'offline' };
    }
    await this.refresh();
    const activeEntries = this.queue.entries.filter((entry) => !isTerminal(entry.state));
    if (activeEntries.length > 0) return { ok: false, error: 'upload-failed' };
    if (paths.length > KNOWLEDGE_UPLOAD_MAX_FILES) return { ok: false, error: 'invalid-file' };

    const candidates: KnowledgePdfCandidate[] = [];
    const names = new Set<string>();
    try {
      for (const path of paths) {
        const candidate = await this.inspectCandidate(path);
        const nameKey = candidate.fileName.toLocaleLowerCase('en');
        if (names.has(nameKey)) return { ok: false, error: 'invalid-file' };
        names.add(nameKey);
        candidates.push(candidate);
      }
    } catch {
      return { ok: false, error: 'invalid-file' };
    }

    const batchRequestId = this.createId();
    const entries = candidates.map<KnowledgeUploadQueueEntry>((candidate) => ({
      localId: this.createId(),
      batchRequestId,
      batchId: null,
      batchRevision: 0,
      uploadId: null,
      uploadRevision: 0,
      accountId: session.accountId,
      deviceId: session.deviceId,
      localSourceId: session.localSourceId,
      ...(replacementDocumentId ? { replacementDocumentId } : {}),
      source: {
        ...candidate,
        checksum: null,
        chunkCount: Math.ceil(candidate.byteSize / KNOWLEDGE_UPLOAD_CHUNK_BYTES),
      },
      acknowledgedChunkIndexes: [],
      state: 'planning',
      safeError: null,
      retryCount: 0,
    }));
    this.queue = { version: 2, restartRecovery: false, entries };
    await this.persist();
    this.emit();
    for (const entry of entries) this.enqueuePreparation(entry.localId, false);
    return { ok: true, uploads: entries.map((entry) => this.itemView(entry)) };
  }

  snapshot(): KnowledgeUploadQueueView {
    const items = this.queue.entries.map((entry) => this.itemView(entry));
    return {
      restartRecovery: this.queue.restartRecovery,
      activeBatchId: this.queue.entries.find((entry) => !isTerminal(entry.state))?.batchId ?? null,
      totalBytes: items.reduce((total, item) => total + item.byteSize, 0),
      acknowledgedBytes: items.reduce((total, item) => total + item.acknowledgedBytes, 0),
      items,
    };
  }

  async refresh(): Promise<KnowledgeUploadQueueView> {
    const session = this.activeUploadSession();
    if (!session) return this.snapshot();
    const batchIds = new Set(
      this.queue.entries
        .filter(
          (entry) =>
            entry.batchId &&
            needsServerReconciliation(entry.state) &&
            entry.accountId === session.accountId &&
            this.entryLocalSourceId(entry) === session.localSourceId,
        )
        .map((entry) => entry.batchId as string),
    );
    let changed = false;
    for (const batchId of batchIds) {
      try {
        const status = await this.status(batchId);
        for (const entry of this.queue.entries) {
          if (entry.batchId !== batchId) continue;
          const upload = this.matchManifest(status, entry);
          if (!upload) continue;
          const prior = reconciliationFingerprint(entry);
          this.reconcile(entry, status, upload);
          changed ||= reconciliationFingerprint(entry) !== prior;
        }
      } catch {
        // Queue reads remain available while the server or VPN is temporarily unreachable.
      }
    }
    if (changed) await this.persistAndEmit();
    return this.snapshot();
  }

  pauseBatch(batchId: string): void {
    const entries = this.queue.entries.filter(
      (entry) => entry.batchId === batchId || entry.batchRequestId === batchId,
    );
    for (const entry of entries) {
      if (!isTerminal(entry.state)) this.updateEntry(entry, { state: 'paused', safeError: null });
    }
    const serverBatchId = entries[0]?.batchId;
    if (serverBatchId) this.scheduler.pauseBatch(serverBatchId);
    void this.persistAndEmit();
  }

  resumeBatch(batchId: string): void {
    const entries = this.queue.entries.filter(
      (entry) => entry.batchId === batchId || entry.batchRequestId === batchId,
    );
    const serverBatchId = entries[0]?.batchId;
    if (serverBatchId) this.scheduler.resumeBatch(serverBatchId);
    for (const entry of entries) {
      if (!isTerminal(entry.state)) {
        this.updateEntry(entry, { state: 'queued', safeError: null, retryCount: 0 });
        this.enqueuePreparation(entry.localId, true);
      }
    }
    void this.persistAndEmit();
  }

  retryUpload(id: string): void {
    const entry = this.findEntry(id);
    if (!entry || isTerminal(entry.state)) return;
    this.updateEntry(entry, { state: 'queued', safeError: null, retryCount: 0 });
    if (entry.uploadId) this.scheduler.retryUpload(entry.uploadId);
    this.enqueuePreparation(entry.localId, true);
    void this.persistAndEmit();
  }

  async reselectSource(id: string, window?: BrowserWindow): Promise<boolean> {
    const entry = this.findEntry(id);
    if (!entry?.source.checksum) return false;
    const paths = await this.selectFiles(window, true);
    if (paths.length !== 1) return false;
    try {
      const candidate = await this.inspectCandidate(paths[0]!);
      const plan = await this.planSource(candidate);
      if (
        plan.fileName !== entry.source.fileName ||
        plan.byteSize !== entry.source.byteSize ||
        plan.checksum !== entry.source.checksum
      ) {
        return false;
      }
      entry.source = plan;
      this.updateEntry(entry, { state: 'queued', safeError: null, retryCount: 0 });
      await this.persistAndEmit();
      this.enqueuePreparation(entry.localId, false);
      return true;
    } catch {
      return false;
    }
  }

  async cancelUpload(id: string): Promise<void> {
    const pendingEntry = this.findEntry(id);
    if (!pendingEntry) return;
    await this.awaitPendingPreparation(pendingEntry.localId);
    const entry = this.findEntry(pendingEntry.localId);
    if (!entry) return;
    let cancelWholeBatch = false;
    if (entry.uploadId) {
      await this.command({
        command: 'knowledge.upload.file.cancel',
        payload: { uploadId: entry.uploadId, expectedRevision: entry.uploadRevision },
        expectedRevision: null,
      });
      this.scheduler.cancelUpload(entry.uploadId);
    } else if (entry.batchId) {
      const status = await this.status(entry.batchId);
      entry.batchRevision = status.batch.revision;
      const upload = this.matchManifest(status, entry);
      if (upload) {
        entry.uploadId = upload.id;
        entry.uploadRevision = upload.revision;
        await this.command({
          command: 'knowledge.upload.file.cancel',
          payload: { uploadId: upload.id, expectedRevision: upload.revision },
          expectedRevision: null,
        });
        this.scheduler.cancelUpload(upload.id);
      } else {
        await this.command({
          command: 'knowledge.upload.batch.cancel',
          payload: { batchId: entry.batchId, expectedRevision: status.batch.revision },
          expectedRevision: null,
        });
        this.scheduler.cancelBatch(entry.batchId);
        cancelWholeBatch = true;
      }
    }
    if (cancelWholeBatch) {
      for (const candidate of this.queue.entries) {
        if (candidate.batchRequestId === entry.batchRequestId) {
          this.updateEntry(candidate, { state: 'cancelled', safeError: null });
        }
      }
      await this.persistAndEmit();
      return;
    }
    this.updateEntry(entry, { state: 'cancelled', safeError: null });
    await this.persistAndEmit();
  }

  async cancelBatch(id: string): Promise<void> {
    const entry = this.queue.entries.find(
      (candidate) => candidate.batchId === id || candidate.batchRequestId === id,
    );
    if (!entry) return;
    const localIds = this.queue.entries
      .filter((candidate) => candidate.batchRequestId === entry.batchRequestId)
      .map((candidate) => candidate.localId);
    await Promise.all(localIds.map((localId) => this.awaitPendingPreparation(localId)));
    const current = this.findEntry(entry.localId);
    if (!current) return;
    if (current.batchId) {
      const status = await this.status(current.batchId);
      current.batchRevision = status.batch.revision;
      await this.command({
        command: 'knowledge.upload.batch.cancel',
        payload: { batchId: current.batchId, expectedRevision: status.batch.revision },
        expectedRevision: null,
      });
      this.scheduler.cancelBatch(current.batchId);
    }
    for (const candidate of this.queue.entries) {
      if (candidate.batchRequestId === current.batchRequestId) {
        this.updateEntry(candidate, { state: 'cancelled', safeError: null });
      }
    }
    await this.persistAndEmit();
  }

  handleSessionChanged(view: PrivilegedSessionView): void {
    const session = view.state === 'active' ? this.activeUploadSession() : null;
    const sessionKey = session ? `${session.accountId}\u0000${session.localSourceId}` : null;
    if (sessionKey === this.activeSessionKey) return;
    this.activeSessionKey = sessionKey;
    this.scheduler.setSessionActive(Boolean(session));
    if (!session) return;
    for (const entry of this.queue.entries) {
      if (
        entry.accountId === session.accountId &&
        this.entryLocalSourceId(entry) === session.localSourceId &&
        !isTerminal(entry.state)
      ) {
        this.enqueuePreparation(entry.localId, true);
      }
    }
  }

  async whenIdle(): Promise<void> {
    while (true) {
      const preparation = this.preparationTail;
      await preparation;
      await this.scheduler.whenIdle();
      await this.persistTail;
      if (preparation === this.preparationTail) return;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.preparationTail;
    await this.scheduler.dispose();
    await this.persistTail;
  }

  private enqueuePreparation(localId: string, restore: boolean): void {
    if (this.disposed) return;
    const preparation = this.preparationTail
      .then(() => this.prepare(localId, restore))
      .catch(() => undefined);
    this.preparationTail = preparation;
    this.preparationsByLocalId.set(localId, preparation);
    void preparation.then(() => {
      if (this.preparationsByLocalId.get(localId) === preparation) {
        this.preparationsByLocalId.delete(localId);
      }
    });
  }

  private async awaitPendingPreparation(localId: string): Promise<void> {
    while (true) {
      const preparation = this.preparationsByLocalId.get(localId);
      if (!preparation) return;
      await preparation;
      if (this.preparationsByLocalId.get(localId) === preparation) return;
    }
  }

  private async prepare(localId: string, restore: boolean): Promise<void> {
    const entry = this.findEntry(localId);
    if (!entry || isTerminal(entry.state) || entry.state === 'paused') return;
    const runtime = this.getRuntime();
    const session = this.activeUploadSession();
    if (!this.sessionMatchesEntry(session, entry)) {
      const safeError = runtime ? 'unauthorized' : 'offline';
      this.updateEntry(entry, { state: 'paused', safeError });
      await this.persistAndEmit();
      return;
    }
    try {
      const plan = await this.ensureSourcePlan(entry, restore);
      if (!plan) return;
      const batchId = await this.ensureBatch(entry);
      const { status, upload } = await this.ensureUpload(entry, batchId, plan);
      this.reconcile(entry, status, upload);
      await this.persistAndEmit();
      if (!isTerminal(entry.state)) this.scheduler.enqueue(this.schedulerTask(entry));
    } catch (error) {
      this.updateEntry(entry, preparationFailure(error));
      await this.persistAndEmit();
    }
  }

  private sessionMatchesEntry(
    session: ActiveUploadSession | null,
    entry: KnowledgeUploadQueueEntry,
  ): session is ActiveUploadSession {
    return Boolean(
      session?.accountId === entry.accountId &&
      session.localSourceId === this.entryLocalSourceId(entry),
    );
  }

  private activeUploadSession(): ActiveUploadSession | null {
    return activeUploadSession(this.getRuntime(), this.localSourceId ?? undefined);
  }

  private entryLocalSourceId(entry: KnowledgeUploadQueueEntry): string {
    return entry.localSourceId ?? entry.deviceId;
  }

  private async ensureSourcePlan(
    entry: KnowledgeUploadQueueEntry,
    restore: boolean,
  ): Promise<KnowledgePdfSourcePlan | null> {
    const existing = sourcePlan(entry);
    if (existing) {
      if (!restore || (await this.revalidateSource(existing))) return existing;
      this.updateEntry(entry, { state: 'source-required', safeError: 'source-required' });
      await this.persistAndEmit();
      return null;
    }
    const created = await this.planSource(entry.source);
    entry.source = created;
    await this.persistAndEmit();
    return created;
  }

  private async ensureBatch(entry: KnowledgeUploadQueueEntry): Promise<string> {
    if (entry.batchId) return entry.batchId;
    const entries = this.queue.entries.filter(
      (candidate) => candidate.batchRequestId === entry.batchRequestId,
    );
    const result = await this.command({
      command: 'knowledge.upload.batch.begin',
      payload: {
        requestId: entry.batchRequestId,
        fileCount: entries.length,
        totalBytes: entries.reduce((total, candidate) => total + candidate.source.byteSize, 0),
      },
      expectedRevision: null,
    });
    const batch = normalizeKnowledgeUploadBatchView(result.value);
    if (!batch) throw new Error('invalid-batch-response');
    for (const candidate of entries) {
      candidate.batchId = batch.id;
      candidate.batchRevision = batch.revision;
      if (candidate.state === 'planning') candidate.state = 'queued';
    }
    await this.persistAndEmit();
    return batch.id;
  }

  private async ensureUpload(
    entry: KnowledgeUploadQueueEntry,
    batchId: string,
    plan: KnowledgePdfSourcePlan,
  ): Promise<{ status: KnowledgeUploadBatchStatusView; upload: KnowledgeUploadManifestView }> {
    const status = await this.status(batchId);
    if (entry.batchId !== status.batch.id || entry.batchRevision !== status.batch.revision) {
      entry.batchId = status.batch.id;
      entry.batchRevision = status.batch.revision;
      await this.persistAndEmit();
    }
    const existing = this.matchManifest(status, entry);
    if (existing) return { status, upload: existing };
    const result = await this.command({
      command: 'knowledge.upload.file.begin',
      payload: {
        batchId,
        fileName: plan.fileName,
        byteSize: plan.byteSize,
        checksum: plan.checksum,
        chunkCount: plan.chunkCount,
        ...(entry.replacementDocumentId
          ? { replacementDocumentId: entry.replacementDocumentId }
          : {}),
      },
      expectedRevision: null,
    });
    const upload = normalizeKnowledgeUploadManifestView(result.value);
    if (!upload) throw new Error('invalid-upload-response');
    return { status, upload };
  }

  private schedulerTask(entry: KnowledgeUploadQueueEntry): KnowledgeUploadSchedulerTask {
    const uploadId = entry.uploadId!;
    const batchId = entry.batchId!;
    let initialMissingChunkIndexes: number[] | null = Array.from(
      { length: entry.source.chunkCount },
      (_, index) => index,
    ).filter((index) => !entry.acknowledgedChunkIndexes.includes(index));
    return {
      uploadId,
      batchId,
      byteSize: entry.source.byteSize,
      getMissingChunkIndexes: async () => {
        // Preparation has just reconciled the authoritative server status.
        // Reuse that result once instead of immediately issuing a duplicate
        // signed status command; later scheduler runs still re-query PocketBase.
        if (initialMissingChunkIndexes) {
          const missing = initialMissingChunkIndexes;
          initialMissingChunkIndexes = null;
          return missing;
        }
        const status = await this.status(batchId);
        const upload = this.matchManifest(status, entry);
        if (!upload) throw Object.assign(new Error('upload-not-found'), { status: 404 });
        this.reconcile(entry, status, upload);
        await this.persistAndEmit();
        return upload.missingChunkIndexes;
      },
      readChunk: async (index) => {
        const plan = sourcePlan(entry);
        if (!plan) throw new KnowledgeSourceError('source-required');
        return this.readChunk(plan, index);
      },
      uploadChunk: async (index, bytes, signal) => {
        if (signal.aborted) throw Object.assign(new Error('aborted'), { status: 0 });
        const form = new FormData();
        form.set('uploadId', uploadId);
        form.set('batchId', batchId);
        form.set('accountId', entry.accountId);
        form.set('deviceId', entry.deviceId);
        form.set('index', String(index));
        form.set('byteSize', String(bytes.byteLength));
        form.set('checksum', createHash('sha256').update(bytes).digest('hex'));
        const buffer = Uint8Array.from(bytes).buffer;
        form.set(
          'chunk',
          new Blob([buffer], { type: 'application/octet-stream' }),
          `${basename(entry.source.fileName, '.pdf')}.part-${String(index + 1).padStart(3, '0')}`,
        );
        const runtime = this.getRuntime();
        if (!runtime) throw Object.assign(new Error('offline'), { status: 0 });
        await runtime.createPrivilegedRecord(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION, form);
      },
      finalize: async () => {
        const result = await this.command({
          command: 'knowledge.upload.file.finalize',
          payload: { uploadId, expectedRevision: entry.uploadRevision },
          expectedRevision: null,
        });
        const upload = normalizeKnowledgeUploadManifestView(result.value);
        if (!upload) throw new Error('invalid-finalize-response');
        entry.uploadRevision = upload.revision;
        this.updateEntry(entry, { state: upload.state, safeError: upload.safeError });
        await this.persistAndEmit();
      },
      onAcknowledged: (index) => {
        if (!entry.acknowledgedChunkIndexes.includes(index)) {
          entry.acknowledgedChunkIndexes.push(index);
          entry.acknowledgedChunkIndexes.sort((left, right) => left - right);
        }
        this.updateEntry(entry, { state: 'uploading', safeError: null });
        void this.persistAndEmit();
      },
      onState: (state, safeError, retryCount) => {
        this.updateEntry(entry, { state, safeError, retryCount });
        void this.persistAndEmit();
      },
    };
  }

  private async status(batchId: string): Promise<KnowledgeUploadBatchStatusView> {
    const result = await this.command({
      command: 'knowledge.upload.status',
      payload: { batchId },
      expectedRevision: null,
    });
    const status = normalizeKnowledgeUploadBatchStatusView(result.value);
    if (!status) throw new Error('invalid-status-response');
    return status;
  }

  private matchManifest(
    status: KnowledgeUploadBatchStatusView,
    entry: KnowledgeUploadQueueEntry,
  ): KnowledgeUploadManifestView | null {
    if (entry.uploadId) {
      const byId = status.uploads.find((upload) => upload.id === entry.uploadId);
      if (byId) return byId;
    }
    return (
      status.uploads.find(
        (upload) =>
          upload.fileName === entry.source.fileName &&
          upload.byteSize === entry.source.byteSize &&
          upload.checksum === entry.source.checksum,
      ) ?? null
    );
  }

  private reconcile(
    entry: KnowledgeUploadQueueEntry,
    status: KnowledgeUploadBatchStatusView,
    upload: KnowledgeUploadManifestView,
  ): void {
    entry.batchId = status.batch.id;
    entry.batchRevision = status.batch.revision;
    entry.uploadId = upload.id;
    entry.uploadRevision = upload.revision;
    entry.acknowledgedChunkIndexes = Array.from(
      { length: upload.chunkCount },
      (_, index) => index,
    ).filter((index) => !upload.missingChunkIndexes.includes(index));
    this.updateEntry(entry, { state: upload.state, safeError: upload.safeError });
  }

  private async command(
    request: PublicPrivilegedCommandRequest,
  ): Promise<Extract<PrivilegedCommandResult, { ok: true }>> {
    const runtime = this.getRuntime();
    if (!runtime) resultError('offline');
    const result = await runtime.submitPublicCommand(request);
    if (!result.ok) resultError(result.error);
    return result;
  }

  private findEntry(id: string): KnowledgeUploadQueueEntry | undefined {
    return this.queue.entries.find((entry) => entry.localId === id || entry.uploadId === id);
  }

  private updateEntry(
    entry: KnowledgeUploadQueueEntry,
    patch: Partial<Pick<KnowledgeUploadQueueEntry, 'state' | 'safeError' | 'retryCount'>>,
  ): void {
    Object.assign(entry, patch);
  }

  private itemView(entry: KnowledgeUploadQueueEntry): KnowledgeUploadQueueItemView {
    return {
      id: entry.localId,
      uploadId: entry.uploadId,
      batchId: entry.batchId ?? entry.batchRequestId,
      fileName: entry.source.fileName,
      byteSize: entry.source.byteSize,
      acknowledgedBytes: acknowledgedBytes(entry),
      chunkCount: entry.source.chunkCount,
      acknowledgedChunkCount: entry.acknowledgedChunkIndexes.length,
      state: entry.state,
      safeError: entry.safeError,
      retryCount: entry.retryCount,
      restartRecovery: this.queue.restartRecovery,
    };
  }

  private async persist(): Promise<void> {
    const snapshot = structuredClone(this.queue);
    this.persistTail = this.persistTail.then(() => this.store.save(snapshot));
    await this.persistTail;
  }

  private async persistAndEmit(): Promise<void> {
    await this.persist();
    this.emit();
  }

  private emit(): void {
    this.emitSnapshot(this.snapshot());
  }
}
