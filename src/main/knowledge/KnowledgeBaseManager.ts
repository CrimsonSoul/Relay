import { createHash } from 'node:crypto';
import { watch as watchFiles, type FSWatcher } from 'node:fs';
import { basename, extname } from 'node:path';
import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  type KnowledgeDocumentRecord,
  type KnowledgeIndexStatus,
} from '@shared/knowledge';
import { KnowledgeExtractorWorker } from './KnowledgeExtractorWorker';
import type { KnowledgeExtractionResult } from './knowledgeExtractor';
import {
  ensureKnowledgeRoot,
  readKnowledgeSourceFile,
  scanKnowledgeRoot,
  type KnowledgeSourceCandidate,
  type KnowledgeSourceScan,
} from './knowledgePathSafety';

const WATCH_DEBOUNCE_MS = 1_000;
const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1_000;
const BULK_DELETION_THRESHOLD = 0.25;

type Extractor = {
  extract(data: Uint8Array): Promise<KnowledgeExtractionResult>;
  stop(): Promise<void>;
};

type WatchHandle = { close(): void };

type KnowledgeBaseManagerOptions = {
  root: string;
  getPbClient: () => PocketBase | null;
  extractor?: Extractor;
  ensureRoot?: (root: string) => Promise<void>;
  scan?: (root: string) => Promise<KnowledgeSourceScan>;
  readFile?: (path: string) => Promise<Buffer>;
  checksum?: (data: Uint8Array) => string;
  watch?: (root: string, onChange: () => void, onError: (error: Error) => void) => WatchHandle;
  broadcastStatus?: (status: KnowledgeIndexStatus) => void;
  now?: () => number;
};

type PendingBulkDeletion = { key: string; firstSeenAt: number };

function defaultWatch(
  root: string,
  onChange: () => void,
  onError: (error: Error) => void,
): FSWatcher {
  const watcher = watchFiles(root, { recursive: true }, onChange);
  watcher.on('error', onError);
  return watcher;
}

function defaultChecksum(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function documentTitle(
  source: KnowledgeSourceCandidate,
  extraction: KnowledgeExtractionResult,
): string {
  return extraction.metadataTitle ?? basename(source.fileName, extname(source.fileName));
}

function addFormValue(form: FormData, name: string, value: string | number | object): void {
  form.set(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
}

function createDocumentForm(
  source: KnowledgeSourceCandidate,
  data: Uint8Array,
  checksum: string,
  extraction: KnowledgeExtractionResult,
  indexedAt: string,
): FormData {
  const form = new FormData();
  addFormValue(form, 'sourceKey', source.sourceKey);
  addFormValue(form, 'category', source.category);
  addFormValue(form, 'title', documentTitle(source, extraction));
  addFormValue(form, 'fileName', source.fileName);
  addFormValue(form, 'checksum', checksum);
  addFormValue(form, 'byteSize', source.byteSize);
  addFormValue(form, 'pageCount', extraction.pageCount);
  addFormValue(form, 'outline', extraction.outline);
  addFormValue(form, 'outlineSource', extraction.outlineSource);
  addFormValue(form, 'sourceModifiedAt', source.sourceModifiedAt);
  addFormValue(form, 'indexedAt', indexedAt);
  addFormValue(form, 'lifecycleState', 'active');
  addFormValue(form, 'displayTitle', documentTitle(source, extraction));
  addFormValue(form, 'revision', 1);
  addFormValue(form, 'publishedByOperatorId', '');
  addFormValue(form, 'publishedByName', '');
  addFormValue(form, 'publishedAt', indexedAt);
  const bytes = Uint8Array.from(data);
  form.set(
    'pdf',
    new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
    source.fileName,
  );
  return form;
}

export class KnowledgeBaseManager {
  private readonly root: string;
  private readonly getPbClient: () => PocketBase | null;
  private readonly extractor: Extractor;
  private readonly ensureRoot: (root: string) => Promise<void>;
  private readonly scan: (root: string) => Promise<KnowledgeSourceScan>;
  private readonly readSource: (source: KnowledgeSourceCandidate) => Promise<Buffer>;
  private readonly checksum: (data: Uint8Array) => string;
  private readonly watch: NonNullable<KnowledgeBaseManagerOptions['watch']>;
  private readonly broadcastStatus: (status: KnowledgeIndexStatus) => void;
  private readonly now: () => number;
  private watcher: WatchHandle | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private reconciliation: Promise<void> | null = null;
  private pendingBulkDeletion: PendingBulkDeletion | null = null;
  private started = false;
  private stopped = false;
  private status: KnowledgeIndexStatus = {
    state: 'idle',
    documentCount: 0,
    categoryCount: 0,
    lastIndexedAt: null,
  };

  constructor(options: KnowledgeBaseManagerOptions) {
    this.root = options.root;
    this.getPbClient = options.getPbClient;
    this.extractor = options.extractor ?? new KnowledgeExtractorWorker();
    this.ensureRoot = options.ensureRoot ?? ensureKnowledgeRoot;
    this.scan = options.scan ?? scanKnowledgeRoot;
    this.readSource = options.readFile
      ? (source) => options.readFile!(source.canonicalPath)
      : (source) => readKnowledgeSourceFile(this.root, source);
    this.checksum = options.checksum ?? defaultChecksum;
    this.watch = options.watch ?? defaultWatch;
    this.broadcastStatus = options.broadcastStatus ?? (() => undefined);
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    await this.reconcile();
    if (this.stopped) return;
    this.startWatcher();
    this.reconciliationTimer = setInterval(() => void this.reconcile(), RECONCILIATION_INTERVAL_MS);
    this.reconciliationTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.started = false;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.debounceTimer = null;
    this.reconciliationTimer = null;
    this.watcher?.close();
    this.watcher = null;
    await this.extractor.stop();
    await this.reconciliation?.catch(() => undefined);
  }

  getStatus(): KnowledgeIndexStatus {
    return { ...this.status };
  }

  async reconcile(): Promise<void> {
    if (this.reconciliation) return this.reconciliation;
    this.reconciliation = this.performReconciliation()
      .catch(() => {
        this.updateStatus({ state: 'error', message: 'Knowledge index refresh failed' });
      })
      .finally(() => {
        this.reconciliation = null;
      });
    return this.reconciliation;
  }

  private startWatcher(): void {
    try {
      this.watcher = this.watch(
        this.root,
        () => this.scheduleReconciliation(),
        () => this.updateStatus({ state: 'warning', message: 'Folder watcher unavailable' }),
      );
    } catch {
      this.updateStatus({ state: 'warning', message: 'Folder watcher unavailable' });
    }
  }

  private scheduleReconciliation(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.reconcile();
    }, WATCH_DEBOUNCE_MS);
  }

  private updateStatus(change: Partial<KnowledgeIndexStatus>): void {
    this.status = { ...this.status, ...change };
    this.broadcastStatus(this.getStatus());
  }

  private async performReconciliation(): Promise<void> {
    const pb = this.getPbClient();
    if (!pb) {
      this.updateStatus({ state: 'error', message: 'Knowledge storage is unavailable' });
      return;
    }

    this.updateStatus({ state: 'indexing', message: undefined });
    const records = await pb
      .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
      .getFullList<KnowledgeDocumentRecord>({ requestKey: null });
    const recordsBySource = new Map(records.map((record) => [record.sourceKey, record]));
    let scan = await this.scan(this.root);

    if (!scan.healthy && recordsBySource.size === 0) {
      await this.ensureRoot(this.root);
      scan = await this.scan(this.root);
    }

    if (!scan.healthy) {
      this.updateCounts(recordsBySource, 'warning', 'Knowledge source is unavailable');
      return;
    }

    let failures = scan.issues.length;
    for (const source of scan.candidates) {
      try {
        const indexed = await this.indexSource(pb, source, recordsBySource.get(source.sourceKey));
        recordsBySource.set(source.sourceKey, indexed);
      } catch {
        failures += 1;
      }
    }

    const sourceKeys = new Set(scan.candidates.map((source) => source.sourceKey));
    const missing = [...recordsBySource.values()].filter(
      (record) => !sourceKeys.has(record.sourceKey),
    );
    let deletionWarning = false;
    if (scan.issues.length > 0) {
      this.pendingBulkDeletion = null;
      deletionWarning = missing.length > 0;
    } else {
      deletionWarning = await this.applySafeDeletions(pb, missing, recordsBySource);
    }
    const hasWarning = failures > 0 || deletionWarning;
    this.updateCounts(
      recordsBySource,
      hasWarning ? 'warning' : 'idle',
      hasWarning ? 'Knowledge index completed with warnings' : undefined,
    );
  }

  private async indexSource(
    pb: PocketBase,
    source: KnowledgeSourceCandidate,
    existing: KnowledgeDocumentRecord | undefined,
  ): Promise<KnowledgeDocumentRecord> {
    if (
      existing &&
      existing.byteSize === source.byteSize &&
      existing.sourceModifiedAt === source.sourceModifiedAt
    ) {
      return existing;
    }

    const data = await this.readSource(source);
    const checksum = this.checksum(data);
    if (existing?.checksum === checksum) {
      await pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).update(existing.id, {
        byteSize: source.byteSize,
        sourceModifiedAt: source.sourceModifiedAt,
      });
      return { ...existing, byteSize: source.byteSize, sourceModifiedAt: source.sourceModifiedAt };
    }

    const extraction = await this.extractor.extract(data);
    const indexedAt = new Date(this.now()).toISOString();
    const form = createDocumentForm(source, data, checksum, extraction, indexedAt);
    const service = pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION);
    const saved = existing ? await service.update(existing.id, form) : await service.create(form);
    return {
      id: saved.id,
      sourceKey: source.sourceKey,
      category: source.category,
      title: documentTitle(source, extraction),
      fileName: source.fileName,
      pdf: source.fileName,
      checksum,
      byteSize: source.byteSize,
      pageCount: extraction.pageCount,
      outline: extraction.outline,
      outlineSource: extraction.outlineSource,
      sourceModifiedAt: source.sourceModifiedAt,
      indexedAt,
      created: existing?.created ?? indexedAt,
      updated: indexedAt,
      lifecycleState: 'active',
      displayTitle: documentTitle(source, extraction),
      revision: 1,
      publishedByOperatorId: '',
      publishedByName: '',
      publishedAt: indexedAt,
      trashedByOperatorId: null,
      trashedByName: null,
      trashedAt: null,
    };
  }

  private async applySafeDeletions(
    pb: PocketBase,
    missing: KnowledgeDocumentRecord[],
    recordsBySource: Map<string, KnowledgeDocumentRecord>,
  ): Promise<boolean> {
    if (missing.length === 0) {
      this.pendingBulkDeletion = null;
      return false;
    }

    const ratio = missing.length / recordsBySource.size;
    if (ratio > BULK_DELETION_THRESHOLD && !this.bulkDeletionConfirmed(missing)) return true;

    for (const record of missing) {
      await pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).delete(record.id);
      recordsBySource.delete(record.sourceKey);
    }
    this.pendingBulkDeletion = null;
    return false;
  }

  private bulkDeletionConfirmed(missing: KnowledgeDocumentRecord[]): boolean {
    const key = missing
      .map((record) => record.sourceKey)
      .toSorted((left, right) => left.localeCompare(right))
      .join('\n');
    const current = this.pendingBulkDeletion;
    if (!current || current.key !== key) {
      this.pendingBulkDeletion = { key, firstSeenAt: this.now() };
      return false;
    }
    return this.now() - current.firstSeenAt >= RECONCILIATION_INTERVAL_MS;
  }

  private updateCounts(
    records: Map<string, KnowledgeDocumentRecord>,
    state: KnowledgeIndexStatus['state'],
    message?: string,
  ): void {
    this.updateStatus({
      state,
      documentCount: records.size,
      categoryCount: new Set([...records.values()].map((record) => record.category)).size,
      lastIndexedAt: new Date(this.now()).toISOString(),
      message,
    });
  }
}
