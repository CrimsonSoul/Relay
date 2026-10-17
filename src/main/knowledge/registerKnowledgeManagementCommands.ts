import type { KnowledgeManagementDocumentView } from '@shared/knowledge';
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
import { KnowledgeMutationCoordinator } from './KnowledgeMutationCoordinator';
import type { KnowledgeSearchIndexer } from './KnowledgeSearchIndexer';
import {
  ManagedKnowledgeConflictError,
  ManagedKnowledgeFilenameConflictError,
  type ManagedKnowledgeService,
} from './ManagedKnowledgeService';
import { KnowledgeUploadAdmissionError } from './KnowledgeUploadCapacity';
import {
  KnowledgeUploadCoordinatorError,
  type KnowledgeUploadActor,
  type KnowledgeUploadCoordinator,
} from './KnowledgeUploadCoordinator';

type KnowledgeCommandRegistrar = {
  registerCommand<K extends RegisteredPrivilegedCommandName>(
    command: K,
    capability: PrivilegedCapability,
    handler: PrivilegedCommandHandler<K>,
  ): void;
};

type KnowledgeManagementCommandOptions = {
  registrar: KnowledgeCommandRegistrar;
  service: Pick<
    ManagedKnowledgeService,
    | 'snapshot'
    | 'publish'
    | 'replace'
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
    'enqueue' | 'recordTriggerFailure' | 'remove' | 'dispose'
  >;
  consumeReauthenticationProof?: (
    requestId: string,
    context: { accountId: string; deviceId: string | null },
  ) => Promise<boolean>;
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

export function registerKnowledgeManagementCommands(options: KnowledgeManagementCommandOptions): {
  dispose(): Promise<void>;
} {
  const coordinator = options.coordinator ?? new KnowledgeMutationCoordinator();
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
        coordinator.run({
          requestId: context.requestId,
          mutate: () => options.uploadCoordinator.cancelFile(uploadActor(context), payload),
        }),
      ),
  );
  options.registrar.registerCommand(
    'knowledge.upload.batch.cancel',
    'knowledge.manage',
    (context, payload) =>
      translateUploadError(() =>
        coordinator.run({
          requestId: context.requestId,
          mutate: () => options.uploadCoordinator.cancelBatch(uploadActor(context), payload),
        }),
      ),
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
    'knowledge.category.create',
    'knowledge.manage',
    (context, payload) =>
      coordinator.run({
        requestId: context.requestId,
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
      options.searchIndexer?.enqueue(payload.documentId);
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
    },
  };
}
