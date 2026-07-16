import type PocketBase from 'pocketbase';
import {
  isPrivilegedAdministrator,
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type RelayAdministrationSnapshot,
  type RelayOperatorAdminView,
  type RelayPrivilegedAccountAdminView,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { RELAY_OPERATORS_COLLECTION, type RelayOperatorRecord } from '@shared/operators';
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

function operatorView(
  operator: RelayOperatorRecord,
  state: RelayPrivilegedStateRecord,
): RelayOperatorAdminView {
  let role: RelayOperatorAdminView['role'] = null;
  if (isPrivilegedAdministrator(state, operator.id)) role = 'admin';
  else if (operator.id === state.publisherOperatorId) role = 'publisher';
  return {
    id: operator.id,
    displayName: operator.displayName,
    active: operator.active,
    revision: Number.isInteger(operator.revision) ? operator.revision! : 0,
    role,
    created: canonicalTimestamp(operator.created),
    updated: canonicalTimestamp(operator.updated),
  };
}

function accountView(account: RelayPrivilegedAccountRecord): RelayPrivilegedAccountAdminView {
  return {
    accountId: account.id,
    operatorId: account.operatorId,
    role: account.role,
    active: account.active,
    credentialState:
      account.active && !account.mustChangePassword ? 'configured' : 'not-configured',
    mustChangePassword: account.mustChangePassword,
    credentialVersion: account.credentialVersion,
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
    const [state, operators, privilegedAccounts, devices] = await Promise.all([
      this.source('state', () =>
        this.pb
          .collection(RELAY_PRIVILEGED_STATE_COLLECTION)
          .getFirstListItem<RelayPrivilegedStateRecord>('key="primary"', { requestKey: null }),
      ),
      this.source('operators', () =>
        this.pb
          .collection(RELAY_OPERATORS_COLLECTION)
          .getFullList<RelayOperatorRecord>({ requestKey: null }),
      ),
      this.source('accounts', () =>
        this.pb
          .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
          .getFullList<RelayPrivilegedAccountRecord>({ requestKey: null }),
      ),
      this.source('devices', () =>
        this.deviceManager.list({ role: 'admin', accountId: input.accountId }),
      ),
    ]);
    try {
      return {
        operators: operators.map((operator) => operatorView(operator, state)),
        privilegedAccounts: privilegedAccounts
          .map(accountView)
          .sort((left, right) => left.role.localeCompare(right.role)),
        devices,
        settings: this.administrationService.getSettingSummaries(),
        adminOperatorId: state.adminOperatorId,
        publisherOperatorId: state.publisherOperatorId || null,
        assignmentRevision: state.assignmentVersion,
        generatedAt: new Date(this.now()).toISOString(),
      };
    } catch {
      this.logger.warn('Administration snapshot data could not be normalized.', {
        operatorsHaveDates: operators.every(
          (operator) =>
            Boolean(operator.created) &&
            Boolean(operator.updated) &&
            Number.isFinite(Date.parse(operator.created)) &&
            Number.isFinite(Date.parse(operator.updated)),
        ),
        source: 'normalization',
      });
      throw new Error('Administration snapshot data is invalid.');
    }
  }
}
