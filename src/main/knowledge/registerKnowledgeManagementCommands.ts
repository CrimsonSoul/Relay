import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_UPLOADS_COLLECTION,
  type KnowledgeManagementErrorCode,
  type KnowledgeUploadView,
} from '@shared/knowledge';
import type { PrivilegedCapability } from '@shared/privilegedAccess';
import type {
  PrivilegedCommandHandler,
  RegisteredPrivilegedCommandName,
} from '../privileged/PrivilegedCommandProcessor';
import { KnowledgeExtractorWorker } from './KnowledgeExtractorWorker';
import type { KnowledgeExtractionResult } from './knowledgeExtractor';

type KnowledgeUploadRecord = {
  id: string;
  requestId: string;
  accountId: string;
  deviceId: string;
  operatorId: string;
  operatorName: string;
  fileName: string;
  pdf: string;
  checksum: string;
  byteSize: number;
  state: string;
  expiresAt: string;
  revision: number;
};

type KnowledgeCommandRegistrar = {
  registerCommand<K extends RegisteredPrivilegedCommandName>(
    command: K,
    capability: PrivilegedCapability,
    handler: PrivilegedCommandHandler<K>,
  ): void;
};

type KnowledgeManagementCommandOptions = {
  registrar: KnowledgeCommandRegistrar;
  pb: PocketBase;
  extractor?: Pick<KnowledgeExtractorWorker, 'extract' | 'stop'>;
  readUploadPdf?: (record: KnowledgeUploadRecord) => Promise<Uint8Array>;
  fetch?: typeof globalThis.fetch;
};

function checksumOf(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function safeError(error: unknown): KnowledgeManagementErrorCode {
  const message = error instanceof Error ? error.message : '';
  if (message === 'encrypted-pdf') return 'encrypted-pdf';
  if (message === 'page-limit') return 'too-many-pages';
  if (message === 'extraction-timeout') return 'extraction-timeout';
  return 'validation-failed';
}

function uploadView(
  record: KnowledgeUploadRecord,
  extraction: KnowledgeExtractionResult | null,
  duplicateDocumentId: string | null,
  error: KnowledgeManagementErrorCode | null,
): KnowledgeUploadView {
  const title = record.fileName.replace(/\.pdf$/i, '');
  return {
    id: record.id,
    requestId: record.requestId,
    fileName: record.fileName,
    byteSize: record.byteSize,
    checksum: record.checksum,
    state: error ? 'failed' : 'ready',
    progress: error ? 0 : 100,
    proposedTitle: extraction?.metadataTitle ?? title,
    proposedCategory: 'General',
    pageCount: extraction?.pageCount ?? null,
    outline: extraction?.outline ?? [],
    outlineSource: extraction?.outlineSource ?? null,
    duplicateDocumentId,
    safeError: error,
    expiresAt: new Date(record.expiresAt).toISOString(),
    revision: Number.isInteger(record.revision) ? record.revision + 1 : 1,
  };
}

export function registerKnowledgeManagementCommands(options: KnowledgeManagementCommandOptions): {
  dispose(): Promise<void>;
} {
  const extractor = options.extractor ?? new KnowledgeExtractorWorker();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const readUploadPdf =
    options.readUploadPdf ??
    (async (record: KnowledgeUploadRecord) => {
      const token = await options.pb.files.getToken({ requestKey: null });
      const url = options.pb.files.getURL(record as never, record.pdf, { token });
      const response = await fetchImpl(url, { redirect: 'error' });
      if (!response.ok) throw new Error('upload-download-failed');
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > KNOWLEDGE_MAX_PDF_BYTES) {
        throw new Error('upload-too-large');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > KNOWLEDGE_MAX_PDF_BYTES) throw new Error('upload-too-large');
      return bytes;
    });

  options.registrar.registerCommand(
    'knowledge.upload.validate',
    'knowledge.manage',
    async (context, payload) => {
      const uploads = options.pb.collection(KNOWLEDGE_UPLOADS_COLLECTION);
      const record = await uploads.getOne<KnowledgeUploadRecord>(payload.uploadId, {
        requestKey: null,
      });
      const expectedDeviceId = context.device?.deviceId ?? 'server-local';
      if (
        record.accountId !== context.account.id ||
        record.operatorId !== context.operator.id ||
        record.deviceId !== expectedDeviceId ||
        record.checksum !== payload.preliminaryChecksum ||
        !['validating', 'failed'].includes(record.state)
      ) {
        throw new Error('upload-binding-invalid');
      }
      let extraction: KnowledgeExtractionResult | null = null;
      let duplicateDocumentId: string | null = null;
      try {
        const bytes = await readUploadPdf(record);
        if (
          bytes.byteLength !== record.byteSize ||
          bytes.byteLength < 5 ||
          bytes.byteLength > KNOWLEDGE_MAX_PDF_BYTES ||
          Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-' ||
          checksumOf(bytes) !== record.checksum
        ) {
          throw new Error('invalid-pdf');
        }
        await uploads.update(record.id, { state: 'extracting' }, { requestKey: null });
        extraction = await extractor.extract(bytes);
        const duplicate = await options.pb
          .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
          .getFullList<{ id: string }>({
            filter: `fileName="${record.fileName.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`,
            fields: 'id',
            requestKey: null,
          });
        duplicateDocumentId = duplicate[0]?.id ?? null;
        const view = uploadView(record, extraction, duplicateDocumentId, null);
        await uploads.update(
          record.id,
          {
            state: 'ready',
            pageCount: view.pageCount,
            outline: view.outline,
            outlineSource: view.outlineSource,
            proposedTitle: view.proposedTitle,
            proposedCategory: view.proposedCategory,
            duplicateDocumentId: duplicateDocumentId ?? '',
            safeError: '',
            revision: view.revision,
          },
          { requestKey: null },
        );
        return view;
      } catch (error) {
        const code = safeError(error);
        const view = uploadView(record, extraction, duplicateDocumentId, code);
        await uploads.update(
          record.id,
          { state: 'failed', safeError: code, revision: view.revision },
          { requestKey: null },
        );
        return view;
      }
    },
  );

  return { dispose: () => extractor.stop() };
}
