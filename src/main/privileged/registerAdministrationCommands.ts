import type { PrivilegedCapability } from '@shared/privilegedAccess';
import {
  RelayOperatorConflictError,
  type RelayOperatorManager,
} from '../operators/RelayOperatorManager';
import {
  PrivilegedCommandAuthorizationError,
  PrivilegedCommandConflictError,
  type PrivilegedCommandHandler,
  type RegisteredPrivilegedCommandName,
} from './PrivilegedCommandProcessor';
import {
  PublisherAssignmentConflictError,
  type PublisherAssignmentManager,
} from './PublisherAssignmentManager';

type AdministrationRegistrar = {
  registerCommand<K extends RegisteredPrivilegedCommandName>(
    command: K,
    capability: PrivilegedCapability,
    handler: PrivilegedCommandHandler<K>,
  ): void;
};

type OperatorAdministrationManager = Pick<
  RelayOperatorManager,
  'create' | 'renameByRevision' | 'setActiveByRevision' | 'getRoleProtectionState'
>;

type PublisherAdministrationManager = Pick<PublisherAssignmentManager, 'assign'>;

type ReauthenticationProofConsumer = (
  requestId: string,
  context: { accountId: string; deviceId: string | null },
) => Promise<boolean>;

export type RegisterAdministrationCommandsOptions = {
  registrar: AdministrationRegistrar;
  operatorManager: OperatorAdministrationManager;
  publisherManager?: PublisherAdministrationManager;
  consumeReauthenticationProof?: ReauthenticationProofConsumer;
};

function translateConflict(error: unknown): never {
  if (error instanceof RelayOperatorConflictError) {
    throw new PrivilegedCommandConflictError(error.currentRevision);
  }
  if (error instanceof PublisherAssignmentConflictError) {
    throw new PrivilegedCommandConflictError(error.currentRevision);
  }
  throw error;
}

async function withConflictTranslation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return translateConflict(error);
  }
}

export function registerAdministrationCommands({
  registrar,
  operatorManager,
  publisherManager,
  consumeReauthenticationProof,
}: RegisterAdministrationCommandsOptions): void {
  registrar.registerCommand('operator.create', 'operators.manage', (_context, payload) =>
    operatorManager.create(payload),
  );
  registrar.registerCommand('operator.rename', 'operators.manage', (_context, payload) =>
    withConflictTranslation(() => operatorManager.renameByRevision(payload)),
  );
  registrar.registerCommand(
    'operator.active.set',
    'operators.manage',
    async (_context, payload) => {
      const protection = await operatorManager.getRoleProtectionState();
      return withConflictTranslation(() =>
        operatorManager.setActiveByRevision(payload, protection),
      );
    },
  );
  if (publisherManager && consumeReauthenticationProof) {
    registrar.registerCommand('publisher.assign', 'publisher.assign', async (context, payload) => {
      const authorized = await consumeReauthenticationProof(payload.reauthRequestId, {
        accountId: context.account.id,
        deviceId: context.device?.deviceId ?? null,
      });
      if (!authorized) throw new PrivilegedCommandAuthorizationError();
      return withConflictTranslation(() =>
        publisherManager.assign({
          operatorId: payload.operatorId,
          expectedStateRevision: payload.expectedStateRevision,
          actorOperatorId: context.operator.id,
        }),
      );
    });
  }
}
