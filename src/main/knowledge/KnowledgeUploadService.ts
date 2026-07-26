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
  KNOWLEDGE_UPLOAD_MAX_QUEUE_ENTRIES,
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

type CancellationTarget = Pick<KnowledgeUploadManifestView, 'id' | 'revision'>;

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

function isCancellationSettled(state: KnowledgeUploadQueueItemState): boolean {
  return state === 'cancelled' || state === 'published';
}

function isTransferable(state: KnowledgeUploadQueueItemState): boolean {
  return state === 'queued' || state === 'uploading';
}

function isAuthoritativeTransferTerminal(state: KnowledgeUploadManifestView['state']): boolean {
  return state !== 'queued' && state !== 'uploading';
}

function isAuthoritativeProcessingState(state: KnowledgeUploadQueueItemState): boolean {
  return state === 'assembling' || state === 'validating' || state === 'extracting';
}

function isLocalActionableSuspension(state: KnowledgeUploadQueueItemState): boolean {
  return (
    state === 'paused' ||
    state === 'paused-network' ||
    state === 'source-required' ||
    state === 'failed'
  );
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

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
}

function cancellationSafeError(error: unknown): KnowledgeManagementErrorCode {
  if (error instanceof PreparationSessionChangedError) return 'unauthorized';
  const code = errorCode(error);
  if (code === 'conflict') return 'conflict';
  if (code === 'not-found') return 'not-found';
  if (code === 'unauthorized' || code === 'locked' || code === 'pairing-required') {
    return 'unauthorized';
  }
  if (isRetryablePreparationError(error)) return 'offline';
  return 'server-error';
}

class PreparationSessionChangedError extends Error {
  constructor() {
    super('upload-session-changed');
    this.name = 'PreparationSessionChangedError';
  }
}

class PreparationStoppedError extends Error {
  constructor() {
    super('upload-preparation-stopped');
    this.name = 'PreparationStoppedError';
  }
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
  private cancellationTail: Promise<void> = Promise.resolve();
  private readonly cancellationsByLocalId = new Map<string, Promise<void>>();
  private readonly retryRequests = new Set<string>();
  private readonly batchResolutions = new Map<string, Promise<string>>();
  private persistTail: Promise<void> = Promise.resolve();
  private activeSessionKey: string | null | undefined;
  private readonly localSourceBindings = new Map<string, string>();
  private controlGeneration = 0;
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
    this.activeSessionKey = this.sessionKey(session);
    this.scheduler.setSessionActive(Boolean(session));
    if (!session) return;
    for (const entry of this.queue.entries) {
      if (
        entry.accountId === session.accountId &&
        this.entryLocalSourceId(entry) === session.localSourceId &&
        (entry.cancelRequested || !isTerminal(entry.state))
      ) {
        if (entry.cancelRequested) this.enqueueCancellation(entry.localId);
        else this.enqueuePreparation(entry.localId, true);
      }
    }
  }

  async selectAndQueue(
    window?: BrowserWindow,
    replacementDocumentId?: string,
  ): Promise<KnowledgeUploadSelectionResult> {
    if (this.disposed) return { ok: false, error: 'offline' };
    const runtime = this.getRuntime();
    const session = this.uploadSessionForRuntime(runtime);
    if (!runtime || !session) {
      return { ok: false, error: runtime ? 'unauthorized' : 'offline' };
    }
    const paths = await this.selectFiles(window, Boolean(replacementDocumentId));
    if (paths.length === 0) return { ok: false, error: 'cancelled' };
    if (!this.matchesCurrentSession(session)) {
      return { ok: false, error: 'unauthorized' };
    }
    return this.queuePathsForSession(paths, session, replacementDocumentId);
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
    const runtime = this.getRuntime();
    const baseSession = activeUploadSession(runtime);
    if (!runtime || !baseSession) {
      return { ok: false, error: runtime ? 'unauthorized' : 'offline' };
    }
    const binding = this.localSourceBindings.get(this.localSourceBindingKey(baseSession));
    if (binding && binding !== localSourceId) {
      return { ok: false, error: 'unauthorized' };
    }
    const session = { ...baseSession, localSourceId };
    return this.queuePathsForSession(paths, session, replacementDocumentId);
  }

  private async queuePathsForSession(
    paths: readonly string[],
    session: ActiveUploadSession,
    replacementDocumentId?: string,
  ): Promise<KnowledgeUploadSelectionResult> {
    await this.refresh(session);
    if (!this.matchesCurrentSession(session)) {
      return { ok: false, error: 'unauthorized' };
    }
    const activeEntries = this.queue.entries.filter(
      (entry) =>
        this.sessionMatchesEntry(session, entry) &&
        (entry.cancelRequested || !isTerminal(entry.state)),
    );
    if (activeEntries.length > 0) return { ok: false, error: 'upload-failed' };
    if (paths.length > KNOWLEDGE_UPLOAD_MAX_FILES) return { ok: false, error: 'invalid-file' };
    const candidates: KnowledgePdfCandidate[] = [];
    const names = new Set<string>();
    try {
      for (const path of paths) {
        const candidate = await this.inspectCandidate(path);
        if (!this.matchesCurrentSession(session)) {
          return { ok: false, error: 'unauthorized' };
        }
        const nameKey = candidate.fileName.toLocaleLowerCase('en');
        if (names.has(nameKey)) return { ok: false, error: 'invalid-file' };
        names.add(nameKey);
        candidates.push(candidate);
      }
    } catch {
      return { ok: false, error: 'invalid-file' };
    }
    if (!this.matchesCurrentSession(session)) {
      return { ok: false, error: 'unauthorized' };
    }
    const currentActiveEntries = this.queue.entries.filter(
      (entry) =>
        this.sessionMatchesEntry(session, entry) &&
        (entry.cancelRequested || !isTerminal(entry.state)),
    );
    if (currentActiveEntries.length > 0) {
      return { ok: false, error: 'upload-failed' };
    }
    const retainedEntries = this.queue.entries.filter(
      (entry) => !this.sessionMatchesEntry(session, entry),
    );
    if (retainedEntries.length + paths.length > KNOWLEDGE_UPLOAD_MAX_QUEUE_ENTRIES) {
      return { ok: false, error: 'invalid-file' };
    }
    const bindingKey = this.localSourceBindingKey(session);
    const binding = this.localSourceBindings.get(bindingKey);
    if (binding && binding !== session.localSourceId) {
      return { ok: false, error: 'unauthorized' };
    }
    this.localSourceBindings.set(bindingKey, session.localSourceId);

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
    this.queue = {
      version: 2,
      restartRecovery: false,
      entries: [...retainedEntries, ...entries],
    };
    await this.persist();
    this.emit();
    for (const entry of entries) this.enqueuePreparation(entry.localId, false);
    return { ok: true, uploads: entries.map((entry) => this.itemView(entry)) };
  }

  snapshot(): KnowledgeUploadQueueView {
    const entries = this.visibleEntries();
    const items = entries.map((entry) => this.itemView(entry));
    return {
      restartRecovery: this.queue.restartRecovery,
      activeBatchId: entries.find((entry) => !isTerminal(entry.state))?.batchId ?? null,
      totalBytes: items.reduce((total, item) => total + item.byteSize, 0),
      acknowledgedBytes: items.reduce((total, item) => total + item.acknowledgedBytes, 0),
      items,
    };
  }

  async refresh(sessionOverride?: ActiveUploadSession): Promise<KnowledgeUploadQueueView> {
    const session = sessionOverride ?? this.activeUploadSession();
    if (!session) return this.snapshot();
    let changed = false;
    for (const batchId of this.reconciliationBatchIds(session)) {
      changed = (await this.reconcileBatch(batchId, session)) || changed;
      if (!this.matchesCurrentSession(session)) return this.snapshot();
    }
    if (!this.matchesCurrentSession(session)) return this.snapshot();
    if (changed) await this.persistAndEmit();
    if (!this.matchesCurrentSession(session)) return this.snapshot();
    this.resumePendingCancellations(session);
    return this.snapshot();
  }

  private reconciliationBatchIds(session: ActiveUploadSession): Set<string> {
    return new Set(
      this.queue.entries
        .filter(
          (entry) =>
            entry.batchId &&
            needsServerReconciliation(entry.state) &&
            entry.accountId === session.accountId &&
            entry.deviceId === session.deviceId &&
            this.entryLocalSourceId(entry) === session.localSourceId,
        )
        .map((entry) => entry.batchId as string),
    );
  }

  private async reconcileBatch(batchId: string, session: ActiveUploadSession): Promise<boolean> {
    try {
      const status = await this.statusForSession(session, batchId);
      let changed = false;
      for (const entry of this.queue.entries) {
        if (entry.batchId !== batchId || !this.sessionMatchesEntry(session, entry)) continue;
        const upload = this.matchManifest(status, entry);
        if (!upload) continue;
        const prior = reconciliationFingerprint(entry);
        this.reconcile(entry, status, upload);
        changed ||= reconciliationFingerprint(entry) !== prior;
      }
      return changed;
    } catch {
      // Queue reads remain available while the server or VPN is temporarily unreachable.
      return false;
    }
  }

  private resumePendingCancellations(session: ActiveUploadSession): void {
    for (const entry of this.queue.entries) {
      if (
        entry.cancelRequested &&
        !isCancellationSettled(entry.state) &&
        this.sessionMatchesEntry(session, entry)
      ) {
        this.enqueueCancellation(entry.localId);
      }
    }
  }

  pauseBatch(batchId: string): void {
    const entries = this.controllableBatchEntries(batchId);
    for (const entry of entries) {
      if (!isTerminal(entry.state) && !entry.cancelRequested) {
        this.updateEntry(entry, { state: 'paused', safeError: null });
      }
    }
    const serverBatchId = entries[0]?.batchId;
    if (entries.length > 0) this.controlGeneration += 1;
    if (serverBatchId) this.scheduler.pauseBatch(serverBatchId);
    void this.persistAndEmit();
  }

  resumeBatch(batchId: string): void {
    const entries = this.controllableBatchEntries(batchId);
    const serverBatchId = entries[0]?.batchId;
    if (entries.length > 0) this.controlGeneration += 1;
    for (const entry of entries) {
      if (!isTerminal(entry.state) && !entry.cancelRequested) {
        this.updateEntry(entry, { state: 'queued', safeError: null, retryCount: 0 });
        this.enqueuePreparation(entry.localId, true);
      }
    }
    if (serverBatchId) this.scheduler.resumeBatch(serverBatchId);
    void this.persistAndEmit();
  }

  retryUpload(id: string): void {
    const entry = this.findControllableEntry(id);
    if (!entry || isTerminal(entry.state) || entry.cancelRequested) return;
    this.controlGeneration += 1;
    this.retryRequests.add(entry.localId);
    this.updateEntry(entry, { state: 'queued', safeError: null, retryCount: 0 });
    this.enqueuePreparation(entry.localId, true);
    void this.persistAndEmit();
  }

  async reselectSource(id: string, window?: BrowserWindow): Promise<boolean> {
    const entry = this.findControllableEntry(id);
    if (!entry?.source.checksum || entry.cancelRequested || isTerminal(entry.state)) return false;
    const session = this.activeUploadSession();
    if (!this.sessionMatchesEntry(session, entry)) return false;
    const generation = this.controlGeneration;
    const paths = await this.selectFiles(window, true);
    if (paths.length !== 1) return false;
    if (!this.reselectionCurrent(entry, session, generation)) return false;
    try {
      const candidate = await this.inspectCandidate(paths[0]!);
      if (!this.reselectionCurrent(entry, session, generation)) return false;
      const plan = await this.planSource(candidate);
      if (!this.reselectionCurrent(entry, session, generation)) return false;
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
    const entry = this.findControllableEntry(id);
    if (!entry || isCancellationSettled(entry.state)) return;
    if (!entry.cancelRequested) {
      this.controlGeneration += 1;
      entry.cancelRequested = true;
      this.updateEntry(entry, { state: 'paused', safeError: null, retryCount: 0 });
      await this.persistAndEmit();
    }
    const existing = this.cancellationsByLocalId.get(entry.localId);
    if (existing) return existing;
    return this.scheduleCancellation(entry.localId);
  }

  private enqueueCancellation(localId: string): void {
    if (this.cancellationsByLocalId.has(localId) || this.disposed) return;
    void this.scheduleCancellation(localId).catch(() => undefined);
  }

  private scheduleCancellation(localId: string): Promise<void> {
    const operation = this.cancellationTail.then(() => this.continueCancellation(localId));
    this.cancellationTail = operation.catch(() => undefined);
    this.cancellationsByLocalId.set(localId, operation);
    const cleanup = () => {
      if (this.cancellationsByLocalId.get(localId) === operation) {
        this.cancellationsByLocalId.delete(localId);
      }
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }

  private async continueCancellation(localId: string): Promise<void> {
    try {
      const initial = this.findEntry(localId);
      if (!initial?.cancelRequested || isCancellationSettled(initial.state)) return;
      const firstQuiesce = initial.uploadId
        ? this.scheduler.quiesceUpload(initial.uploadId)
        : Promise.resolve();
      await this.awaitPendingPreparation(localId);
      await firstQuiesce;
      const entry = this.findEntry(localId);
      if (!entry?.cancelRequested || isCancellationSettled(entry.state)) return;
      this.assertCancellationCurrent(entry);
      if (entry.uploadId && entry.uploadId !== initial.uploadId) {
        await this.scheduler.quiesceUpload(entry.uploadId);
      }
      if (!entry.batchId) {
        await this.resolveBatch(entry);
        this.assertCancellationCurrent(entry);
      }
      const status = await this.statusForOwnedEntry(entry, entry.batchId!);
      if (status.batch.state === 'cancelled') {
        await this.finishCancellation(entry, 'cancelled');
        return;
      }
      const upload = this.matchManifest(status, entry);
      if (upload) {
        this.reconcile(entry, status, upload);
        await this.persistAndEmit();
        if (await this.finishFromAuthoritativeCancellationState(entry, upload)) return;
        await this.scheduler.quiesceUpload(upload.id);
        await this.cancelServerUpload(entry, upload);
        return;
      }
      if (entry.uploadId) {
        await this.scheduler.quiesceUpload(entry.uploadId);
        await this.cancelServerUpload(entry, {
          id: entry.uploadId,
          revision: entry.uploadRevision,
        });
        return;
      }
      const plan = sourcePlan(entry) ?? (await this.planCancellationSource(entry));
      const created = await this.beginUploadForCancellation(entry, status, plan);
      await this.scheduler.quiesceUpload(created.id);
      await this.cancelServerUpload(entry, created);
    } catch (error) {
      await this.recordCancellationFailure(localId, error);
      throw error;
    }
  }

  private async recordCancellationFailure(localId: string, error: unknown): Promise<void> {
    if (error instanceof PreparationSessionChangedError) return;
    const entry = this.findEntry(localId);
    if (!entry?.cancelRequested || isCancellationSettled(entry.state)) return;
    this.updateEntry(entry, {
      state: 'paused',
      safeError: cancellationSafeError(error),
      retryCount: 0,
    });
    await this.persistAndEmit();
  }

  private async beginUploadForCancellation(
    entry: KnowledgeUploadQueueEntry,
    status: KnowledgeUploadBatchStatusView,
    plan: KnowledgePdfSourcePlan,
  ): Promise<KnowledgeUploadManifestView> {
    this.assertCancellationCurrent(entry);
    entry.batchRevision = Math.max(entry.batchRevision, status.batch.revision);
    const result = await this.commandForOwnedEntry(entry, {
      command: 'knowledge.upload.file.begin',
      payload: {
        batchId: status.batch.id,
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
    entry.uploadId = upload.id;
    entry.uploadRevision = upload.revision;
    await this.persistAndEmit();
    return upload;
  }

  private async planCancellationSource(
    entry: KnowledgeUploadQueueEntry,
  ): Promise<KnowledgePdfSourcePlan> {
    this.assertCancellationCurrent(entry);
    const plan = await this.planSource(entry.source);
    this.assertCancellationCurrent(entry);
    entry.source = plan;
    await this.persistAndEmit();
    return plan;
  }

  private async cancelServerUpload(
    entry: KnowledgeUploadQueueEntry,
    initialUpload: CancellationTarget,
  ): Promise<void> {
    let upload: CancellationTarget = initialUpload;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.assertCancellationCurrent(entry);
        await this.commandForOwnedEntry(entry, {
          command: 'knowledge.upload.file.cancel',
          payload: { uploadId: upload.id, expectedRevision: upload.revision },
          expectedRevision: null,
        });
        await this.finishCancellation(entry, 'cancelled');
        return;
      } catch (error) {
        lastError = error;
        if (!entry.batchId) break;
        this.assertCancellationCurrent(entry);
        const status = await this.statusForOwnedEntry(entry, entry.batchId);
        const authoritative = status.uploads.find((candidate) => candidate.id === upload.id);
        if (!authoritative) throw error;
        this.reconcile(entry, status, authoritative);
        await this.persistAndEmit();
        if (await this.finishFromAuthoritativeCancellationState(entry, authoritative)) return;
        upload = authoritative;
      }
    }
    throw lastError;
  }

  private async finishFromAuthoritativeCancellationState(
    entry: KnowledgeUploadQueueEntry,
    upload: KnowledgeUploadManifestView,
  ): Promise<boolean> {
    if (upload.state === 'cancelled') {
      await this.finishCancellation(entry, 'cancelled');
      return true;
    }
    if (upload.state === 'published') {
      await this.finishCancellation(entry, 'published');
      return true;
    }
    return false;
  }

  private async finishCancellation(
    entry: KnowledgeUploadQueueEntry,
    state: 'cancelled' | 'published',
  ): Promise<void> {
    delete entry.cancelRequested;
    this.updateEntry(entry, { state, safeError: null, retryCount: 0 });
    if (entry.uploadId) this.scheduler.retireUpload(entry.uploadId);
    await this.persistAndEmit();
  }

  async cancelBatch(id: string): Promise<void> {
    const entry = this.controllableBatchEntries(id)[0];
    if (!entry) return;
    const candidates = this.queue.entries.filter(
      (candidate) =>
        candidate.batchRequestId === entry.batchRequestId &&
        this.sessionMatchesEntry(this.activeUploadSession(), candidate),
    );
    this.markBatchCancellationPending(candidates);
    const pendingCandidates = candidates.filter(
      (candidate) => candidate.cancelRequested && !isCancellationSettled(candidate.state),
    );
    if (pendingCandidates.length === 0) return;
    await this.persistAndEmit();
    const localIds = pendingCandidates.map((candidate) => candidate.localId);
    await Promise.all(localIds.map((localId) => this.awaitPendingPreparation(localId)));
    try {
      if (candidates.some((candidate) => candidate.state === 'published')) {
        await this.cancelPendingBatchFiles(pendingCandidates);
        return;
      }
      const current = pendingCandidates
        .map((candidate) => this.findEntry(candidate.localId))
        .find((candidate) => candidate?.cancelRequested && !isCancellationSettled(candidate.state));
      if (!current) return;
      this.assertCancellationCurrent(current);
      const batchId = current.batchId ?? (await this.resolveBatch(current));
      this.assertCancellationCurrent(current);
      const fallbackStatus = await this.cancelServerBatch(current, batchId);
      if (fallbackStatus) {
        this.reconcileBatchCancellationCandidates(candidates, fallbackStatus);
        await this.persistAndEmit();
        await this.cancelPendingBatchFiles(pendingCandidates);
        return;
      }
      this.finishBatchCancellation(candidates);
      await this.persistAndEmit();
    } catch (error) {
      if (error instanceof PreparationSessionChangedError) throw error;
      this.failBatchCancellation(candidates, error);
      await this.persistAndEmit();
      throw error;
    }
  }

  private markBatchCancellationPending(candidates: KnowledgeUploadQueueEntry[]): void {
    for (const candidate of candidates) {
      if (isCancellationSettled(candidate.state)) continue;
      candidate.cancelRequested = true;
      this.updateEntry(candidate, { state: 'paused', safeError: null, retryCount: 0 });
    }
  }

  private async cancelPendingBatchFiles(candidates: KnowledgeUploadQueueEntry[]): Promise<void> {
    for (const candidate of candidates) {
      const current = this.findEntry(candidate.localId);
      if (!current?.cancelRequested || isCancellationSettled(current.state)) continue;
      const operation =
        this.cancellationsByLocalId.get(current.localId) ??
        this.scheduleCancellation(current.localId);
      await operation;
    }
  }

  private reconcileBatchCancellationCandidates(
    candidates: KnowledgeUploadQueueEntry[],
    status: KnowledgeUploadBatchStatusView,
  ): void {
    for (const candidate of candidates) {
      const upload = this.matchManifest(status, candidate);
      if (upload) this.reconcile(candidate, status, upload);
    }
  }

  private async cancelServerBatch(
    entry: KnowledgeUploadQueueEntry,
    batchId: string,
  ): Promise<KnowledgeUploadBatchStatusView | null> {
    await this.scheduler.quiesceBatch(batchId);
    this.assertCancellationCurrent(entry);
    let status = await this.statusForOwnedEntry(entry, batchId);
    if (status.batch.state === 'cancelled') {
      this.scheduler.retireBatch(batchId);
      return null;
    }
    if (this.batchNeedsFileCancellation(status)) return status;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.assertCancellationCurrent(entry);
        await this.commandForOwnedEntry(entry, {
          command: 'knowledge.upload.batch.cancel',
          payload: { batchId, expectedRevision: status.batch.revision },
          expectedRevision: null,
        });
        this.scheduler.retireBatch(batchId);
        return null;
      } catch (error) {
        this.assertCancellationCurrent(entry);
        status = await this.statusForOwnedEntry(entry, batchId);
        if (status.batch.state === 'cancelled') {
          this.scheduler.retireBatch(batchId);
          return null;
        }
        if (this.batchNeedsFileCancellation(status)) return status;
        if (attempt === 1) throw error;
      }
    }
    return null;
  }

  private batchNeedsFileCancellation(status: KnowledgeUploadBatchStatusView): boolean {
    return (
      status.batch.state === 'completed' ||
      status.uploads.some((upload) => upload.state === 'published')
    );
  }

  private finishBatchCancellation(candidates: KnowledgeUploadQueueEntry[]): void {
    for (const candidate of candidates) {
      if (!candidate.cancelRequested || isCancellationSettled(candidate.state)) continue;
      delete candidate.cancelRequested;
      this.updateEntry(candidate, { state: 'cancelled', safeError: null, retryCount: 0 });
    }
  }

  private failBatchCancellation(candidates: KnowledgeUploadQueueEntry[], error: unknown): void {
    for (const candidate of candidates) {
      if (!candidate.cancelRequested || isCancellationSettled(candidate.state)) continue;
      this.updateEntry(candidate, {
        state: 'paused',
        safeError: cancellationSafeError(error),
        retryCount: 0,
      });
    }
  }

  handleSessionChanged(view: PrivilegedSessionView): void {
    const session = view.state === 'active' ? this.activeUploadSession() : null;
    const sessionKey = this.sessionKey(session);
    if (sessionKey === this.activeSessionKey) return;
    this.controlGeneration += 1;
    this.scheduler.setSessionActive(false);
    this.activeSessionKey = sessionKey;
    this.scheduler.setSessionActive(Boolean(session));
    this.emit();
    if (!session) return;
    for (const entry of this.queue.entries) {
      if (
        entry.accountId === session.accountId &&
        this.entryLocalSourceId(entry) === session.localSourceId &&
        (entry.cancelRequested || !isTerminal(entry.state))
      ) {
        if (entry.cancelRequested) this.enqueueCancellation(entry.localId);
        else this.enqueuePreparation(entry.localId, true);
      }
    }
  }

  async whenIdle(): Promise<void> {
    while (true) {
      const preparation = this.preparationTail;
      const cancellation = this.cancellationTail;
      await preparation;
      await cancellation;
      await this.scheduler.whenIdle();
      await this.persistTail;
      if (preparation === this.preparationTail && cancellation === this.cancellationTail) return;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.preparationTail;
    await this.cancellationTail;
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
    if (!entry || entry.cancelRequested || isTerminal(entry.state) || entry.state === 'paused') {
      return;
    }
    try {
      const retryRequested = this.retryRequests.delete(localId);
      this.assertPreparationCurrent(entry);
      if (restore && (await this.reconcileBeforeSourceRestore(entry, retryRequested))) return;
      const plan = await this.ensureSourcePlan(entry, restore);
      if (!plan) return;
      this.assertPreparationCurrent(entry);
      const batchId = await this.ensureBatch(entry);
      this.assertPreparationCurrent(entry);
      const { status, upload } = await this.ensureUpload(entry, batchId, plan);
      this.assertPreparationCurrent(entry);
      this.reconcile(entry, status, upload);
      await this.persistAndEmit();
      this.assertPreparationCurrent(entry);
      if (isTransferable(entry.state)) this.scheduler.enqueue(this.schedulerTask(entry));
    } catch (error) {
      await this.handlePreparationError(entry, error);
    }
  }

  private async handlePreparationError(
    entry: KnowledgeUploadQueueEntry,
    error: unknown,
  ): Promise<void> {
    if (error instanceof PreparationSessionChangedError) {
      return;
    }
    if (entry.cancelRequested) {
      this.updateEntry(entry, { state: 'paused', safeError: entry.safeError, retryCount: 0 });
    } else if (isTerminal(entry.state)) {
      if (entry.uploadId) this.scheduler.retireUpload(entry.uploadId);
      return;
    } else if (entry.state === 'paused' || error instanceof PreparationStoppedError) {
      return;
    } else {
      this.updateEntry(entry, preparationFailure(error));
    }
    await this.persistAndEmit();
  }

  private async reconcileBeforeSourceRestore(
    entry: KnowledgeUploadQueueEntry,
    retryRequested: boolean,
  ): Promise<boolean> {
    if (!entry.batchId) return false;
    const status = await this.statusForOwnedEntry(entry, entry.batchId);
    this.assertPreparationCurrent(entry);
    const upload = this.matchManifest(status, entry);
    if (!upload) return false;
    this.reconcile(entry, status, upload);
    await this.persistAndEmit();
    this.assertPreparationCurrent(entry);
    if (retryRequested && upload.state === 'failed' && upload.missingChunkIndexes.length === 0) {
      await this.finalizeFailedUpload(entry, status, upload);
      return true;
    }
    return isLocalActionableSuspension(entry.state) || !isTransferable(entry.state);
  }

  private async finalizeFailedUpload(
    entry: KnowledgeUploadQueueEntry,
    status: KnowledgeUploadBatchStatusView,
    upload: KnowledgeUploadManifestView,
  ): Promise<void> {
    const result = await this.commandForOwnedEntry(entry, {
      command: 'knowledge.upload.file.finalize',
      payload: { uploadId: upload.id, expectedRevision: upload.revision },
      expectedRevision: null,
    });
    const finalized = normalizeKnowledgeUploadManifestView(result.value);
    if (!finalized || finalized.revision < upload.revision) {
      throw new Error('invalid-finalize-response');
    }
    this.reconcile(entry, status, finalized);
    await this.persistAndEmit();
    this.assertPreparationCurrent(entry);
  }

  private sessionMatchesEntry(
    session: ActiveUploadSession | null,
    entry: KnowledgeUploadQueueEntry,
  ): session is ActiveUploadSession {
    return Boolean(
      session?.accountId === entry.accountId &&
      session.deviceId === entry.deviceId &&
      session.localSourceId === this.entryLocalSourceId(entry),
    );
  }

  private sessionKey(session: ActiveUploadSession | null): string | null {
    return session
      ? `${session.accountId}\u0000${session.deviceId}\u0000${session.localSourceId}`
      : null;
  }

  private matchesCurrentSession(expected: ActiveUploadSession): boolean {
    const current = activeUploadSession(this.getRuntime(), expected.localSourceId);
    const binding = this.localSourceBindings.get(this.localSourceBindingKey(expected));
    return Boolean(
      current?.accountId === expected.accountId &&
      current.deviceId === expected.deviceId &&
      current.localSourceId === expected.localSourceId &&
      (!binding || binding === expected.localSourceId),
    );
  }

  private reselectionCurrent(
    entry: KnowledgeUploadQueueEntry,
    session: ActiveUploadSession,
    generation: number,
  ): boolean {
    return (
      this.controlGeneration === generation &&
      this.findEntry(entry.localId) === entry &&
      !entry.cancelRequested &&
      !isTerminal(entry.state) &&
      this.sessionMatchesEntry(this.activeUploadSession(), entry) &&
      this.matchesCurrentSession(session)
    );
  }

  private activeUploadSession(): ActiveUploadSession | null {
    return this.uploadSessionForRuntime(this.getRuntime());
  }

  private uploadSessionForRuntime(
    runtime: KnowledgeUploadRuntime | null,
  ): ActiveUploadSession | null {
    const session = activeUploadSession(runtime);
    if (!session) return null;
    const binding = this.localSourceBindings.get(this.localSourceBindingKey(session));
    return binding ? { ...session, localSourceId: binding } : session;
  }

  private localSourceBindingKey(
    session: Pick<ActiveUploadSession, 'accountId' | 'deviceId'>,
  ): string {
    return `${session.accountId}\u0000${session.deviceId}`;
  }

  private assertPreparationCurrent(entry: KnowledgeUploadQueueEntry): void {
    if (entry.cancelRequested || isTerminal(entry.state) || entry.state === 'paused') {
      throw new PreparationStoppedError();
    }
    if (!this.sessionMatchesEntry(this.activeUploadSession(), entry)) {
      throw new PreparationSessionChangedError();
    }
  }

  private assertCancellationCurrent(entry: KnowledgeUploadQueueEntry): void {
    if (
      !entry.cancelRequested ||
      isCancellationSettled(entry.state) ||
      !this.sessionMatchesEntry(this.activeUploadSession(), entry)
    ) {
      throw new PreparationSessionChangedError();
    }
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
      if (!restore) return existing;
      const valid = await this.revalidateSource(existing);
      this.assertPreparationCurrent(entry);
      if (valid) return existing;
      this.updateEntry(entry, { state: 'source-required', safeError: 'source-required' });
      await this.persistAndEmit();
      this.assertPreparationCurrent(entry);
      return null;
    }
    const created = await this.planSource(entry.source);
    this.assertPreparationCurrent(entry);
    entry.source = created;
    await this.persistAndEmit();
    this.assertPreparationCurrent(entry);
    return created;
  }

  private async ensureBatch(entry: KnowledgeUploadQueueEntry): Promise<string> {
    this.assertPreparationCurrent(entry);
    const batchId = await this.resolveBatch(entry);
    this.assertPreparationCurrent(entry);
    return batchId;
  }

  private async resolveBatch(entry: KnowledgeUploadQueueEntry): Promise<string> {
    if (entry.batchId) return entry.batchId;
    const resolutionKey = this.batchResolutionKey(entry);
    const existing = this.batchResolutions.get(resolutionKey);
    if (existing) return existing;
    const resolution = this.beginOrRecoverBatch(entry);
    this.batchResolutions.set(resolutionKey, resolution);
    const cleanup = () => {
      if (this.batchResolutions.get(resolutionKey) === resolution) {
        this.batchResolutions.delete(resolutionKey);
      }
    };
    void resolution.then(cleanup, cleanup);
    return resolution;
  }

  private batchResolutionKey(entry: KnowledgeUploadQueueEntry): string {
    return [
      entry.accountId,
      entry.deviceId,
      this.entryLocalSourceId(entry),
      entry.batchRequestId,
    ].join('\u0000');
  }

  private async beginOrRecoverBatch(entry: KnowledgeUploadQueueEntry): Promise<string> {
    const entries = this.queue.entries.filter(
      (candidate) =>
        candidate.batchRequestId === entry.batchRequestId &&
        candidate.accountId === entry.accountId &&
        candidate.deviceId === entry.deviceId &&
        this.entryLocalSourceId(candidate) === this.entryLocalSourceId(entry),
    );
    if (entries.length === 0) throw new Error('invalid-batch-request');
    const totalBytes = entries.reduce((total, candidate) => total + candidate.source.byteSize, 0);
    const result = await this.commandForOwnedEntry(entry, {
      command: 'knowledge.upload.batch.begin',
      payload: {
        requestId: entry.batchRequestId,
        fileCount: entries.length,
        totalBytes,
      },
      expectedRevision: null,
    });
    const batch = normalizeKnowledgeUploadBatchView(result.value);
    if (
      !batch ||
      batch.requestId !== entry.batchRequestId ||
      batch.fileCount !== entries.length ||
      batch.totalBytes !== totalBytes
    ) {
      throw new Error('invalid-batch-response');
    }
    for (const candidate of entries) {
      candidate.batchId = batch.id;
      candidate.batchRevision = batch.revision;
      if (candidate.state === 'planning' && !candidate.cancelRequested) candidate.state = 'queued';
    }
    await this.persistAndEmit();
    return batch.id;
  }

  private async ensureUpload(
    entry: KnowledgeUploadQueueEntry,
    batchId: string,
    plan: KnowledgePdfSourcePlan,
  ): Promise<{ status: KnowledgeUploadBatchStatusView; upload: KnowledgeUploadManifestView }> {
    this.assertPreparationCurrent(entry);
    const status = await this.statusForOwnedEntry(entry, batchId);
    this.assertPreparationCurrent(entry);
    if (entry.batchId !== status.batch.id || entry.batchRevision !== status.batch.revision) {
      entry.batchId = status.batch.id;
      entry.batchRevision = status.batch.revision;
      await this.persistAndEmit();
      this.assertPreparationCurrent(entry);
    }
    const existing = this.matchManifest(status, entry);
    if (existing) return { status, upload: existing };
    this.assertPreparationCurrent(entry);
    const result = await this.commandForOwnedEntry(entry, {
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
    entry.uploadId = upload.id;
    entry.uploadRevision = upload.revision;
    await this.persistAndEmit();
    this.assertPreparationCurrent(entry);
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
      isEligible: () =>
        !entry.cancelRequested &&
        isTransferable(entry.state) &&
        this.sessionMatchesEntry(this.activeUploadSession(), entry),
      getMissingChunkIndexes: async () => {
        this.assertSchedulerCurrent(entry);
        // Preparation has just reconciled the authoritative server status.
        // Reuse that result once instead of immediately issuing a duplicate
        // signed status command; later scheduler runs still re-query PocketBase.
        if (initialMissingChunkIndexes) {
          const missing = initialMissingChunkIndexes;
          initialMissingChunkIndexes = null;
          return missing;
        }
        const status = await this.statusForEntry(entry, batchId);
        this.assertSchedulerCurrent(entry);
        const upload = this.matchManifest(status, entry);
        if (!upload) throw Object.assign(new Error('upload-not-found'), { status: 404 });
        this.reconcile(entry, status, upload);
        await this.persistAndEmit();
        return upload.missingChunkIndexes;
      },
      readChunk: async (index) => {
        this.assertSchedulerCurrent(entry);
        const plan = sourcePlan(entry);
        if (!plan) throw new KnowledgeSourceError('source-required');
        const bytes = await this.readChunk(plan, index);
        this.assertSchedulerCurrent(entry);
        return bytes;
      },
      uploadChunk: async (index, bytes, signal) => {
        const runtime = this.schedulerRuntime(entry);
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
        await runtime.createPrivilegedRecord(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION, form);
        this.assertSchedulerCurrent(entry);
      },
      finalize: async () => {
        const result = await this.commandForEntry(entry, {
          command: 'knowledge.upload.file.finalize',
          payload: { uploadId, expectedRevision: entry.uploadRevision },
          expectedRevision: null,
        });
        this.assertSchedulerCurrent(entry);
        const upload = normalizeKnowledgeUploadManifestView(result.value);
        if (!upload) throw new Error('invalid-finalize-response');
        if (upload.revision >= entry.uploadRevision) {
          entry.uploadRevision = upload.revision;
          if (!entry.cancelRequested) {
            this.updateEntry(entry, { state: upload.state, safeError: upload.safeError });
          }
        }
        if (isAuthoritativeTransferTerminal(upload.state)) {
          this.scheduler.retireUpload(uploadId);
        }
        await this.persistAndEmit();
      },
      onAcknowledged: (index) => {
        if (
          entry.cancelRequested ||
          entry.state === 'paused' ||
          isTerminal(entry.state) ||
          isAuthoritativeProcessingState(entry.state) ||
          !this.sessionMatchesEntry(this.activeUploadSession(), entry)
        ) {
          return;
        }
        if (!entry.acknowledgedChunkIndexes.includes(index)) {
          entry.acknowledgedChunkIndexes.push(index);
          entry.acknowledgedChunkIndexes.sort((left, right) => left - right);
        }
        this.updateEntry(entry, { state: 'uploading', safeError: null });
        void this.persistAndEmit();
      },
      onState: (state, safeError, retryCount) => {
        if (
          entry.cancelRequested ||
          isTerminal(entry.state) ||
          isAuthoritativeProcessingState(entry.state)
        ) {
          return;
        }
        if (
          isLocalActionableSuspension(entry.state) &&
          (state === 'queued' || state === 'uploading')
        ) {
          return;
        }
        if (entry.state === 'paused' && state !== 'paused') return;
        if (!this.sessionMatchesEntry(this.activeUploadSession(), entry)) {
          return;
        }
        this.updateEntry(entry, { state, safeError, retryCount });
        void this.persistAndEmit();
      },
    };
  }

  private async statusForSession(
    session: ActiveUploadSession,
    batchId: string,
  ): Promise<KnowledgeUploadBatchStatusView> {
    const result = await this.commandForSession(session, {
      command: 'knowledge.upload.status',
      payload: { batchId },
      expectedRevision: null,
    });
    const status = normalizeKnowledgeUploadBatchStatusView(result.value);
    if (!status) throw new Error('invalid-status-response');
    return status;
  }

  private async statusForEntry(
    entry: KnowledgeUploadQueueEntry,
    batchId: string,
  ): Promise<KnowledgeUploadBatchStatusView> {
    const result = await this.commandForEntry(entry, {
      command: 'knowledge.upload.status',
      payload: { batchId },
      expectedRevision: null,
    });
    const status = normalizeKnowledgeUploadBatchStatusView(result.value);
    if (!status) throw new Error('invalid-status-response');
    return status;
  }

  private async statusForOwnedEntry(
    entry: KnowledgeUploadQueueEntry,
    batchId: string,
  ): Promise<KnowledgeUploadBatchStatusView> {
    const result = await this.commandForOwnedEntry(entry, {
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
    const preserveLocalSuspension =
      isLocalActionableSuspension(entry.state) &&
      (upload.state === 'queued' || upload.state === 'uploading');
    if (entry.uploadId === upload.id && upload.revision < entry.uploadRevision) {
      return;
    }
    const sameUploadRevision =
      entry.uploadId === upload.id && entry.uploadRevision === upload.revision;
    const priorAcknowledged = sameUploadRevision ? entry.acknowledgedChunkIndexes : [];
    entry.batchId = status.batch.id;
    entry.batchRevision = Math.max(entry.batchRevision, status.batch.revision);
    entry.uploadId = upload.id;
    entry.uploadRevision = upload.revision;
    const authoritativeAcknowledged = Array.from(
      { length: upload.chunkCount },
      (_, index) => index,
    ).filter((index) => !upload.missingChunkIndexes.includes(index));
    entry.acknowledgedChunkIndexes = Array.from(
      new Set([...priorAcknowledged, ...authoritativeAcknowledged]),
    ).toSorted((left, right) => left - right);
    if (entry.cancelRequested) {
      if (upload.state === 'cancelled' || upload.state === 'published') {
        delete entry.cancelRequested;
        this.updateEntry(entry, {
          state: upload.state,
          safeError: upload.safeError,
          retryCount: 0,
        });
        this.scheduler.retireUpload(upload.id);
      }
      return;
    }
    if (isAuthoritativeTransferTerminal(upload.state)) {
      this.scheduler.retireUpload(upload.id);
    }
    if (preserveLocalSuspension) return;
    this.updateEntry(entry, { state: upload.state, safeError: upload.safeError });
  }

  private async commandForSession(
    session: ActiveUploadSession,
    request: PublicPrivilegedCommandRequest,
  ): Promise<Extract<PrivilegedCommandResult, { ok: true }>> {
    if (!this.matchesCurrentSession(session)) {
      throw new PreparationSessionChangedError();
    }
    const runtime = this.getRuntime();
    if (!runtime) throw new PreparationSessionChangedError();
    const result = await runtime.submitPublicCommand(request);
    if (!this.matchesCurrentSession(session)) {
      throw new PreparationSessionChangedError();
    }
    if (!result.ok) resultError(result.error);
    return result;
  }

  private async commandForEntry(
    entry: KnowledgeUploadQueueEntry,
    request: PublicPrivilegedCommandRequest,
  ): Promise<Extract<PrivilegedCommandResult, { ok: true }>> {
    const runtime = this.schedulerRuntime(entry);
    const result = await runtime.submitPublicCommand(request);
    if (!result.ok) resultError(result.error);
    return result;
  }

  private async commandForOwnedEntry(
    entry: KnowledgeUploadQueueEntry,
    request: PublicPrivilegedCommandRequest,
  ): Promise<Extract<PrivilegedCommandResult, { ok: true }>> {
    const runtime = this.runtimeForOwnedEntry(entry);
    const result = await runtime.submitPublicCommand(request);
    this.runtimeForOwnedEntry(entry);
    if (!result.ok) resultError(result.error);
    return result;
  }

  private schedulerRuntime(entry: KnowledgeUploadQueueEntry): KnowledgeUploadRuntime {
    if (entry.cancelRequested || !isTransferable(entry.state)) {
      throw new PreparationStoppedError();
    }
    return this.runtimeForOwnedEntry(entry);
  }

  private runtimeForOwnedEntry(entry: KnowledgeUploadQueueEntry): KnowledgeUploadRuntime {
    const runtime = this.getRuntime();
    const session = this.uploadSessionForRuntime(runtime);
    if (!runtime || !this.sessionMatchesEntry(session, entry)) {
      throw new PreparationSessionChangedError();
    }
    return runtime;
  }

  private assertSchedulerCurrent(entry: KnowledgeUploadQueueEntry): void {
    this.schedulerRuntime(entry);
  }

  private findEntry(id: string): KnowledgeUploadQueueEntry | undefined {
    return this.queue.entries.find((entry) => entry.localId === id || entry.uploadId === id);
  }

  private findControllableEntry(id: string): KnowledgeUploadQueueEntry | undefined {
    const session = this.activeUploadSession();
    return this.queue.entries.find(
      (entry) =>
        (entry.localId === id || entry.uploadId === id) && this.sessionMatchesEntry(session, entry),
    );
  }

  private controllableBatchEntries(id: string): KnowledgeUploadQueueEntry[] {
    const session = this.activeUploadSession();
    return this.queue.entries.filter(
      (entry) =>
        (entry.batchId === id || entry.batchRequestId === id) &&
        this.sessionMatchesEntry(session, entry),
    );
  }

  private visibleEntries(): KnowledgeUploadQueueEntry[] {
    const session = this.activeUploadSession();
    if (!session) return [];
    return this.queue.entries.filter((entry) => this.sessionMatchesEntry(session, entry));
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
      cancelPending: entry.cancelRequested === true,
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
