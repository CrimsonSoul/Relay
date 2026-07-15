import type { PrivilegedCapability } from '@shared/privilegedAccess';
import {
  RelayOperatorConflictError,
  type RelayOperatorManager,
} from '../operators/RelayOperatorManager';
import {
  PrivilegedCommandConflictError,
  type PrivilegedCommandHandler,
  type RegisteredPrivilegedCommandName,
} from './PrivilegedCommandProcessor';

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

export type RegisterAdministrationCommandsOptions = {
  registrar: AdministrationRegistrar;
  operatorManager: OperatorAdministrationManager;
};

function translateConflict(error: unknown): never {
  if (error instanceof RelayOperatorConflictError) {
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
}
