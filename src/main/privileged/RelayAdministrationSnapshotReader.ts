import type PocketBase from 'pocketbase';
import {
  MAX_PRIVILEGED_ADMINISTRATORS,
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type RelayAdministrationSnapshot,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedStateRecord,
  type RelayRoleAccountAdminView,
} from '@shared/privilegedAccess';
import { getEffectiveRole } from '@shared/roleAccounts';
import type { PrivilegedDeviceManager } from './PrivilegedDeviceManager';
import type { RelayAdministrationService } from './RelayAdministrationService';

type SnapshotReaderOptions = {
  pb: PocketBase;
  deviceManager: Pick<PrivilegedDeviceManager, 'list'>;
  administrationService: Pick<RelayAdministrationService, 'getSettingSummaries'>;
  now?: () => number;
  logger?: { warn(message: string, metadata?: Record<string, unknown>): void };
};

const silentLogger = { warn: () => undefined };

function canonicalTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('Administration data contains an invalid date.');
  return new Date(timestamp).toISOString();
}

function canonicalTimestampOrNull(value: string | undefined): string | null {
  return value ? canonicalTimestamp(value) : null;
}

function accountView(
  account: RelayPrivilegedAccountRecord,
  state: RelayPrivilegedStateRecord,
): RelayRoleAccountAdminView {
  return {
    accountId: account.id,
    username: account.username,
    displayName: account.displayName,
    storedRole: account.storedRole,
    effectiveRole: getEffectiveRole(account, state),
    active: account.active,
    credentialState:
      account.active && !account.mustChangePassword ? 'configured' : 'not-configured',
    mustChangePassword: account.mustChangePassword,
    credentialVersion: account.credentialVersion,
    revision: account.revision,
    createdAt: canonicalTimestamp(account.created),
    updatedAt: canonicalTimestampOrNull(account.updated),
  };
}

export class RelayAdministrationSnapshotReader {
  private readonly pb: PocketBase;
  private readonly deviceManager: Pick<PrivilegedDeviceManager, 'list'>;
  private readonly administrationService: Pick<RelayAdministrationService, 'getSettingSummaries'>;
  private readonly now: () => number;
  private readonly logger: NonNullable<SnapshotReaderOptions['logger']>;

  constructor(options: SnapshotReaderOptions) {
    this.pb = options.pb;
    this.deviceManager = options.deviceManager;
    this.administrationService = options.administrationService;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? silentLogger;
  }

  private async source<T>(name: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch {
      this.logger.warn('Administration snapshot source is unavailable.', { source: name });
      throw new Error('Administration snapshot source is unavailable.');
    }
  }

  async read(input: { accountId: string }): Promise<RelayAdministrationSnapshot> {
    const [state, accounts] = await Promise.all([
      this.source('state', () =>
        this.pb
          .collection(RELAY_PRIVILEGED_STATE_COLLECTION)
          .getFirstListItem<RelayPrivilegedStateRecord>('key="primary"', { requestKey: null }),
      ),
      this.source('accounts', () =>
        this.pb
          .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
          .getFullList<RelayPrivilegedAccountRecord>({ requestKey: null }),
      ),
    ]);
    if (accounts.length > MAX_PRIVILEGED_ADMINISTRATORS + 1) {
      throw new Error('Administration snapshot data is invalid.');
    }
    const actor = accounts.find(({ id }) => id === input.accountId);
    const actorRole = actor ? getEffectiveRole(actor, state) : null;
    if (!actor || !actor.active || !actorRole)
      throw new Error('Administration account is unavailable.');
    const devices = await this.source('devices', () =>
      this.deviceManager.list({ role: actorRole, accountId: input.accountId }),
    );
    try {
      return {
        accounts: accounts
          .map((account) => accountView(account, state))
          .sort((left, right) => {
            if (left.accountId === state.ownerAccountId) return -1;
            if (right.accountId === state.ownerAccountId) return 1;
            return left.username.localeCompare(right.username);
          }),
        devices,
        settings: this.administrationService.getSettingSummaries(),
        ownerAccountId: state.ownerAccountId,
        publisherAccountId: state.publisherAccountId || null,
        assignmentRevision: state.assignmentVersion,
        generatedAt: new Date(this.now()).toISOString(),
      };
    } catch {
      this.logger.warn('Administration snapshot data could not be normalized.', {
        source: 'normalization',
      });
      throw new Error('Administration snapshot data is invalid.');
    }
  }
}
