import { randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import {
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  KNOWLEDGE_UPLOAD_MAX_FILES,
  type KnowledgeUploadSelectionResult,
} from '@shared/knowledge';
import {
  inspectKnowledgePdfCandidate,
  planKnowledgePdfSource,
} from '../knowledge/knowledgeChunking';

const maximumBatchBytes = KNOWLEDGE_UPLOAD_MAX_FILES * KNOWLEDGE_MAX_PDF_BYTES;
const rootInitializations = new Map<string, Promise<void>>();

export type WebKnowledgeStagingErrorCode =
  | 'invalid-request'
  | 'invalid-file'
  | 'conflict'
  | 'upload-failed';

export class WebKnowledgeStagingError extends Error {
  constructor(readonly code: WebKnowledgeStagingErrorCode) {
    super('Relay could not stage the selected Knowledge PDF.');
    this.name = 'WebKnowledgeStagingError';
  }
}

type FileDeclaration = { name: string; size: number };
type StagedFile = FileDeclaration & { id: string; path: string; received: number };
type ActiveBatch = { id: string; files: StagedFile[]; committed: boolean };

export type WebKnowledgeStagingBatch = {
  batchId: string;
  files: Array<{ id: string; name: string; size: number }>;
};

type WebKnowledgeUploadStagingOptions = {
  rootDir: string;
  sessionId: string;
  localSourceId: string;
  queuePaths: (
    paths: readonly string[],
    localSourceId: string,
  ) => Promise<KnowledgeUploadSelectionResult>;
  createId?: () => string;
  validatePath?: (path: string) => Promise<void>;
};

type AppendInput = {
  fileId: string;
  offset: number;
  contentType: string | undefined;
  contentLength: number | undefined;
  body: AsyncIterable<Uint8Array>;
};

function safeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,200}$/u.test(value);
}

function safeFileName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    basename(value) === value &&
    !value.includes('\\') &&
    extname(value).toLocaleLowerCase('en') === '.pdf' &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
  );
}

async function defaultValidatePath(path: string): Promise<void> {
  const candidate = await inspectKnowledgePdfCandidate(path);
  await planKnowledgePdfSource(candidate);
}

function initializeRoot(rootDir: string): Promise<void> {
  let initialization = rootInitializations.get(rootDir);
  if (!initialization) {
    initialization = (async () => {
      await rm(rootDir, { recursive: true, force: true });
      await mkdir(rootDir, { recursive: true, mode: 0o700 });
    })();
    rootInitializations.set(rootDir, initialization);
  }
  return initialization;
}

export function prepareWebKnowledgeUploadRoot(rootDir: string): Promise<void> {
  const initialization = (async () => {
    await rm(rootDir, { recursive: true, force: true });
    await mkdir(rootDir, { recursive: true, mode: 0o700 });
  })();
  rootInitializations.set(rootDir, initialization);
  return initialization;
}

export class WebKnowledgeUploadStaging {
  private readonly sessionDir: string;
  private readonly createId: () => string;
  private readonly validatePath: (path: string) => Promise<void>;
  private batch: ActiveBatch | null = null;
  private disposed = false;

  constructor(private readonly options: WebKnowledgeUploadStagingOptions) {
    if (!safeId(options.sessionId) || !safeId(options.localSourceId)) {
      throw new TypeError('Invalid web Knowledge session identity.');
    }
    this.sessionDir = join(options.rootDir, options.sessionId);
    this.createId = options.createId ?? randomUUID;
    this.validatePath = options.validatePath ?? defaultValidatePath;
  }

  async begin(declarations: readonly FileDeclaration[]): Promise<WebKnowledgeStagingBatch> {
    this.assertAvailable();
    if (this.batch) throw new WebKnowledgeStagingError('conflict');
    if (
      declarations.length < 1 ||
      declarations.length > KNOWLEDGE_UPLOAD_MAX_FILES ||
      declarations.some(
        (file) =>
          !safeFileName(file.name) ||
          !Number.isInteger(file.size) ||
          file.size < 5 ||
          file.size > KNOWLEDGE_MAX_PDF_BYTES,
      ) ||
      declarations.reduce((total, file) => total + file.size, 0) > maximumBatchBytes
    ) {
      throw new WebKnowledgeStagingError('invalid-file');
    }
    const names = declarations.map((file) => file.name.toLocaleLowerCase('en'));
    if (new Set(names).size !== names.length) {
      throw new WebKnowledgeStagingError('invalid-file');
    }

    await initializeRoot(this.options.rootDir);
    await rm(this.sessionDir, { recursive: true, force: true });
    await mkdir(this.sessionDir, { recursive: false, mode: 0o700 });
    const batchId = this.createId();
    const files: StagedFile[] = [];
    try {
      for (const declaration of declarations) {
        const id = this.createId();
        if (!safeId(id)) throw new WebKnowledgeStagingError('upload-failed');
        const path = join(this.sessionDir, declaration.name);
        const handle = await open(path, 'wx', 0o600);
        await handle.close();
        files.push({ ...declaration, id, path, received: 0 });
      }
    } catch (error) {
      await rm(this.sessionDir, { recursive: true, force: true });
      throw error instanceof WebKnowledgeStagingError
        ? error
        : new WebKnowledgeStagingError('upload-failed');
    }
    this.batch = { id: batchId, files, committed: false };
    return {
      batchId,
      files: files.map(({ id, name, size }) => ({ id, name, size })),
    };
  }

  async append(input: AppendInput): Promise<void> {
    this.assertAvailable();
    const batch = this.batch;
    const file = batch?.files.find((candidate) => candidate.id === input.fileId);
    const length = input.contentLength;
    if (
      !batch ||
      batch.committed ||
      !file ||
      input.contentType !== 'application/octet-stream' ||
      !Number.isInteger(input.offset) ||
      input.offset !== file.received ||
      !Number.isInteger(length) ||
      !length ||
      length < 1 ||
      length > KNOWLEDGE_UPLOAD_CHUNK_BYTES ||
      length > file.size - file.received
    ) {
      await this.abortCurrent();
      throw new WebKnowledgeStagingError('invalid-request');
    }

    const handle = await open(file.path, 'r+');
    let written = 0;
    try {
      for await (const rawChunk of input.body) {
        const chunk = Uint8Array.from(rawChunk);
        if (written + chunk.byteLength > length) {
          throw new WebKnowledgeStagingError('invalid-request');
        }
        let chunkOffset = 0;
        while (chunkOffset < chunk.byteLength) {
          const result = await handle.write(
            chunk,
            chunkOffset,
            chunk.byteLength - chunkOffset,
            file.received + written + chunkOffset,
          );
          if (result.bytesWritten < 1) throw new WebKnowledgeStagingError('upload-failed');
          chunkOffset += result.bytesWritten;
        }
        written += chunk.byteLength;
      }
      if (written !== length) throw new WebKnowledgeStagingError('invalid-request');
      file.received += written;
    } catch (error) {
      await handle.close().catch(() => undefined);
      await this.abortCurrent();
      throw error instanceof WebKnowledgeStagingError
        ? error
        : new WebKnowledgeStagingError('upload-failed');
    }
    await handle.close();
  }

  async commit(batchId: string): Promise<KnowledgeUploadSelectionResult> {
    this.assertAvailable();
    const batch = this.batch;
    if (
      !batch ||
      batch.id !== batchId ||
      batch.committed ||
      batch.files.some((file) => file.received !== file.size)
    ) {
      await this.abortCurrent();
      throw new WebKnowledgeStagingError('invalid-request');
    }
    try {
      for (const file of batch.files) await this.validatePath(file.path);
      const result = await this.options.queuePaths(
        batch.files.map((file) => file.path),
        this.options.localSourceId,
      );
      if (!result.ok) {
        await this.abortCurrent();
        return result;
      }
      batch.committed = true;
      return result;
    } catch (error) {
      await this.abortCurrent();
      throw error instanceof WebKnowledgeStagingError
        ? error
        : new WebKnowledgeStagingError('invalid-file');
    }
  }

  async abort(batchId: string): Promise<void> {
    if (this.batch && this.batch.id !== batchId) {
      throw new WebKnowledgeStagingError('invalid-request');
    }
    await this.abortCurrent();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.batch = null;
    await rm(this.sessionDir, { recursive: true, force: true });
  }

  private assertAvailable(): void {
    if (this.disposed) throw new WebKnowledgeStagingError('upload-failed');
  }

  private async abortCurrent(): Promise<void> {
    this.batch = null;
    await rm(this.sessionDir, { recursive: true, force: true });
  }
}
