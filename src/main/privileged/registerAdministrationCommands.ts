import type { PrivilegedCapability } from '@shared/privilegedAccess';
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
import { RoleAccountConflictError, type RoleAccountManager } from './RoleAccountManager';

type AdministrationRegistrar = {
  registerCommand<K extends RegisteredPrivilegedCommandName>(
    command: K,
    capability: PrivilegedCapability,
    handler: PrivilegedCommandHandler<K>,
  ): void;
};
type RoleAccountAdministrationManager = Pick<
  RoleAccountManager,
  | 'createAdministrator'
  | 'createPublisher'
  | 'updateDisplayName'
  | 'setActive'
  | 'transferOwnership'
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
  roleAccountManager: RoleAccountAdministrationManager;
  publisherManager?: PublisherAdministrationManager;
  deviceManager?: DeviceAdministrationManager;
  administrationService?: AdministrationSettingService;
  snapshotReader?: AdministrationSnapshotReader;
  consumeReauthenticationProof?: ReauthenticationProofConsumer;
};

function translateConflict(error: unknown): never {
  if (
    error instanceof RoleAccountConflictError ||
    error instanceof PublisherAssignmentConflictError ||
    error instanceof PrivilegedDeviceConflictError ||
    error instanceof RelaySettingConflictError
  ) {
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

async function requireReauthentication(
  consume: ReauthenticationProofConsumer | undefined,
  requestId: string,
  context: { account: { id: string }; device: { deviceId: string } | null },
): Promise<void> {
  const authorized =
    consume &&
    (await consume(requestId, {
      accountId: context.account.id,
      deviceId: context.device?.deviceId ?? null,
    }));
  if (!authorized) throw new PrivilegedCommandAuthorizationError();
}

export function registerAdministrationCommands({
  registrar,
  roleAccountManager,
  publisherManager,
  deviceManager,
  administrationService,
  snapshotReader,
  consumeReauthenticationProof,
}: RegisterAdministrationCommandsOptions): void {
  registrar.registerCommand('account.admin.create', 'accounts.manage', (context, payload) =>
    withConflictTranslation(() =>
      roleAccountManager.createAdministrator({ actorAccountId: context.account.id, ...payload }),
    ),
  );
  registrar.registerCommand('account.publisher.create', 'publisher.assign', (context, payload) =>
    withConflictTranslation(() =>
      roleAccountManager.createPublisher({ actorAccountId: context.account.id, ...payload }),
    ),
  );
  registrar.registerCommand('account.display-name.update', 'publisher.assign', (context, payload) =>
    withConflictTranslation(() =>
      roleAccountManager.updateDisplayName({ actorAccountId: context.account.id, ...payload }),
    ),
  );
  registrar.registerCommand('account.active.set', 'publisher.assign', (context, payload) =>
    withConflictTranslation(() =>
      roleAccountManager.setActive({ actorAccountId: context.account.id, ...payload }),
    ),
  );
  registrar.registerCommand(
    'ownership.transfer',
    'ownership.transfer',
    async (context, payload) => {
      await requireReauthentication(consumeReauthenticationProof, payload.reauthRequestId, context);
      return withConflictTranslation(() =>
        roleAccountManager.transferOwnership({
          actorAccountId: context.account.id,
          accountId: payload.accountId,
          expectedStateRevision: payload.expectedStateRevision,
        }),
      );
    },
  );
  if (publisherManager) {
    registrar.registerCommand('publisher.assign', 'publisher.assign', async (context, payload) => {
      await requireReauthentication(consumeReauthenticationProof, payload.reauthRequestId, context);
      return withConflictTranslation(() =>
        publisherManager.assign({
          accountId: payload.accountId,
          expectedStateRevision: payload.expectedStateRevision,
          actorAccountId: context.account.id,
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
    registrar.registerCommand(
      'privileged.device.revoke',
      'devices.manage',
      async (context, payload) => {
        await requireReauthentication(
          consumeReauthenticationProof,
          payload.reauthRequestId,
          context,
        );
        return withConflictTranslation(() =>
          deviceManager.revoke({
            actorRole: context.role,
            actorAccountId: context.account.id,
            deviceId: payload.deviceId,
            expectedRevision: payload.expectedRevision,
          }),
        );
      },
    );
  }
  if (administrationService) {
    if (snapshotReader)
      registrar.registerCommand('administration.snapshot.read', 'settings.manage', (context) =>
        snapshotReader.read({ accountId: context.account.id }),
      );
    registrar.registerCommand(
      'administration.setting.replace',
      'settings.manage',
      async (context, payload) => {
        if (payload.setting === 'dynatrace.platform-token') {
          if (!payload.reauthRequestId) throw new PrivilegedCommandAuthorizationError();
          await requireReauthentication(
            consumeReauthenticationProof,
            payload.reauthRequestId,
            context,
          );
        }
        return withConflictTranslation(() => administrationService.replace(payload));
      },
    );
  }
}
