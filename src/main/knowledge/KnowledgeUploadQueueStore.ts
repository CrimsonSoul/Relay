import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_UPLOAD_MAX_FILES,
  type KnowledgeManagementErrorCode,
  type KnowledgeUploadQueueItemState,
} from '@shared/knowledge';
import type { KnowledgePdfSourcePlan } from './knowledgeChunking';

export type KnowledgeUploadQueueSource = Omit<KnowledgePdfSourcePlan, 'checksum'> & {
  checksum: string | null;
};

export type KnowledgeUploadQueueEntry = {
  localId: string;
  batchRequestId: string;
  batchId: string | null;
  batchRevision: number;
  uploadId: string | null;
  uploadRevision: number;
  accountId: string;
  deviceId: string;
  localSourceId?: string;
  source: KnowledgeUploadQueueSource;
  acknowledgedChunkIndexes: number[];
  state: KnowledgeUploadQueueItemState;
  safeError: KnowledgeManagementErrorCode | null;
  retryCount: number;
};

export type KnowledgeUploadQueueState = {
  version: 1;
  restartRecovery: boolean;
  entries: KnowledgeUploadQueueEntry[];
};

export type KnowledgeQueueSafeStorage = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

type KnowledgeUploadQueueStoreOptions = {
  dataDir: string;
  safeStorage: KnowledgeQueueSafeStorage;
  fileName?: string;
};

type PersistedSource = Omit<KnowledgeUploadQueueSource, 'canonicalPath'> & {
  encryptedSourcePath: string;
};

type PersistedEntry = Omit<KnowledgeUploadQueueEntry, 'source'> & { source: PersistedSource };
type PersistedQueue = Omit<KnowledgeUploadQueueState, 'entries'> & { entries: PersistedEntry[] };

const QUEUE_STATES: KnowledgeUploadQueueItemState[] = [
  'planning',
  'paused',
  'queued',
  'uploading',
  'assembling',
  'validating',
  'extracting',
  'ready',
  'failed',
  'cancelled',
  'published',
  'paused-network',
  'source-required',
];

const SAFE_ERRORS: Array<KnowledgeManagementErrorCode | null> = [
  null,
  'offline',
  'unauthorized',
  'invalid-file',
  'upload-failed',
  'validation-failed',
  'encrypted-pdf',
  'too-large',
  'too-many-pages',
  'extraction-timeout',
  'duplicate-file-name',
  'checksum-mismatch',
  'insufficient-storage',
  'source-required',
  'conflict',
  'not-found',
  'server-error',
];

export function createEmptyKnowledgeUploadQueue(
  restartRecovery: boolean,
): KnowledgeUploadQueueState {
  return { version: 1, restartRecovery, entries: [] };
}

function cloneQueue(queue: KnowledgeUploadQueueState): KnowledgeUploadQueueState {
  return {
    version: 1,
    restartRecovery: queue.restartRecovery,
    entries: queue.entries.map((entry) => ({
      ...entry,
      source: { ...entry.source },
      acknowledgedChunkIndexes: [...entry.acknowledgedChunkIndexes],
    })),
  };
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function numberInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function normalizePersistedEntry(
  value: unknown,
  safeStorage: KnowledgeQueueSafeStorage,
): KnowledgeUploadQueueEntry | null {
  if (!isRecord(value) || !isRecord(value.source)) return null;
  const source = value.source;
  let canonicalPath: string;
  try {
    canonicalPath = safeStorage.decryptString(
      Buffer.from(String(source.encryptedSourcePath), 'base64'),
    );
  } catch {
    return null;
  }
  const checksum = source.checksum;
  const acknowledged = value.acknowledgedChunkIndexes;
  if (
    !boundedString(value.localId, 200) ||
    !boundedString(value.batchRequestId, 200) ||
    (value.batchId !== null && !boundedString(value.batchId, 200)) ||
    !numberInRange(value.batchRevision, 0, Number.MAX_SAFE_INTEGER) ||
    (value.uploadId !== null && !boundedString(value.uploadId, 200)) ||
    !numberInRange(value.uploadRevision, 0, Number.MAX_SAFE_INTEGER) ||
    !boundedString(value.accountId, 200) ||
    !boundedString(value.deviceId, 200) ||
    (value.localSourceId !== undefined && !boundedString(value.localSourceId, 200)) ||
    !boundedString(canonicalPath, 4_096) ||
    !boundedString(source.fileName, 240) ||
    !numberInRange(source.byteSize, 1, KNOWLEDGE_MAX_PDF_BYTES) ||
    typeof source.modifiedMs !== 'number' ||
    !Number.isFinite(source.modifiedMs) ||
    !numberInRange(source.device, 0, Number.MAX_SAFE_INTEGER) ||
    !numberInRange(source.inode, 0, Number.MAX_SAFE_INTEGER) ||
    (checksum !== null && (typeof checksum !== 'string' || !/^[0-9a-f]{64}$/.test(checksum))) ||
    !numberInRange(source.chunkCount, 1, 13) ||
    !Array.isArray(acknowledged) ||
    acknowledged.some((index) => !numberInRange(index, 0, (source.chunkCount as number) - 1)) ||
    new Set(acknowledged).size !== acknowledged.length ||
    !QUEUE_STATES.includes(value.state as KnowledgeUploadQueueItemState) ||
    !SAFE_ERRORS.includes(value.safeError as KnowledgeManagementErrorCode | null) ||
    !numberInRange(value.retryCount, 0, Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  return {
    localId: value.localId,
    batchRequestId: value.batchRequestId,
    batchId: value.batchId as string | null,
    batchRevision: value.batchRevision as number,
    uploadId: value.uploadId as string | null,
    uploadRevision: value.uploadRevision as number,
    accountId: value.accountId,
    deviceId: value.deviceId,
    ...(typeof value.localSourceId === 'string' ? { localSourceId: value.localSourceId } : {}),
    source: {
      canonicalPath,
      fileName: source.fileName,
      byteSize: source.byteSize as number,
      modifiedMs: source.modifiedMs,
      device: source.device as number,
      inode: source.inode as number,
      checksum: checksum as string | null,
      chunkCount: source.chunkCount as number,
    },
    acknowledgedChunkIndexes: (acknowledged as number[]).toSorted((left, right) => left - right),
    state: value.state as KnowledgeUploadQueueItemState,
    safeError: value.safeError as KnowledgeManagementErrorCode | null,
    retryCount: value.retryCount as number,
  };
}

export class KnowledgeUploadQueueStore {
  readonly path: string;
  private readonly safeStorage: KnowledgeQueueSafeStorage;
  private memory = createEmptyKnowledgeUploadQueue(false);

  constructor(options: KnowledgeUploadQueueStoreOptions) {
    this.safeStorage = options.safeStorage;
    this.path = join(options.dataDir, options.fileName ?? 'knowledge-upload-queue.json');
  }

  async load(): Promise<KnowledgeUploadQueueState> {
    if (!this.safeStorage.isEncryptionAvailable()) return cloneQueue(this.memory);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
    } catch (error) {
      if (isMissingFile(error)) return createEmptyKnowledgeUploadQueue(true);
      return createEmptyKnowledgeUploadQueue(true);
    }
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return createEmptyKnowledgeUploadQueue(true);
    }
    const entries = parsed.entries.map((entry) => normalizePersistedEntry(entry, this.safeStorage));
    if (entries.length > KNOWLEDGE_UPLOAD_MAX_FILES || entries.some((entry) => entry === null)) {
      return createEmptyKnowledgeUploadQueue(true);
    }
    return { version: 1, restartRecovery: true, entries: entries as KnowledgeUploadQueueEntry[] };
  }

  async save(queue: KnowledgeUploadQueueState): Promise<void> {
    if (!this.safeStorage.isEncryptionAvailable()) {
      this.memory = { ...cloneQueue(queue), restartRecovery: false };
      return;
    }
    const persisted: PersistedQueue = {
      version: 1,
      restartRecovery: true,
      entries: queue.entries.map((entry) => {
        const { canonicalPath, ...source } = entry.source;
        return {
          ...entry,
          acknowledgedChunkIndexes: [...entry.acknowledgedChunkIndexes],
          source: {
            ...source,
            encryptedSourcePath: this.safeStorage.encryptString(canonicalPath).toString('base64'),
          },
        };
      }),
    };
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(persisted), { encoding: 'utf8', mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
    this.memory = { ...cloneQueue(queue), restartRecovery: true };
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
