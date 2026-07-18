import { randomBytes } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
} from '@shared/privilegedAccess';
import {
  getRoleDisplayNameError,
  getRoleUsernameError,
  normalizeRoleDisplayName,
  normalizeRoleUsername,
  type StoredRoleAccountRole,
} from '@shared/roleAccounts';

export const ROLE_ACCOUNT_MIGRATION_VERSION = 1;
const LEGACY_ROSTER_COLLECTION = 'relay_operators';
const LEGACY_LOGIN_ROSTER_VIEW = 'relay_login_roster';
const LEGACY_LOGIN_ROSTER_QUERY = 'select id, displayname from relay_operators where active = true';

export type RoleAccountMigrationResult =
  | { status: 'already-complete' }
  | { status: 'migrated'; ownerAccountId: string; administratorAccountIds: string[] }
  | { status: 'deferred'; reason: string };

type CollectionInfo = { id: string; name: string; type?: unknown; viewQuery?: unknown };
type PocketBaseRecord = { id: string; [key: string]: unknown };

type LegacyOperatorRecord = PocketBaseRecord & {
  displayName?: unknown;
};

type MigrationAccountRecord = PocketBaseRecord & {
  operatorId?: unknown;
  legacyOperatorId?: unknown;
  username?: unknown;
  displayName?: unknown;
  role?: unknown;
  storedRole?: unknown;
  active?: unknown;
  mustChangePassword?: unknown;
  credentialVersion?: unknown;
  revision?: unknown;
};

type MigrationStateRecord = PocketBaseRecord & {
  key?: unknown;
  adminOperatorId?: unknown;
  adminOperatorIds?: unknown;
  publisherOperatorId?: unknown;
  ownerAccountId?: unknown;
  publisherAccountId?: unknown;
  assignmentVersion?: unknown;
  identityMigrationVersion?: unknown;
};

type MigrationDeviceRecord = PocketBaseRecord & {
  accountId?: unknown;
};

type PlannedAccount = {
  record: MigrationAccountRecord;
  operatorId: string;
  displayName: string;
  username: string;
  storedRole: StoredRoleAccountRole;
};

type PlannedUpdate = {
  collection: string;
  recordId: string;
  data: Record<string, unknown>;
};

type ExistingMigrationPlan = {
  state: MigrationStateRecord;
  ownerAccountId: string;
  publisherAccountId: string | null;
  administratorAccountIds: string[];
  accounts: PlannedAccount[];
  retiredAccountIds: string[];
  historicalUpdates: PlannedUpdate[];
  loginRosterView: CollectionInfo | null;
};

const HISTORICAL_SNAPSHOT_FIELDS: ReadonlyArray<{
  collection: string;
  operatorIdField: string;
  snapshotField: string;
}> = [
  { collection: 'alert_reminders', operatorIdField: 'operatorId', snapshotField: 'createdBy' },
  {
    collection: 'dynatrace_problem_states',
    operatorIdField: 'operatorId',
    snapshotField: 'addressedBy',
  },
  {
    collection: 'dynatrace_problem_notes',
    operatorIdField: 'operatorId',
    snapshotField: 'author',
  },
  {
    collection: 'knowledge_documents',
    operatorIdField: 'publishedByOperatorId',
    snapshotField: 'publishedByName',
  },
  {
    collection: 'knowledge_documents',
    operatorIdField: 'trashedByOperatorId',
    snapshotField: 'trashedByName',
  },
  {
    collection: 'knowledge_upload_batches',
    operatorIdField: 'operatorId',
    snapshotField: 'operatorName',
  },
  {
    collection: 'knowledge_uploads',
    operatorIdField: 'operatorId',
    snapshotField: 'operatorName',
  },
  {
    collection: 'knowledge_audit_events',
    operatorIdField: 'operatorId',
    snapshotField: 'operatorName',
  },
  {
    collection: 'relay_privileged_commands',
    operatorIdField: 'operatorId',
    snapshotField: 'displayNameSnapshot',
  },
  {
    collection: 'relay_privileged_pairing_requests',
    operatorIdField: 'operatorId',
    snapshotField: 'displayNameSnapshot',
  },
];

const RYAN_DISPLAY_NAME = 'Ryan Bledsoe';
const CHARLES_DISPLAY_NAME = 'Charles Gibbs';

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function normalizedViewQuery(value: unknown): string | null {
  return typeof value === 'string'
    ? value.trim().replace(/;$/, '').replace(/\s+/g, ' ').toLocaleLowerCase('en')
    : null;
}

function validatedLegacyLoginRosterView(
  collectionByName: ReadonlyMap<string, CollectionInfo>,
): CollectionInfo | null | { reason: string } {
  const view = collectionByName.get(LEGACY_LOGIN_ROSTER_VIEW);
  if (!view) return null;
  if (view.type !== 'view' || normalizedViewQuery(view.viewQuery) !== LEGACY_LOGIN_ROSTER_QUERY) {
    return { reason: 'The legacy login roster view has an unexpected definition.' };
  }
  return view;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => nonEmptyString(entry))
    : [];
}

function normalizedDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const displayName = normalizeRoleDisplayName(value);
  return getRoleDisplayNameError(displayName) === null ? displayName : null;
}

function storedRoleForAccount(account: MigrationAccountRecord): StoredRoleAccountRole | null {
  if (account.storedRole === 'administrator' || account.storedRole === 'publisher') {
    return account.storedRole;
  }
  if (account.role === 'admin') return 'administrator';
  if (account.role === 'publisher') return 'publisher';
  return null;
}

function partitionExistingAccounts(
  accounts: MigrationAccountRecord[],
):
  | { protectedAccounts: MigrationAccountRecord[]; retiredAccounts: MigrationAccountRecord[] }
  | { reason: string } {
  const protectedAccounts: MigrationAccountRecord[] = [];
  const retiredAccounts: MigrationAccountRecord[] = [];
  for (const account of accounts) {
    if (storedRoleForAccount(account)) {
      protectedAccounts.push(account);
      continue;
    }
    if (account.role === 'operator' && !nonEmptyString(account.storedRole)) {
      retiredAccounts.push(account);
      continue;
    }
    return { reason: `Auth account ${account.id} has an invalid role.` };
  }
  return { protectedAccounts, retiredAccounts };
}

function accountLegacyOperatorId(account: MigrationAccountRecord): string | null {
  if (nonEmptyString(account.legacyOperatorId)) return account.legacyOperatorId;
  return nonEmptyString(account.operatorId) ? account.operatorId : null;
}

function generatedUsername(displayName: string): string {
  const dotted = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '.');
  const candidate = normalizeRoleUsername(dotted.split('.').filter(Boolean).join('.'));
  return getRoleUsernameError(candidate) === null ? candidate : 'publisher';
}

function allocateUsername(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base.slice(0, Math.max(1, 64 - String(suffix).length - 1))}-${suffix}`;
    if (used.has(candidate)) continue;
    used.add(candidate);
    return candidate;
  }
  throw new Error('Unable to allocate a unique role account username.');
}

function uniqueRecordByDisplayName(
  operators: LegacyOperatorRecord[],
  displayName: string,
): LegacyOperatorRecord | null {
  const normalized = normalizeRoleDisplayName(displayName).toLocaleLowerCase('en');
  const matches = operators.filter(
    (operator) =>
      normalizedDisplayName(operator.displayName)?.toLocaleLowerCase('en') === normalized,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function uniqueAccountByOperatorId(
  accounts: MigrationAccountRecord[],
  operatorId: string,
): MigrationAccountRecord | null {
  const matches = accounts.filter((account) => accountLegacyOperatorId(account) === operatorId);
  return matches.length === 1 ? matches[0]! : null;
}

type AuthorityOperators = {
  state: MigrationStateRecord;
  ryan: LegacyOperatorRecord;
  charles: LegacyOperatorRecord;
  administratorOperatorIds: string[];
  publisherOperatorId: string | null;
};

type AuthorityAccounts = {
  ryan: MigrationAccountRecord;
  charles: MigrationAccountRecord;
  publisher: MigrationAccountRecord | null;
  administrators: MigrationAccountRecord[];
  operatorById: Map<string, LegacyOperatorRecord>;
};

function primaryState(states: MigrationStateRecord[]): MigrationStateRecord | null {
  const primary = states.filter((state) => state.key === 'primary');
  return primary.length === 1 ? primary[0]! : null;
}

function resolveAuthorityOperators(
  operators: LegacyOperatorRecord[],
  states: MigrationStateRecord[],
): AuthorityOperators | { reason: string } {
  const state = primaryState(states);
  if (!state) return { reason: 'Relay could not resolve one privileged state record.' };
  const ryan = uniqueRecordByDisplayName(operators, RYAN_DISPLAY_NAME);
  if (!ryan) return { reason: 'Relay could not resolve one Ryan Bledsoe operator.' };
  const charles = uniqueRecordByDisplayName(operators, CHARLES_DISPLAY_NAME);
  if (!charles) return { reason: 'Relay could not resolve one Charles Gibbs operator.' };
  if (state.adminOperatorId !== ryan.id) {
    return { reason: 'The existing owner does not resolve to Ryan Bledsoe.' };
  }
  const administratorOperatorIds = asStringArray(state.adminOperatorIds);
  if (!administratorOperatorIds.includes(charles.id)) {
    return { reason: 'The existing administrators do not include Charles Gibbs.' };
  }
  const publisherOperatorId = nonEmptyString(state.publisherOperatorId)
    ? state.publisherOperatorId
    : null;
  if (publisherOperatorId === ryan.id || publisherOperatorId === charles.id) {
    return { reason: 'Ryan and Charles cannot occupy the Publisher slot.' };
  }
  return { state, ryan, charles, administratorOperatorIds, publisherOperatorId };
}

function fixedUsernameCollision(
  accounts: MigrationAccountRecord[],
  expectedUsername: 'ryan' | 'charles',
  target: MigrationAccountRecord,
): boolean {
  return accounts.some(
    (candidate) =>
      candidate.id !== target.id &&
      nonEmptyString(candidate.username) &&
      normalizeRoleUsername(candidate.username) === expectedUsername,
  );
}

function indexAccountsByOperator(
  accounts: MigrationAccountRecord[],
  operatorById: ReadonlyMap<string, LegacyOperatorRecord>,
): Map<string, MigrationAccountRecord> | { reason: string } {
  const indexed = new Map<string, MigrationAccountRecord>();
  for (const account of accounts) {
    const operatorId = accountLegacyOperatorId(account);
    if (!operatorId) return { reason: `Auth account ${account.id} has no legacy operator ID.` };
    if (indexed.has(operatorId)) {
      return { reason: `Multiple auth accounts reference operator ${operatorId}.` };
    }
    if (!operatorById.has(operatorId)) {
      return { reason: `Auth account ${account.id} references unknown operator ${operatorId}.` };
    }
    indexed.set(operatorId, account);
  }
  return indexed;
}

function resolveFixedAuthorityAccounts(
  accounts: MigrationAccountRecord[],
  authority: AuthorityOperators,
): { ryan: MigrationAccountRecord; charles: MigrationAccountRecord } | { reason: string } {
  const ryan = uniqueAccountByOperatorId(accounts, authority.ryan.id);
  const charles = uniqueAccountByOperatorId(accounts, authority.charles.id);
  if (!ryan || !charles) {
    return { reason: 'Ryan and Charles must each resolve to one existing auth account.' };
  }
  if (fixedUsernameCollision(accounts, 'ryan', ryan)) {
    return { reason: 'The ryan username is already assigned.' };
  }
  if (fixedUsernameCollision(accounts, 'charles', charles)) {
    return { reason: 'The charles username is already assigned.' };
  }
  if (storedRoleForAccount(ryan) !== 'administrator') {
    return { reason: 'Owner operator Ryan Bledsoe has a non-administrator role.' };
  }
  if (storedRoleForAccount(charles) !== 'administrator') {
    return { reason: 'Administrator operator Charles Gibbs has a non-administrator role.' };
  }
  return { ryan, charles };
}

function resolveAdministratorAccounts(
  indexed: ReadonlyMap<string, MigrationAccountRecord>,
  operatorIds: string[],
): { administrators: MigrationAccountRecord[] } | { reason: string } {
  const administrators: MigrationAccountRecord[] = [];
  for (const operatorId of operatorIds) {
    const account = indexed.get(operatorId);
    if (!account) return { reason: `Administrator operator ${operatorId} has no auth account.` };
    if (storedRoleForAccount(account) !== 'administrator') {
      return { reason: `Administrator operator ${operatorId} has a non-administrator role.` };
    }
    administrators.push(account);
  }
  return { administrators };
}

function resolveAuthorityAccounts(
  accounts: MigrationAccountRecord[],
  operators: LegacyOperatorRecord[],
  authority: AuthorityOperators,
): AuthorityAccounts | { reason: string } {
  const fixedAccounts = resolveFixedAuthorityAccounts(accounts, authority);
  if ('reason' in fixedAccounts) return fixedAccounts;

  const operatorById = new Map(operators.map((operator) => [operator.id, operator]));
  const indexed = indexAccountsByOperator(accounts, operatorById);
  if ('reason' in indexed) return indexed;
  const publisher = authority.publisherOperatorId
    ? indexed.get(authority.publisherOperatorId)
    : null;
  if (authority.publisherOperatorId && !publisher) {
    return { reason: `Publisher operator ${authority.publisherOperatorId} has no auth account.` };
  }

  const administratorResolution = resolveAdministratorAccounts(
    indexed,
    authority.administratorOperatorIds,
  );
  if ('reason' in administratorResolution) return administratorResolution;
  const { administrators } = administratorResolution;
  if (publisher && storedRoleForAccount(publisher) !== 'publisher') {
    return {
      reason: `Publisher operator ${authority.publisherOperatorId} has a non-publisher role.`,
    };
  }
  if (!administrators.some(({ id }) => id === fixedAccounts.ryan.id)) {
    administrators.unshift(fixedAccounts.ryan);
  }
  return {
    ...fixedAccounts,
    publisher: publisher ?? null,
    administrators,
    operatorById,
  };
}

function initialReservedUsernames(
  accounts: MigrationAccountRecord[],
  authority: Pick<AuthorityAccounts, 'ryan' | 'charles'>,
): Set<string> {
  const reserved = new Set<string>();
  for (const account of accounts) {
    if (nonEmptyString(account.username)) reserved.add(normalizeRoleUsername(account.username));
  }
  for (const account of [authority.ryan, authority.charles]) {
    if (nonEmptyString(account.username)) reserved.delete(normalizeRoleUsername(account.username));
  }
  reserved.add('ryan');
  reserved.add('charles');
  return reserved;
}

function usernameForAccount(
  account: MigrationAccountRecord,
  displayName: string,
  authority: Pick<AuthorityAccounts, 'ryan' | 'charles'>,
  reserved: Set<string>,
): string {
  if (account.id === authority.ryan.id) return 'ryan';
  if (account.id === authority.charles.id) return 'charles';
  const current = nonEmptyString(account.username) ? normalizeRoleUsername(account.username) : null;
  if (current && getRoleUsernameError(current) === null) {
    reserved.delete(current);
    return allocateUsername(current, reserved);
  }
  return allocateUsername(generatedUsername(displayName), reserved);
}

function planAccountUpdates(
  accounts: MigrationAccountRecord[],
  authority: AuthorityAccounts,
): { planned: PlannedAccount[] } | { reason: string } {
  const reserved = initialReservedUsernames(accounts, authority);
  const planned: PlannedAccount[] = [];
  for (const account of [...accounts].sort((left, right) => left.id.localeCompare(right.id))) {
    const operatorId = accountLegacyOperatorId(account)!;
    const operator = authority.operatorById.get(operatorId)!;
    const displayName = normalizedDisplayName(operator.displayName);
    if (!displayName) return { reason: `Operator ${operatorId} has an invalid display name.` };
    const storedRole = storedRoleForAccount(account);
    if (!storedRole) return { reason: `Auth account ${account.id} has an invalid role.` };
    planned.push({
      record: account,
      operatorId,
      displayName,
      username: usernameForAccount(account, displayName, authority, reserved),
      storedRole,
    });
  }
  const usernames = planned.map(({ username }) => username);
  if (new Set(usernames).size !== usernames.length) {
    return { reason: 'Planned account usernames are duplicated.' };
  }
  return { planned };
}

function appendHistoricalUpdates(
  spec: (typeof HISTORICAL_SNAPSHOT_FIELDS)[number],
  records: PocketBaseRecord[],
  nameByOperatorId: ReadonlyMap<string, string>,
  updatesByRecord: Map<string, PlannedUpdate>,
): { reason: string } | null {
  for (const record of records) {
    const operatorId = record[spec.operatorIdField];
    if (!nonEmptyString(operatorId) || nonEmptyString(record[spec.snapshotField])) continue;
    const displayName = nameByOperatorId.get(operatorId);
    if (!displayName) {
      return { reason: `Historical attribution references unknown operator ${operatorId}.` };
    }
    const key = `${spec.collection}:${record.id}`;
    const update = updatesByRecord.get(key) ?? {
      collection: spec.collection,
      recordId: record.id,
      data: {},
    };
    update.data[spec.snapshotField] = displayName;
    updatesByRecord.set(key, update);
  }
  return null;
}

export class RoleAccountMigration {
  private readonly pb: PocketBase;
  private readonly now: () => number;

  constructor(options: { pb: PocketBase; now?: () => number }) {
    this.pb = options.pb;
    this.now = options.now ?? Date.now;
  }

  async run(): Promise<RoleAccountMigrationResult> {
    const collections = await this.pb.collections.getFullList<CollectionInfo>();
    const collectionByName = new Map(
      collections.map((collection) => [collection.name, collection]),
    );
    const accounts = await this.listRecords<MigrationAccountRecord>(
      RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
    );
    const states = await this.listRecords<MigrationStateRecord>(RELAY_PRIVILEGED_STATE_COLLECTION);
    const state = this.primaryState(states);

    if (state && Number(state.identityMigrationVersion) >= ROLE_ACCOUNT_MIGRATION_VERSION) {
      return this.finishConvertedMigration(collectionByName, accounts, state);
    }

    const roster = collectionByName.get(LEGACY_ROSTER_COLLECTION);
    if (!roster) {
      return this.bootstrapFreshInstall(accounts, states);
    }

    const operators = await this.listRecords<LegacyOperatorRecord>(LEGACY_ROSTER_COLLECTION);
    const planned = await this.planExistingMigration(collectionByName, operators, accounts, states);
    if ('reason' in planned) return { status: 'deferred', reason: planned.reason };
    return this.commitExistingMigration(roster, planned);
  }

  private async finishConvertedMigration(
    collectionByName: ReadonlyMap<string, CollectionInfo>,
    accounts: MigrationAccountRecord[],
    state: MigrationStateRecord,
  ): Promise<RoleAccountMigrationResult> {
    const partitioned = partitionExistingAccounts(accounts);
    if ('reason' in partitioned) return { status: 'deferred', reason: partitioned.reason };
    const converted = this.validateConvertedState(partitioned.protectedAccounts, state);
    if ('reason' in converted) return { status: 'deferred', reason: converted.reason };
    const roster = collectionByName.get(LEGACY_ROSTER_COLLECTION);
    const loginRosterView = validatedLegacyLoginRosterView(collectionByName);
    if (loginRosterView && 'reason' in loginRosterView) {
      return { status: 'deferred', reason: loginRosterView.reason };
    }
    if (!roster) {
      return partitioned.retiredAccounts.length === 0 && loginRosterView === null
        ? { status: 'already-complete' }
        : {
            status: 'deferred',
            reason: 'Converted state retains legacy identity data without its operator roster.',
          };
    }
    const retirementBlock = await this.retirementBlockReason(
      collectionByName,
      partitioned.retiredAccounts,
    );
    if (retirementBlock) return { status: 'deferred', reason: retirementBlock };
    const operators = await this.listRecords<LegacyOperatorRecord>(LEGACY_ROSTER_COLLECTION);
    const historical = await this.planHistoricalUpdates(collectionByName, operators);
    if ('reason' in historical) return { status: 'deferred', reason: historical.reason };
    if (historical.updates.length > 0) {
      return {
        status: 'deferred',
        reason: 'Converted state still has incomplete historical display-name snapshots.',
      };
    }
    await this.retireAccounts(partitioned.retiredAccounts);
    const finalAccounts = await this.listRecords<MigrationAccountRecord>(
      RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
    );
    const finalConverted = this.validateConvertedState(finalAccounts, state);
    if ('reason' in finalConverted) {
      throw new Error(`Role account migration validation failed: ${finalConverted.reason}`);
    }
    await this.retireLegacyCollections(loginRosterView, roster);
    return {
      status: 'migrated',
      ownerAccountId: finalConverted.ownerAccountId,
      administratorAccountIds: finalConverted.administratorAccountIds,
    };
  }

  private async commitExistingMigration(
    roster: CollectionInfo,
    planned: ExistingMigrationPlan,
  ): Promise<RoleAccountMigrationResult> {
    for (const account of planned.accounts) {
      await this.pb.collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION).update(account.record.id, {
        username: account.username,
        displayName: account.displayName,
        storedRole: account.storedRole,
        legacyOperatorId: account.operatorId,
        revision: nonNegativeInteger(account.record.revision) ? account.record.revision : 0,
      });
    }
    for (const update of planned.historicalUpdates) {
      await this.pb.collection(update.collection).update(update.recordId, update.data);
    }
    await this.pb.collection(RELAY_PRIVILEGED_STATE_COLLECTION).update(planned.state.id, {
      ownerAccountId: planned.ownerAccountId,
      publisherAccountId: planned.publisherAccountId ?? '',
      identityMigrationVersion: ROLE_ACCOUNT_MIGRATION_VERSION,
      assignmentVersion:
        (nonNegativeInteger(planned.state.assignmentVersion)
          ? planned.state.assignmentVersion
          : 0) + 1,
      updatedByAccountId: '',
      updatedAt: new Date(this.now()).toISOString(),
    });

    const committedAccounts = await this.listRecords<MigrationAccountRecord>(
      RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
    );
    const committedState = this.primaryState(
      await this.listRecords<MigrationStateRecord>(RELAY_PRIVILEGED_STATE_COLLECTION),
    );
    if (!committedState)
      throw new Error('Role account migration could not re-read singleton state.');
    const retainedAccounts = committedAccounts.filter(
      ({ id }) => !planned.retiredAccountIds.includes(id),
    );
    const converted = this.validateConvertedState(retainedAccounts, committedState);
    if ('reason' in converted) {
      throw new Error(`Role account migration validation failed: ${converted.reason}`);
    }
    await this.verifyHistoricalUpdates(planned.historicalUpdates);
    await this.retireAccounts(
      committedAccounts.filter(({ id }) => planned.retiredAccountIds.includes(id)),
    );
    const finalAccounts = await this.listRecords<MigrationAccountRecord>(
      RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
    );
    const finalConverted = this.validateConvertedState(finalAccounts, committedState);
    if ('reason' in finalConverted) {
      throw new Error(`Role account migration validation failed: ${finalConverted.reason}`);
    }
    await this.retireLegacyCollections(planned.loginRosterView, roster);
    return {
      status: 'migrated',
      ownerAccountId: finalConverted.ownerAccountId,
      administratorAccountIds: finalConverted.administratorAccountIds,
    };
  }

  private async planExistingMigration(
    collectionByName: ReadonlyMap<string, CollectionInfo>,
    operators: LegacyOperatorRecord[],
    accounts: MigrationAccountRecord[],
    states: MigrationStateRecord[],
  ): Promise<ExistingMigrationPlan | { reason: string }> {
    const loginRosterView = validatedLegacyLoginRosterView(collectionByName);
    if (loginRosterView && 'reason' in loginRosterView) return loginRosterView;
    const authorityOperators = resolveAuthorityOperators(operators, states);
    if ('reason' in authorityOperators) return authorityOperators;
    const authorityAccounts = resolveAuthorityAccounts(accounts, operators, authorityOperators);
    if ('reason' in authorityAccounts) return authorityAccounts;
    const partitioned = partitionExistingAccounts(accounts);
    if ('reason' in partitioned) return partitioned;
    const retirementBlock = await this.retirementBlockReason(
      collectionByName,
      partitioned.retiredAccounts,
    );
    if (retirementBlock) return { reason: retirementBlock };
    const plannedAccounts = planAccountUpdates(partitioned.protectedAccounts, authorityAccounts);
    if ('reason' in plannedAccounts) return plannedAccounts;
    const historical = await this.planHistoricalUpdates(collectionByName, operators);
    if ('reason' in historical) return historical;

    return {
      state: authorityOperators.state,
      ownerAccountId: authorityAccounts.ryan.id,
      publisherAccountId: authorityAccounts.publisher?.id ?? null,
      administratorAccountIds: authorityAccounts.administrators.map(({ id }) => id),
      accounts: plannedAccounts.planned,
      retiredAccountIds: partitioned.retiredAccounts.map(({ id }) => id),
      historicalUpdates: historical.updates,
      loginRosterView,
    };
  }

  private async retireLegacyCollections(
    loginRosterView: CollectionInfo | null,
    roster: CollectionInfo,
  ): Promise<void> {
    if (loginRosterView) await this.pb.collections.delete(loginRosterView.id);
    await this.pb.collections.delete(roster.id);
  }

  private async retirementBlockReason(
    collectionByName: ReadonlyMap<string, CollectionInfo>,
    retiredAccounts: MigrationAccountRecord[],
  ): Promise<string | null> {
    if (retiredAccounts.length === 0 || !collectionByName.has('relay_privileged_devices')) {
      return null;
    }
    const retiredIds = new Set(retiredAccounts.map(({ id }) => id));
    const devices = await this.listRecords<MigrationDeviceRecord>('relay_privileged_devices');
    const boundDevice = devices.find(
      ({ accountId }) => nonEmptyString(accountId) && retiredIds.has(accountId),
    );
    return boundDevice
      ? `Legacy ordinary account ${String(boundDevice.accountId)} still owns a paired device.`
      : null;
  }

  private async retireAccounts(accounts: MigrationAccountRecord[]): Promise<void> {
    for (const account of accounts) {
      await this.pb.collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION).delete(account.id);
    }
  }

  private async verifyHistoricalUpdates(updates: PlannedUpdate[]): Promise<void> {
    const recordsByCollection = new Map<string, ReadonlyMap<string, PocketBaseRecord>>();
    for (const update of updates) {
      if (!recordsByCollection.has(update.collection)) {
        const records = await this.listRecords<PocketBaseRecord>(update.collection);
        recordsByCollection.set(
          update.collection,
          new Map(records.map((record) => [record.id, record])),
        );
      }
      const record = recordsByCollection.get(update.collection)?.get(update.recordId);
      const persisted =
        record !== undefined &&
        Object.entries(update.data).every(([field, value]) => record[field] === value);
      if (!persisted) {
        throw new Error(
          `Role account migration validation failed: historical snapshot ${update.collection}/${update.recordId} was not persisted.`,
        );
      }
    }
  }

  private async planHistoricalUpdates(
    collectionByName: ReadonlyMap<string, CollectionInfo>,
    operators: LegacyOperatorRecord[],
  ): Promise<{ updates: PlannedUpdate[] } | { reason: string }> {
    const nameByOperatorId = new Map<string, string>();
    for (const operator of operators) {
      const displayName = normalizedDisplayName(operator.displayName);
      if (displayName) nameByOperatorId.set(operator.id, displayName);
    }

    const updatesByRecord = new Map<string, PlannedUpdate>();
    const recordsByCollection = new Map<string, PocketBaseRecord[]>();
    for (const spec of HISTORICAL_SNAPSHOT_FIELDS) {
      if (!collectionByName.has(spec.collection)) continue;
      if (!recordsByCollection.has(spec.collection)) {
        recordsByCollection.set(
          spec.collection,
          await this.listRecords<PocketBaseRecord>(spec.collection),
        );
      }
      const failure = appendHistoricalUpdates(
        spec,
        recordsByCollection.get(spec.collection)!,
        nameByOperatorId,
        updatesByRecord,
      );
      if (failure) return failure;
    }
    return { updates: [...updatesByRecord.values()] };
  }

  private async bootstrapFreshInstall(
    accounts: MigrationAccountRecord[],
    states: MigrationStateRecord[],
  ): Promise<RoleAccountMigrationResult> {
    if (states.length > 0) {
      return { status: 'deferred', reason: 'Legacy privileged state exists without its roster.' };
    }
    const allowedUsernames = new Set(['ryan', 'charles']);
    const usernames = accounts.map((account) =>
      nonEmptyString(account.username) ? normalizeRoleUsername(account.username) : '',
    );
    if (
      usernames.some((username) => !allowedUsernames.has(username)) ||
      new Set(usernames).size !== usernames.length
    ) {
      return { status: 'deferred', reason: 'Unexpected auth accounts exist without a roster.' };
    }
    for (const account of accounts) {
      const username = normalizeRoleUsername(account.username as string);
      const expectedDisplayName = username === 'ryan' ? RYAN_DISPLAY_NAME : CHARLES_DISPLAY_NAME;
      if (
        account.displayName !== expectedDisplayName ||
        account.storedRole !== 'administrator' ||
        account.active !== false ||
        account.mustChangePassword !== true ||
        !nonNegativeInteger(account.credentialVersion) ||
        !nonNegativeInteger(account.revision)
      ) {
        return { status: 'deferred', reason: `Fresh account ${account.id} is incomplete.` };
      }
    }

    const ryan = await this.ensureFreshAccount(accounts, 'ryan', RYAN_DISPLAY_NAME);
    const charles = await this.ensureFreshAccount(accounts, 'charles', CHARLES_DISPLAY_NAME);
    await this.pb.collection(RELAY_PRIVILEGED_STATE_COLLECTION).create({
      key: 'primary',
      ownerAccountId: ryan.id,
      publisherAccountId: '',
      assignmentVersion: 1,
      identityMigrationVersion: ROLE_ACCOUNT_MIGRATION_VERSION,
      updatedByAccountId: '',
    });
    return {
      status: 'migrated',
      ownerAccountId: ryan.id,
      administratorAccountIds: [ryan.id, charles.id],
    };
  }

  private async ensureFreshAccount(
    accounts: MigrationAccountRecord[],
    username: 'ryan' | 'charles',
    displayName: string,
  ): Promise<MigrationAccountRecord> {
    const existing = accounts.find(
      (account) =>
        nonEmptyString(account.username) && normalizeRoleUsername(account.username) === username,
    );
    if (existing) return existing;
    const password = randomBytes(48).toString('base64url');
    return this.pb.collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION).create<MigrationAccountRecord>({
      email: `${username}@relay.invalid`,
      username,
      displayName,
      storedRole: 'administrator',
      active: false,
      mustChangePassword: true,
      credentialVersion: 0,
      revision: 0,
      password,
      passwordConfirm: password,
    });
  }

  private validateConvertedState(
    accounts: MigrationAccountRecord[],
    state: MigrationStateRecord,
  ): { ownerAccountId: string; administratorAccountIds: string[] } | { reason: string } {
    if (!nonEmptyString(state.ownerAccountId)) {
      return { reason: 'Converted state has no owner account.' };
    }
    const owner = accounts.find(({ id }) => id === state.ownerAccountId);
    if (
      !owner ||
      owner.username !== 'ryan' ||
      owner.displayName !== RYAN_DISPLAY_NAME ||
      owner.storedRole !== 'administrator'
    ) {
      return { reason: 'Converted owner is not the Ryan role account.' };
    }
    const charles = accounts.find(
      (account) => account.username === 'charles' && account.displayName === CHARLES_DISPLAY_NAME,
    );
    if (!charles || charles.storedRole !== 'administrator') {
      return { reason: 'Converted accounts do not contain Charles as an Administrator.' };
    }
    const usernames = accounts.map((account) =>
      nonEmptyString(account.username) ? normalizeRoleUsername(account.username) : '',
    );
    if (
      usernames.some((username) => !username || getRoleUsernameError(username) !== null) ||
      new Set(usernames).size !== usernames.length
    ) {
      return { reason: 'Converted account usernames are invalid or duplicated.' };
    }
    for (const account of accounts) {
      if (!normalizedDisplayName(account.displayName) || !storedRoleForAccount(account)) {
        return { reason: `Converted account ${account.id} is incomplete.` };
      }
    }
    if (nonEmptyString(state.publisherAccountId)) {
      const publisher = accounts.find(({ id }) => id === state.publisherAccountId);
      if (!publisher || publisher.storedRole !== 'publisher') {
        return { reason: 'Converted Publisher pointer is invalid.' };
      }
    }
    const administrators = accounts.filter((account) => account.storedRole === 'administrator');
    return {
      ownerAccountId: owner.id,
      administratorAccountIds: [
        owner.id,
        ...administrators.map(({ id }) => id).filter((id) => id !== owner.id),
      ],
    };
  }

  private primaryState(states: MigrationStateRecord[]): MigrationStateRecord | null {
    const primary = states.filter((state) => state.key === 'primary');
    return primary.length === 1 ? primary[0]! : null;
  }

  private async listRecords<T extends PocketBaseRecord>(collection: string): Promise<T[]> {
    return this.pb.collection(collection).getFullList<T>({ requestKey: null });
  }
}
