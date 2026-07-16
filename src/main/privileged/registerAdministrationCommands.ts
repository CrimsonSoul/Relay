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
import {
  PrivilegedDeviceConflictError,
  type PrivilegedDeviceManager,
} from './PrivilegedDeviceManager';
import {
  RelaySettingConflictError,
  type RelayAdministrationService,
} from './RelayAdministrationService';
import type { RelayAdministrationSnapshotReader } from './RelayAdministrationSnapshotReader';

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
type DeviceAdministrationManager = Pick<PrivilegedDeviceManager, 'rename' | 'revoke'>;
type AdministrationSettingService = Pick<RelayAdministrationService, 'replace'>;
type AdministrationSnapshotReader = Pick<RelayAdministrationSnapshotReader, 'read'>;

type ReauthenticationProofConsumer = (
  requestId: string,
  context: { accountId: string; deviceId: string | null },
) => Promise<boolean>;

export type RegisterAdministrationCommandsOptions = {
  registrar: AdministrationRegistrar;
  operatorManager: OperatorAdministrationManager;
  publisherManager?: PublisherAdministrationManager;
  deviceManager?: DeviceAdministrationManager;
  administrationService?: AdministrationSettingService;
  snapshotReader?: AdministrationSnapshotReader;
  consumeReauthenticationProof?: ReauthenticationProofConsumer;
};

function translateConflict(error: unknown): never {
  if (error instanceof RelayOperatorConflictError) {
    throw new PrivilegedCommandConflictError(error.currentRevision);
  }
  if (error instanceof PublisherAssignmentConflictError) {
    throw new PrivilegedCommandConflictError(error.currentRevision);
  }
  if (error instanceof PrivilegedDeviceConflictError) {
    throw new PrivilegedCommandConflictError(error.currentRevision);
  }
  if (error instanceof RelaySettingConflictError) {
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
  deviceManager,
  administrationService,
  snapshotReader,
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
  if (deviceManager) {
    registrar.registerCommand('privileged.device.rename', 'devices.manage', (context, payload) =>
      withConflictTranslation(() =>
        deviceManager.rename({
          actorRole: context.role,
          deviceId: payload.deviceId,
          label: payload.label,
          expectedRevision: payload.expectedRevision,
        }),
      ),
    );
  }
  if (deviceManager && consumeReauthenticationProof) {
    registrar.registerCommand(
      'privileged.device.revoke',
      'devices.manage',
      async (context, payload) => {
        const authorized = await consumeReauthenticationProof(payload.reauthRequestId, {
          accountId: context.account.id,
          deviceId: context.device?.deviceId ?? null,
        });
        if (!authorized) throw new PrivilegedCommandAuthorizationError();
        return withConflictTranslation(() =>
          deviceManager.revoke({
            actorRole: context.role,
            actorOperatorId: context.operator.id,
            deviceId: payload.deviceId,
            expectedRevision: payload.expectedRevision,
          }),
        );
      },
    );
  }
  if (administrationService) {
    if (snapshotReader) {
      registrar.registerCommand('administration.snapshot.read', 'settings.manage', (context) =>
        snapshotReader.read({ accountId: context.account.id }),
      );
    }
    registrar.registerCommand(
      'administration.setting.replace',
      'settings.manage',
      async (context, payload) => {
        if (payload.setting === 'dynatrace.platform-token') {
          if (!payload.reauthRequestId || !consumeReauthenticationProof) {
            throw new PrivilegedCommandAuthorizationError();
          }
          const authorized = await consumeReauthenticationProof(payload.reauthRequestId, {
            accountId: context.account.id,
            deviceId: context.device?.deviceId ?? null,
          });
          if (!authorized) throw new PrivilegedCommandAuthorizationError();
        }
        return withConflictTranslation(() => administrationService.replace(payload));
      },
    );
  }
}
