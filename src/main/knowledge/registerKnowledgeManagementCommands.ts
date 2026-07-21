import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_UPLOADS_COLLECTION,
  type KnowledgeManagementDocumentView,
  type KnowledgeManagementErrorCode,
  type KnowledgeUploadView,
} from '@shared/knowledge';
import type { PrivilegedCapability } from '@shared/privilegedAccess';
import type {
  PrivilegedCommandHandler,
  RegisteredPrivilegedCommandName,
} from '../privileged/PrivilegedCommandProcessor';
import { loggers } from '../logger';
import {
  PrivilegedCommandAuthorizationError,
  PrivilegedCommandConflictError,
  PrivilegedCommandSafeError,
} from '../privileged/PrivilegedCommandProcessor';
import { KnowledgeExtractorWorker } from './KnowledgeExtractorWorker';
import { KnowledgeMutationCoordinator } from './KnowledgeMutationCoordinator';
import type { KnowledgeSearchIndexer } from './KnowledgeSearchIndexer';
import {
  ManagedKnowledgeConflictError,
  ManagedKnowledgeFilenameConflictError,
  type ManagedKnowledgeService,
} from './ManagedKnowledgeService';
import type { KnowledgeExtractionResult } from './knowledgeExtractor';
import { KnowledgeUploadAdmissionError } from './KnowledgeUploadCapacity';
import {
  KnowledgeUploadCoordinatorError,
  type KnowledgeUploadActor,
  type KnowledgeUploadCoordinator,
} from './KnowledgeUploadCoordinator';

type KnowledgeUploadRecord = {
  id: string;
  requestId: string;
  accountId: string;
  deviceId: string;
  actorDisplayName?: string;
  operatorId?: string;
  operatorName?: string;
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
  service: Pick<
    ManagedKnowledgeService,
    | 'snapshot'
    | 'publish'
    | 'replace'
    | 'setTitle'
    | 'setCategory'
    | 'renameCategory'
    | 'createCategory'
    | 'setCategoryName'
    | 'setCategoryOrder'
    | 'deleteCategory'
    | 'setDocumentMetadata'
    | 'assignDocumentCategories'
    | 'trash'
    | 'restore'
    | 'deletePermanently'
    | 'readAudit'
  >;
  coordinator?: KnowledgeMutationCoordinator;
  uploadCoordinator: Pick<
    KnowledgeUploadCoordinator,
    'beginBatch' | 'beginFile' | 'status' | 'finalize' | 'cancelFile' | 'cancelBatch' | 'dispose'
  >;
  searchIndexer?: Pick<
    KnowledgeSearchIndexer,
    'enqueue' | 'recordTriggerFailure' | 'retry' | 'remove' | 'dispose'
  >;
  consumeReauthenticationProof?: (
    requestId: string,
    context: { accountId: string; deviceId: string | null },
  ) => Promise<boolean>;
  extractor?: Pick<KnowledgeExtractorWorker, 'extract' | 'stop'>;
  readUploadPdf?: (record: KnowledgeUploadRecord) => Promise<Uint8Array>;
  fetch?: typeof globalThis.fetch;
};

function actor(context: { account: { id: string; displayName: string } }) {
  return {
    accountId: context.account.id,
    displayName: context.account.displayName,
  };
}

function uploadActor(context: {
  account: { id: string; displayName: string };
  device: { deviceId: string } | null;
  role: 'owner' | 'admin' | 'publisher';
}): KnowledgeUploadActor {
  return {
    accountId: context.account.id,
    deviceId: context.device?.deviceId ?? 'server-local',
    displayName: context.account.displayName,
    role: context.role,
  };
}

async function translateConflict<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ManagedKnowledgeConflictError) {
      throw new PrivilegedCommandConflictError(error.currentRevision);
    }
    if (error instanceof ManagedKnowledgeFilenameConflictError) {
      throw new PrivilegedCommandSafeError('duplicate-file-name');
    }
    throw error;
  }
}

function translateAdmissionError(error: KnowledgeUploadAdmissionError): never {
  if (error.code === 'conflict') throw new PrivilegedCommandConflictError(0);
  throw new PrivilegedCommandSafeError(error.code);
}

function translateCoordinatorError(error: KnowledgeUploadCoordinatorError): never {
  if (error.code === 'unauthorized') throw new PrivilegedCommandAuthorizationError();
  if (error.code === 'conflict') {
    throw new PrivilegedCommandConflictError(error.currentRevision ?? 0);
  }
  if (error.code === 'invalid-request' || error.code === 'not-found') {
    throw new PrivilegedCommandSafeError('invalid-request');
  }
  throw error;
}

async function translateUploadError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof KnowledgeUploadAdmissionError) translateAdmissionError(error);
    if (error instanceof KnowledgeUploadCoordinatorError) translateCoordinatorError(error);
    throw error;
  }
}

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

function observeBestEffort(operation: () => unknown, onFailure: () => void): void {
  let result: unknown;
  try {
    result = operation();
  } catch {
    onFailure();
    return;
  }
  void Promise.resolve(result).catch(onFailure);
}

function enqueueSearchIndexBestEffort(
  searchIndexer: Pick<KnowledgeSearchIndexer, 'enqueue' | 'recordTriggerFailure'> | undefined,
  document: Pick<KnowledgeManagementDocumentView, 'id' | 'checksum' | 'revision'>,
): void {
  if (!searchIndexer) return;
  const { id: documentId, checksum: expectedChecksum, revision: expectedRevision } = document;

  const logStatusFailure = () => {
    loggers.main.warn('Wiki search failure status could not be recorded', {
      documentId,
      reason: 'status-update-rejected',
    });
  };
  const recordFailure = () => {
    loggers.main.warn('Wiki search indexing trigger failed', {
      documentId,
      reason: 'trigger-rejected',
    });
    observeBestEffort(
      () =>
        searchIndexer.recordTriggerFailure({
          documentId,
          expectedChecksum,
          expectedRevision,
        }),
      logStatusFailure,
    );
  };

  observeBestEffort(() => searchIndexer.enqueue(documentId), recordFailure);
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
    proposedCategoryId: null,
    proposedDocumentType: 'sop',
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
  const coordinator = options.coordinator ?? new KnowledgeMutationCoordinator();
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
    'knowledge.upload.batch.begin',
    'knowledge.manage',
    (context, payload) =>
      translateUploadError(() =>
        options.uploadCoordinator.beginBatch(uploadActor(context), payload),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.upload.file.begin',
    'knowledge.manage',
    (context, payload) =>
      translateUploadError(() =>
        options.uploadCoordinator.beginFile(uploadActor(context), {
          requestId: context.requestId,
          ...payload,
        }),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.upload.status',
    'knowledge.manage',
    (context, payload) =>
      translateUploadError(() =>
        options.uploadCoordinator.status(uploadActor(context), payload.batchId),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.upload.file.finalize',
    'knowledge.manage',
    (context, payload) =>
      translateUploadError(() => options.uploadCoordinator.finalize(uploadActor(context), payload)),
  );
  options.registrar.registerCommand(
    'knowledge.upload.file.cancel',
    'knowledge.manage',
    (context, payload) =>
      translateUploadError(() =>
        options.uploadCoordinator.cancelFile(uploadActor(context), payload),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.upload.batch.cancel',
    'knowledge.manage',
    (context, payload) =>
      translateUploadError(() =>
        options.uploadCoordinator.cancelBatch(uploadActor(context), payload),
      ),
  );

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
            filter: `fileName="${record.fileName.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" && lifecycleState="active"`,
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

  options.registrar.registerCommand(
    'knowledge.snapshot.read',
    'knowledge.manage',
    (context, payload) => options.service.snapshot({ accountId: context.account.id, ...payload }),
  );
  options.registrar.registerCommand(
    'knowledge.document.publish',
    'knowledge.manage',
    async (context, payload) => {
      const result = await translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'published',
          mutate: () =>
            options.service.publish({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      );
      enqueueSearchIndexBestEffort(options.searchIndexer, result);
      return result;
    },
  );
  options.registrar.registerCommand(
    'knowledge.document.replace',
    'knowledge.manage',
    async (context, payload) => {
      const result = await translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'replaced',
          mutate: () =>
            options.service.replace({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      );
      enqueueSearchIndexBestEffort(options.searchIndexer, result);
      return result;
    },
  );
  options.registrar.registerCommand(
    'knowledge.document.title.set',
    'knowledge.manage',
    (context, payload) =>
      translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'title-changed',
          mutate: () =>
            options.service.setTitle({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.document.category.set',
    'knowledge.manage',
    (context, payload) =>
      translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'category-changed',
          mutate: () =>
            options.service.setCategory({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.category.rename',
    'knowledge.manage',
    (context, payload) =>
      translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'category-renamed',
          mutate: () =>
            options.service.renameCategory({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.category.create',
    'knowledge.manage',
    (context, payload) =>
      coordinator.run({
        requestId: context.requestId,
        action: 'category-created',
        mutate: () =>
          options.service.createCategory({
            actor: actor(context),
            requestId: context.requestId,
            ...payload,
          }),
      }),
  );
  options.registrar.registerCommand(
    'knowledge.category.name.set',
    'knowledge.manage',
    (context, payload) =>
      translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'category-renamed',
          mutate: () =>
            options.service.setCategoryName({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.category.order.set',
    'knowledge.manage',
    (context, payload) =>
      translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'category-reordered',
          mutate: () =>
            options.service.setCategoryOrder({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.category.delete',
    'knowledge.manage',
    (context, payload) =>
      translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'category-deleted',
          mutate: () =>
            options.service.deleteCategory({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.document.metadata.set',
    'knowledge.manage',
    (context, payload) =>
      translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'document-type-changed',
          mutate: () =>
            options.service.setDocumentMetadata({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.documents.category.assign',
    'knowledge.manage',
    (context, payload) =>
      translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'documents-reassigned',
          mutate: () =>
            options.service.assignDocumentCategories({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.document.trash',
    'knowledge.manage',
    (context, payload) =>
      translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'trashed',
          mutate: () =>
            options.service.trash({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.document.restore',
    'knowledge.manage',
    async (context, payload) => {
      const result = await translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'restored',
          mutate: () =>
            options.service.restore({
              actor: actor(context),
              requestId: context.requestId,
              ...payload,
            }),
        }),
      );
      enqueueSearchIndexBestEffort(options.searchIndexer, result);
      return result;
    },
  );
  options.registrar.registerCommand(
    'knowledge.document.delete',
    'knowledge.manage',
    async (context, payload) => {
      if (!options.consumeReauthenticationProof) throw new PrivilegedCommandAuthorizationError();
      const authorized = await options.consumeReauthenticationProof(payload.reauthRequestId, {
        accountId: context.account.id,
        deviceId: context.device?.deviceId ?? null,
      });
      if (!authorized) throw new PrivilegedCommandAuthorizationError();
      const result = await translateConflict(() =>
        coordinator.run({
          requestId: context.requestId,
          action: 'deleted',
          mutate: () =>
            options.service.deletePermanently({
              actor: actor(context),
              requestId: context.requestId,
              documentId: payload.documentId,
              expectedRevision: payload.expectedRevision,
            }),
        }),
      );
      await options.searchIndexer?.remove(payload.documentId);
      return result;
    },
  );
  options.registrar.registerCommand(
    'knowledge.document.search-index.retry',
    'knowledge.manage',
    async (_context, payload) => {
      options.searchIndexer?.retry(payload.documentId);
      return { documentId: payload.documentId, queued: Boolean(options.searchIndexer) };
    },
  );
  options.registrar.registerCommand(
    'knowledge.audit.read',
    'knowledge.manage',
    (_context, payload) => options.service.readAudit(payload),
  );

  return {
    dispose: async () => {
      await options.uploadCoordinator.dispose();
      await extractor.stop();
    },
  };
}
