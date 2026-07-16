import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import {
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_UPLOADS_COLLECTION,
  type KnowledgeUploadProgress,
  type KnowledgeUploadSelectionResult,
  type KnowledgeUploadView,
} from '@shared/knowledge';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';

type KnowledgeUploadRuntime = {
  getView(): PrivilegedSessionView;
  createPrivilegedRecord(
    collection: string,
    data: Record<string, unknown> | FormData,
  ): Promise<Record<string, unknown> & { id: string }>;
  submitPublicCommand(input: {
    command: 'knowledge.upload.validate';
    payload: { uploadId: string; preliminaryChecksum: string };
    expectedRevision: null;
  }): Promise<PrivilegedCommandResult>;
};

type KnowledgeUploadServiceOptions = {
  getRuntime: () => KnowledgeUploadRuntime | null;
  selectFiles?: (window?: BrowserWindow) => Promise<string[]>;
  read?: (path: string) => Promise<Buffer>;
  inspect?: (
    path: string,
  ) => Promise<{ symbolicLink: boolean; size: number; canonicalPath: string }>;
  emitProgress?: (progress: KnowledgeUploadProgress) => void;
  now?: () => number;
  createId?: () => string;
};

async function defaultSelectFiles(window?: BrowserWindow): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}

async function defaultInspect(path: string) {
  const status = await lstat(path);
  return {
    symbolicLink: status.isSymbolicLink(),
    size: status.size,
    canonicalPath: await realpath(path),
  };
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function failedUpload(
  requestId: string,
  fileName: string,
  byteSize: number,
  error: KnowledgeUploadView['safeError'],
  expiresAt: string,
): KnowledgeUploadView {
  return {
    id: requestId,
    requestId,
    fileName,
    byteSize,
    checksum: '0'.repeat(64),
    state: 'failed',
    progress: 0,
    proposedTitle: fileName.replace(/\.pdf$/i, ''),
    proposedCategory: 'General',
    pageCount: null,
    outline: [],
    outlineSource: null,
    duplicateDocumentId: null,
    safeError: error,
    expiresAt,
    revision: 0,
  };
}

function safeUploadView(
  value: unknown,
  fallback: Omit<KnowledgeUploadView, 'state' | 'progress' | 'safeError'>,
): KnowledgeUploadView {
  if (value && typeof value === 'object') {
    const record = value as Partial<KnowledgeUploadView>;
    if (record.id === fallback.id && record.requestId === fallback.requestId) {
      return {
        ...fallback,
        ...record,
        state: record.state ?? 'ready',
        progress: record.progress ?? 100,
        safeError: record.safeError ?? null,
      };
    }
  }
  return { ...fallback, state: 'ready', progress: 100, safeError: null };
}

export class KnowledgeUploadService {
  private readonly getRuntime: () => KnowledgeUploadRuntime | null;
  private readonly selectFiles: NonNullable<KnowledgeUploadServiceOptions['selectFiles']>;
  private readonly read: NonNullable<KnowledgeUploadServiceOptions['read']>;
  private readonly inspect: NonNullable<KnowledgeUploadServiceOptions['inspect']>;
  private readonly emitProgress: NonNullable<KnowledgeUploadServiceOptions['emitProgress']>;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(options: KnowledgeUploadServiceOptions) {
    this.getRuntime = options.getRuntime;
    this.selectFiles = options.selectFiles ?? defaultSelectFiles;
    this.read = options.read ?? readFile;
    this.inspect = options.inspect ?? defaultInspect;
    this.emitProgress = options.emitProgress ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  async selectAndStage(window?: BrowserWindow): Promise<KnowledgeUploadSelectionResult> {
    const runtime = this.getRuntime();
    const session = runtime?.getView();
    if (
      !runtime ||
      session?.state !== 'active' ||
      !session.accountId ||
      !session.operatorId ||
      !session.operatorName ||
      !session.capabilities.includes('knowledge.manage')
    ) {
      return { ok: false, error: runtime ? 'unauthorized' : 'offline' };
    }
    const paths = await this.selectFiles(window);
    if (paths.length === 0) return { ok: false, error: 'cancelled' };

    const uploads: KnowledgeUploadView[] = [];
    for (const path of paths) {
      uploads.push(await this.stageOne(runtime, session, path));
    }
    return { ok: true, uploads };
  }

  private async stageOne(
    runtime: KnowledgeUploadRuntime,
    session: PrivilegedSessionView & {
      accountId: string;
      operatorId: string;
      operatorName: string;
    },
    path: string,
  ): Promise<KnowledgeUploadView> {
    const requestId = this.createId();
    const fileName = basename(path);
    const expiresAt = new Date(this.now() + 24 * 60 * 60 * 1_000).toISOString();
    let byteSize = 0;
    try {
      const info = await this.inspect(path);
      byteSize = info.size;
      if (
        info.symbolicLink ||
        extname(fileName).toLocaleLowerCase('en') !== '.pdf' ||
        byteSize <= 0 ||
        byteSize > KNOWLEDGE_MAX_PDF_BYTES
      ) {
        return this.fail(requestId, fileName, byteSize, 'invalid-file', expiresAt);
      }
      const data = await this.read(info.canonicalPath);
      if (data.byteLength !== byteSize || data.subarray(0, 5).toString('ascii') !== '%PDF-') {
        return this.fail(requestId, fileName, byteSize, 'invalid-file', expiresAt);
      }
      const checksum = sha256(data);
      this.progress(requestId, fileName, byteSize, 'uploading', 20, null);
      const descriptor = {
        requestId,
        fileName,
        byteSize,
        checksum,
        accountId: session.accountId,
        deviceId: session.deviceId ?? 'server-local',
        operatorId: session.operatorId,
      };
      const form = new FormData();
      for (const [key, value] of Object.entries(descriptor)) form.set(key, String(value));
      form.set('operatorName', session.operatorName);
      form.set('descriptorHash', sha256(JSON.stringify(descriptor)));
      form.set('state', 'validating');
      form.set('expiresAt', expiresAt);
      form.set('revision', '0');
      const bytes = Uint8Array.from(data);
      form.set(
        'pdf',
        new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
        fileName,
      );
      const staged = await runtime.createPrivilegedRecord(KNOWLEDGE_UPLOADS_COLLECTION, form);
      this.progress(requestId, fileName, byteSize, 'validating', 60, null);
      const result = await runtime.submitPublicCommand({
        command: 'knowledge.upload.validate',
        payload: { uploadId: staged.id, preliminaryChecksum: checksum },
        expectedRevision: null,
      });
      if (!result.ok)
        return this.fail(requestId, fileName, byteSize, 'validation-failed', expiresAt);
      const fallback = {
        id: staged.id,
        requestId,
        fileName,
        byteSize,
        checksum,
        proposedTitle: fileName.replace(/\.pdf$/i, ''),
        proposedCategory: 'General',
        pageCount: null,
        outline: [],
        outlineSource: null,
        duplicateDocumentId: null,
        expiresAt,
        revision: 1,
      } satisfies Omit<KnowledgeUploadView, 'state' | 'progress' | 'safeError'>;
      const upload = safeUploadView(result.value, fallback);
      this.progress(requestId, fileName, byteSize, upload.state, upload.progress, upload.safeError);
      return upload;
    } catch {
      return this.fail(requestId, fileName, byteSize, 'upload-failed', expiresAt);
    }
  }

  private fail(
    requestId: string,
    fileName: string,
    byteSize: number,
    error: KnowledgeUploadView['safeError'],
    expiresAt: string,
  ): KnowledgeUploadView {
    this.progress(requestId, fileName, byteSize, 'failed', 0, error);
    return failedUpload(requestId, fileName, byteSize, error, expiresAt);
  }

  private progress(
    requestId: string,
    fileName: string,
    byteSize: number,
    state: KnowledgeUploadProgress['state'],
    progress: number,
    safeError: KnowledgeUploadProgress['safeError'],
  ): void {
    this.emitProgress({ requestId, fileName, byteSize, state, progress, safeError });
  }
}
