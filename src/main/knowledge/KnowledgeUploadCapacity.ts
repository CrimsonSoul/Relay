import { mkdir, statfs } from 'node:fs/promises';
import { KNOWLEDGE_MAX_PDF_BYTES, KNOWLEDGE_UPLOAD_MAX_FILES } from '@shared/knowledge';

const MINIMUM_FREE_BYTES = 2 * 1024 * 1024 * 1024;

export type KnowledgeUploadCapacityProbe = {
  availableBytes(path: string): Promise<number>;
};

export type KnowledgeUploadAdmissionErrorCode =
  'invalid-request' | 'conflict' | 'insufficient-storage';

function admissionMessage(code: KnowledgeUploadAdmissionErrorCode): string {
  if (code === 'insufficient-storage') {
    return 'The Relay server does not have enough verified storage for this upload batch.';
  }
  if (code === 'conflict') {
    return 'Finish or cancel the active upload batch before starting another.';
  }
  return 'The upload batch declaration is invalid.';
}

export class KnowledgeUploadAdmissionError extends Error {
  constructor(readonly code: KnowledgeUploadAdmissionErrorCode) {
    super(admissionMessage(code));
    this.name = 'KnowledgeUploadAdmissionError';
  }
}

type KnowledgeUploadCapacityOptions = {
  storagePath: string;
  probe?: KnowledgeUploadCapacityProbe;
  hasActiveBatch?(accountId: string): Promise<boolean>;
};

const defaultProbe: KnowledgeUploadCapacityProbe = {
  async availableBytes(path) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const stats = await statfs(path);
    return Number(stats.bavail) * Number(stats.bsize);
  },
};

export class KnowledgeUploadCapacity {
  private readonly storagePath: string;
  private readonly probe: KnowledgeUploadCapacityProbe;
  private readonly hasActiveBatch: (accountId: string) => Promise<boolean>;

  constructor(options: KnowledgeUploadCapacityOptions) {
    this.storagePath = options.storagePath;
    this.probe = options.probe ?? defaultProbe;
    this.hasActiveBatch = options.hasActiveBatch ?? (async () => false);
  }

  async assertBatch(input: {
    accountId: string;
    fileCount: number;
    totalBytes: number;
  }): Promise<void> {
    const maximumBatchBytes = KNOWLEDGE_UPLOAD_MAX_FILES * KNOWLEDGE_MAX_PDF_BYTES;
    if (
      !input.accountId ||
      !Number.isInteger(input.fileCount) ||
      input.fileCount < 1 ||
      input.fileCount > KNOWLEDGE_UPLOAD_MAX_FILES ||
      !Number.isInteger(input.totalBytes) ||
      input.totalBytes < 1 ||
      input.totalBytes > maximumBatchBytes
    ) {
      throw new KnowledgeUploadAdmissionError('invalid-request');
    }
    if (await this.hasActiveBatch(input.accountId)) {
      throw new KnowledgeUploadAdmissionError('conflict');
    }
    let availableBytes: number;
    try {
      availableBytes = await this.probe.availableBytes(this.storagePath);
    } catch {
      throw new KnowledgeUploadAdmissionError('insufficient-storage');
    }
    if (
      !Number.isFinite(availableBytes) ||
      availableBytes - input.totalBytes - KNOWLEDGE_MAX_PDF_BYTES < MINIMUM_FREE_BYTES
    ) {
      throw new KnowledgeUploadAdmissionError('insufficient-storage');
    }
  }
}
