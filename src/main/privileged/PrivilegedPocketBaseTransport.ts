import { createHash, randomUUID } from 'node:crypto';
import { EventSource as MainProcessEventSource } from 'eventsource';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_COMMANDS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  RELAY_PRIVILEGED_PAIRING_CHALLENGES_COLLECTION,
  RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type PrivilegedRole,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { RELAY_OPERATORS_COLLECTION, type RelayOperatorRecord } from '@shared/operators';
import {
  canonicalizePrivilegedValue,
  type PrivilegedCommandError,
  type PrivilegedCommandResult,
  type SignedPrivilegedCommandEnvelope,
} from '@shared/privilegedCommands';
import type {
  PairingChallengePatch,
  PairingChallengeRecord,
  PairingCompletion,
  PairingCompletionInput,
  PairingDeviceActivation,
  PrivilegedPairingRepository,
  PrivilegedPairingService,
} from './PrivilegedPairingService';
import type {
  PrivilegedCommandClaim,
  PrivilegedCommandClaimResult,
  PrivilegedCommandCompletion,
  PrivilegedCommandProcessor,
  PrivilegedCommandRepository,
  StoredPrivilegedCommand,
} from './PrivilegedCommandProcessor';
import type { PrivilegedClientTransport } from './privilegedRuntime';

type UnknownRecord = Record<string, unknown> & { id: string };

export interface PrivilegedRecordClient {
  createRecord(collection: string, data: Record<string, unknown>): Promise<UnknownRecord>;
  getRecord(collection: string, id: string): Promise<UnknownRecord>;
}

type PocketBaseCollectionPort = {
  create<T = UnknownRecord>(data: Record<string, unknown>, options?: unknown): Promise<T>;
  update<T = UnknownRecord>(
    id: string,
    data: Record<string, unknown>,
    options?: unknown,
  ): Promise<T>;
  getOne<T = UnknownRecord>(id: string, options?: unknown): Promise<T>;
  getFirstListItem<T = UnknownRecord>(filter: string, options?: unknown): Promise<T>;
  getFullList<T = UnknownRecord>(options?: unknown): Promise<T[]>;
  subscribe?<T = UnknownRecord>(
    topic: string,
    callback: (event: { action: string; record: T }) => void,
  ): Promise<unknown>;
  unsubscribe?(topic?: string): Promise<void>;
};

export interface PrivilegedServerPocketBase {
  collection(name: string): PocketBaseCollectionPort;
}

type ClientTransportOptions = {
  client: PrivilegedRecordClient;
  createId?: () => string;
  wait?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
};

const COMMAND_ERRORS = new Set<PrivilegedCommandError>([
  'unauthorized',
  'locked',
  'offline',
  'pairing-required',
  'invalid-request',
  'expired',
  'replayed',
  'conflict',
  'server-error',
]);

function installMainProcessEventSource(): void {
  if (typeof globalThis.EventSource === 'undefined') {
    globalThis.EventSource = MainProcessEventSource as unknown as typeof globalThis.EventSource;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function restoreCanonicalTimestamp(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function waitDefault(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function safeCommandError(value: unknown): PrivilegedCommandError {
  return typeof value === 'string' && COMMAND_ERRORS.has(value as PrivilegedCommandError)
    ? (value as PrivilegedCommandError)
    : 'server-error';
}

function completedCommandResult(record: Record<string, unknown>): PrivilegedCommandResult | null {
  if (!boundedString(record.requestId, 128)) return null;
  if (record.state === 'succeeded') {
    return { ok: true, requestId: record.requestId, value: record.result ?? null };
  }
  if (record.state === 'failed') {
    return {
      ok: false,
      requestId: record.requestId,
      error: safeCommandError(record.safeError),
    };
  }
  return null;
}

function pairingResult(record: Record<string, unknown>): PairingCompletion | null {
  if (record.state !== 'completed' || !isRecord(record.result)) return null;
  const { deviceId, fingerprint, pairedAt } = record.result;
  if (
    !boundedString(deviceId, 200) ||
    typeof fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(fingerprint) ||
    !boundedString(pairedAt, 100)
  ) {
    return null;
  }
  return { deviceId, fingerprint, pairedAt };
}

export class PrivilegedTransportError extends Error {
  constructor(readonly code: 'offline' | 'unauthorized' | 'server-error') {
    super('Privileged server request could not be completed.');
    this.name = 'PrivilegedTransportError';
  }
}

export class PrivilegedPocketBaseClientTransport implements PrivilegedClientTransport {
  private readonly client: PrivilegedRecordClient;
  private readonly createId: () => string;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly maxAttempts: number;
  private disposed = false;

  constructor(options: ClientTransportOptions) {
    this.client = options.client;
    this.createId = options.createId ?? randomUUID;
    this.wait = options.wait ?? waitDefault;
    this.maxAttempts = options.maxAttempts ?? 30;
  }

  async submitCommand(
    envelope: SignedPrivilegedCommandEnvelope,
    operatorId: string,
    bodyHash: string,
  ): Promise<PrivilegedCommandResult> {
    if (this.disposed) return { ok: false, error: 'offline' };
    try {
      const created = await this.client.createRecord(RELAY_PRIVILEGED_COMMANDS_COLLECTION, {
        requestId: envelope.requestId,
        accountId: envelope.accountId,
        deviceId: envelope.deviceId,
        operatorId,
        roleClaim: envelope.roleClaim,
        command: envelope.command,
        issuedAt: envelope.issuedAt,
        expiresAt: envelope.expiresAt,
        expectedRevision: envelope.expectedRevision ?? 0,
        hasExpectedRevision: envelope.expectedRevision !== null,
        payload: envelope.payload,
        bodyHash,
        signature: envelope.signature,
        state: 'pending',
      });
      return await this.waitForCommand(created.id, envelope.requestId);
    } catch {
      return { ok: false, requestId: envelope.requestId, error: 'offline' };
    }
  }

  async completePairing(
    input: PairingCompletionInput & { operatorId: string },
  ): Promise<PairingCompletion> {
    if (this.disposed) throw new PrivilegedTransportError('offline');
    try {
      const created = await this.client.createRecord(RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION, {
        requestId: this.createId(),
        accountId: input.accountId,
        operatorId: input.operatorId,
        challengeId: input.challengeId,
        code: input.code,
        publicKey: input.publicJwk,
        fingerprint: input.fingerprint,
        hostname: input.hostname,
        deviceLabel: input.deviceLabel,
        state: 'pending',
      });
      return await this.waitForPairing(created.id);
    } catch (error) {
      if (error instanceof PrivilegedTransportError) throw error;
      throw new PrivilegedTransportError('offline');
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  private async waitForCommand(
    recordId: string,
    requestId: string,
  ): Promise<PrivilegedCommandResult> {
    for (let attempt = 0; attempt < this.maxAttempts && !this.disposed; attempt += 1) {
      const record = await this.client.getRecord(RELAY_PRIVILEGED_COMMANDS_COLLECTION, recordId);
      const completed = completedCommandResult(record);
      if (completed) return completed;
      await this.wait(Math.min(1_000, 150 * 1.45 ** attempt));
    }
    return { ok: false, requestId, error: 'offline' };
  }

  private async waitForPairing(recordId: string): Promise<PairingCompletion> {
    for (let attempt = 0; attempt < this.maxAttempts && !this.disposed; attempt += 1) {
      const record = await this.client.getRecord(
        RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION,
        recordId,
      );
      const completed = pairingResult(record);
      if (completed) return completed;
      if (record.state === 'failed') throw new PrivilegedTransportError('unauthorized');
      await this.wait(Math.min(1_000, 150 * 1.45 ** attempt));
    }
    throw new PrivilegedTransportError('offline');
  }
}

function escapeFilter(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function normalizeAccount(value: unknown): RelayPrivilegedAccountRecord | null {
  if (!isRecord(value)) return null;
  const { id, operatorId, role, active, mustChangePassword, credentialVersion, created, updated } =
    value;
  if (
    !boundedString(id, 200) ||
    !boundedString(operatorId, 200) ||
    (role !== 'admin' && role !== 'publisher') ||
    typeof active !== 'boolean' ||
    typeof mustChangePassword !== 'boolean' ||
    !Number.isSafeInteger(credentialVersion) ||
    (created !== undefined && (typeof created !== 'string' || created.length > 100)) ||
    (updated !== undefined && (typeof updated !== 'string' || updated.length > 100))
  ) {
    return null;
  }
  return {
    id,
    operatorId,
    role,
    active,
    mustChangePassword,
    credentialVersion: credentialVersion as number,
    created: typeof created === 'string' ? created : '',
    updated: typeof updated === 'string' ? updated : '',
  };
}

function normalizeOperator(value: unknown): RelayOperatorRecord | null {
  if (!isRecord(value)) return null;
  const { id, displayName, active, created, updated } = value;
  if (
    !boundedString(id, 200) ||
    !boundedString(displayName, 120) ||
    typeof active !== 'boolean' ||
    !boundedString(created, 100) ||
    !boundedString(updated, 100)
  ) {
    return null;
  }
  return { id, displayName, active, created, updated };
}

function normalizeState(value: unknown): RelayPrivilegedStateRecord | null {
  if (!isRecord(value)) return null;
  const {
    id,
    key,
    adminOperatorId,
    publisherOperatorId,
    assignmentVersion,
    rosterMigrationVersion,
    updatedByOperatorId,
    updatedAt,
    created,
    updated,
  } = value;
  if (
    !boundedString(id, 200) ||
    key !== 'primary' ||
    !boundedString(adminOperatorId, 200) ||
    (publisherOperatorId !== null &&
      publisherOperatorId !== '' &&
      !boundedString(publisherOperatorId, 200)) ||
    !Number.isSafeInteger(assignmentVersion) ||
    !Number.isSafeInteger(rosterMigrationVersion) ||
    (updatedByOperatorId !== null &&
      updatedByOperatorId !== '' &&
      !boundedString(updatedByOperatorId, 200)) ||
    !boundedString(updatedAt, 100) ||
    !boundedString(created, 100) ||
    !boundedString(updated, 100)
  ) {
    return null;
  }
  return {
    id,
    key: 'primary',
    adminOperatorId,
    publisherOperatorId: publisherOperatorId || null,
    assignmentVersion: assignmentVersion as number,
    rosterMigrationVersion: rosterMigrationVersion as number,
    updatedByOperatorId: updatedByOperatorId || null,
    updatedAt,
    created,
    updated,
  };
}

function normalizeDevice(value: unknown): RelayPrivilegedDeviceRecord | null {
  if (!isRecord(value)) return null;
  const required = [
    'id',
    'accountId',
    'deviceId',
    'hostnameSnapshot',
    'label',
    'publicKey',
    'fingerprint',
    'pairedAt',
    'created',
    'updated',
  ] as const;
  if (required.some((key) => !boundedString(value[key], key === 'publicKey' ? 4_096 : 255)))
    return null;
  if (
    (value.state !== 'active' && value.state !== 'revoked') ||
    !Number.isSafeInteger(value.revision)
  )
    return null;
  return value as RelayPrivilegedDeviceRecord;
}

function normalizeStoredCommand(value: unknown): StoredPrivilegedCommand | null {
  if (!isRecord(value)) return null;
  const expectedRevision = value.hasExpectedRevision === true ? value.expectedRevision : null;
  if (
    !boundedString(value.id, 200) ||
    !boundedString(value.requestId, 128) ||
    !boundedString(value.accountId, 200) ||
    (value.deviceId !== null && value.deviceId !== '' && !boundedString(value.deviceId, 200)) ||
    !boundedString(value.operatorId, 200) ||
    (value.roleClaim !== 'admin' && value.roleClaim !== 'publisher') ||
    (value.command !== 'privileged.status.read' && value.command !== 'privileged.reauth.confirm') ||
    !isRecord(value.payload) ||
    !boundedString(value.bodyHash, 64) ||
    !boundedString(value.issuedAt, 100) ||
    !boundedString(value.expiresAt, 100) ||
    !boundedString(value.updated, 100) ||
    (expectedRevision !== null && !Number.isSafeInteger(expectedRevision)) ||
    !['pending', 'processing', 'succeeded', 'failed'].includes(String(value.state))
  )
    return null;
  return {
    id: value.id,
    requestId: value.requestId,
    accountId: value.accountId,
    deviceId: value.deviceId || null,
    operatorId: value.operatorId,
    roleClaim: value.roleClaim as PrivilegedRole,
    command: value.command,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    expectedRevision: expectedRevision as number | null,
    payload: value.payload as StoredPrivilegedCommand['payload'],
    bodyHash: value.bodyHash,
    signature: typeof value.signature === 'string' && value.signature ? value.signature : null,
    state: value.state as StoredPrivilegedCommand['state'],
    result: value.result ?? null,
    safeError: value.safeError ? safeCommandError(value.safeError) : null,
    completedAt:
      typeof value.completedAt === 'string' && value.completedAt ? value.completedAt : null,
    updated: value.updated,
  };
}

export class PocketBasePrivilegedRepository
  implements PrivilegedCommandRepository, PrivilegedPairingRepository
{
  private readonly proofConsumptionLocks = new Map<string, Promise<void>>();

  constructor(private readonly pb: PrivilegedServerPocketBase) {}

  async getAccount(accountId: string) {
    try {
      return normalizeAccount(
        await this.pb
          .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
          .getOne(accountId, { requestKey: null }),
      );
    } catch {
      return null;
    }
  }

  async getOperator(operatorId: string) {
    try {
      return normalizeOperator(
        await this.pb
          .collection(RELAY_OPERATORS_COLLECTION)
          .getOne(operatorId, { requestKey: null }),
      );
    } catch {
      return null;
    }
  }

  async getState() {
    try {
      return normalizeState(
        await this.pb
          .collection(RELAY_PRIVILEGED_STATE_COLLECTION)
          .getFirstListItem('key="primary"', { requestKey: null }),
      );
    } catch {
      return null;
    }
  }

  async getDevice(accountId: string, deviceId: string) {
    try {
      return normalizeDevice(
        await this.pb
          .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
          .getFirstListItem(
            `accountId="${escapeFilter(accountId)}" && deviceId="${escapeFilter(deviceId)}"`,
            { requestKey: null },
          ),
      );
    } catch {
      return null;
    }
  }

  async claimCommand(claim: PrivilegedCommandClaim): Promise<PrivilegedCommandClaimResult> {
    const collection = this.pb.collection(RELAY_PRIVILEGED_COMMANDS_COLLECTION);
    try {
      const existing = normalizeStoredCommand(
        await collection.getFirstListItem(`requestId="${escapeFilter(claim.requestId)}"`, {
          requestKey: null,
        }),
      );
      if (existing) return { kind: 'existing', command: existing };
    } catch {
      /* Create below when no record exists. */
    }
    const created = normalizeStoredCommand(
      await collection.create(
        {
          ...claim,
          deviceId: claim.deviceId ?? '',
          expectedRevision: claim.expectedRevision ?? 0,
          hasExpectedRevision: claim.expectedRevision !== null,
          signature: claim.signature ?? '',
        },
        { requestKey: null },
      ),
    );
    if (!created) throw new TypeError('Invalid privileged command record.');
    return { kind: 'created', command: created };
  }

  async tryBeginCommand(
    commandId: string,
    bodyHash: string,
    staleBefore: string | null,
  ): Promise<boolean> {
    try {
      const collection = this.pb.collection(RELAY_PRIVILEGED_COMMANDS_COLLECTION);
      const current = normalizeStoredCommand(
        await collection.getOne(commandId, { requestKey: null }),
      );
      if (!current || current.bodyHash !== bodyHash) return false;
      if (current.state === 'processing' && (!staleBefore || current.updated > staleBefore))
        return false;
      await collection.update(commandId, { state: 'processing' }, { requestKey: null });
      return true;
    } catch {
      return false;
    }
  }

  async completeCommand(requestId: string, completion: PrivilegedCommandCompletion): Promise<void> {
    const collection = this.pb.collection(RELAY_PRIVILEGED_COMMANDS_COLLECTION);
    const record = await collection.getFirstListItem<UnknownRecord>(
      `requestId="${escapeFilter(requestId)}"`,
      { requestKey: null },
    );
    await collection.update(record.id, completion as unknown as Record<string, unknown>, {
      requestKey: null,
    });
  }

  async getCommand(requestId: string): Promise<StoredPrivilegedCommand | null> {
    try {
      return normalizeStoredCommand(
        await this.pb
          .collection(RELAY_PRIVILEGED_COMMANDS_COLLECTION)
          .getFirstListItem(`requestId="${escapeFilter(requestId)}"`, { requestKey: null }),
      );
    } catch {
      return null;
    }
  }

  async consumeReauthenticationProof(requestId: string, consumedAt: string): Promise<boolean> {
    const previous = this.proofConsumptionLocks.get(requestId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(() => gate);
    this.proofConsumptionLocks.set(requestId, current);
    await previous.catch(() => undefined);
    try {
      const collection = this.pb.collection(RELAY_PRIVILEGED_COMMANDS_COLLECTION);
      const record = await collection.getFirstListItem<UnknownRecord>(
        `requestId="${escapeFilter(requestId)}"`,
        { requestKey: null },
      );
      if (record.proofConsumedAt) return false;
      await collection.update(record.id, { proofConsumedAt: consumedAt }, { requestKey: null });
      return true;
    } catch {
      return false;
    } finally {
      release();
      if (this.proofConsumptionLocks.get(requestId) === current) {
        this.proofConsumptionLocks.delete(requestId);
      }
    }
  }

  async saveChallenge(challenge: PairingChallengeRecord): Promise<void> {
    await this.pb
      .collection(RELAY_PRIVILEGED_PAIRING_CHALLENGES_COLLECTION)
      .create(challenge as unknown as Record<string, unknown>, { requestKey: null });
  }

  async updateChallenge(challengeId: string, patch: PairingChallengePatch): Promise<void> {
    const collection = this.pb.collection(RELAY_PRIVILEGED_PAIRING_CHALLENGES_COLLECTION);
    const record = await collection.getFirstListItem<UnknownRecord>(
      `challengeId="${escapeFilter(challengeId)}"`,
      { requestKey: null },
    );
    await collection.update(record.id, patch as Record<string, unknown>, { requestKey: null });
  }

  async findDeviceByFingerprint(fingerprint: string): Promise<{ deviceId: string } | null> {
    try {
      const record = await this.pb
        .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
        .getFirstListItem<UnknownRecord>(`fingerprint="${escapeFilter(fingerprint)}"`, {
          requestKey: null,
        });
      return boundedString(record.deviceId, 200) ? { deviceId: record.deviceId } : null;
    } catch {
      return null;
    }
  }

  async activateDevice(activation: PairingDeviceActivation): Promise<PairingCompletion> {
    await this.pb.collection(RELAY_PRIVILEGED_DEVICES_COLLECTION).create(
      {
        accountId: activation.accountId,
        deviceId: activation.deviceId,
        hostnameSnapshot: activation.hostnameSnapshot,
        label: activation.label,
        publicKey: activation.publicKey,
        fingerprint: activation.fingerprint,
        state: activation.state,
        pairedAt: activation.pairedAt,
        lastUsedAt: '',
        revokedAt: '',
        revokedByOperatorId: '',
        revision: activation.revision,
      },
      { requestKey: null },
    );
    return {
      deviceId: activation.deviceId,
      fingerprint: activation.fingerprint,
      pairedAt: activation.pairedAt,
    };
  }
}

type ServerQueueOptions = {
  pb: PrivilegedServerPocketBase;
  commandProcessor: Pick<PrivilegedCommandProcessor, 'process'>;
  pairingService: Pick<PrivilegedPairingService, 'completePairing'>;
  recoveryIntervalMs?: number;
};

export class PrivilegedServerQueue {
  private readonly pb: PrivilegedServerPocketBase;
  private readonly commandProcessor: ServerQueueOptions['commandProcessor'];
  private readonly pairingService: ServerQueueOptions['pairingService'];
  private readonly recoveryIntervalMs: number;
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;
  private draining: Promise<void> | null = null;
  private disposed = false;

  constructor(options: ServerQueueOptions) {
    this.pb = options.pb;
    this.commandProcessor = options.commandProcessor;
    this.pairingService = options.pairingService;
    this.recoveryIntervalMs = options.recoveryIntervalMs ?? 5_000;
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    installMainProcessEventSource();
    await Promise.all([
      this.subscribe(RELAY_PRIVILEGED_COMMANDS_COLLECTION),
      this.subscribe(RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION),
    ]);
    await this.drain();
    this.recoveryTimer = setInterval(() => void this.drain(), this.recoveryIntervalMs);
    this.recoveryTimer.unref?.();
  }

  drain(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.draining ??= this.doDrain().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
    await Promise.all([
      this.pb.collection(RELAY_PRIVILEGED_COMMANDS_COLLECTION).unsubscribe?.('*'),
      this.pb.collection(RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION).unsubscribe?.('*'),
    ]);
    await this.draining;
  }

  private async subscribe(collectionName: string): Promise<void> {
    const collection = this.pb.collection(collectionName);
    await collection.subscribe?.('*', (event) => {
      if (event.action === 'create') void this.drain();
    });
  }

  private async doDrain(): Promise<void> {
    if (this.disposed) return;
    const [commands, pairings] = await Promise.all([
      this.pb
        .collection(RELAY_PRIVILEGED_COMMANDS_COLLECTION)
        .getFullList<UnknownRecord>({ filter: 'state="pending"', requestKey: null }),
      this.pb
        .collection(RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION)
        .getFullList<UnknownRecord>({ filter: 'state="pending"', requestKey: null }),
    ]);
    await Promise.all([
      ...commands.map((record) => this.processCommand(record)),
      ...pairings.map((record) => this.processPairing(record)),
    ]);
  }

  private async processCommand(record: UnknownRecord): Promise<void> {
    try {
      if (!isRecord(record.payload)) throw new TypeError('Invalid command payload.');
      const expectedRevision =
        record.hasExpectedRevision === true && Number.isSafeInteger(record.expectedRevision)
          ? (record.expectedRevision as number)
          : null;
      const envelope = {
        version: 1,
        requestId: record.requestId,
        accountId: record.accountId,
        deviceId: record.deviceId,
        roleClaim: record.roleClaim,
        command: record.command,
        payload: record.payload,
        payloadHash: createHash('sha256')
          .update(canonicalizePrivilegedValue(record.payload))
          .digest('hex'),
        expectedRevision,
        // PocketBase serializes date fields with a space separator. Restore the
        // exact canonical ISO representation that the client originally signed.
        issuedAt: restoreCanonicalTimestamp(record.issuedAt),
        expiresAt: restoreCanonicalTimestamp(record.expiresAt),
        signature: record.signature,
      };
      const result = await this.commandProcessor.process(envelope);
      if (!result.ok) await this.rejectCommand(record.id, safeCommandError(result.error));
    } catch {
      await this.rejectCommand(record.id, 'invalid-request');
    }
  }

  private async rejectCommand(recordId: string, safeError: PrivilegedCommandError): Promise<void> {
    try {
      await this.pb.collection(RELAY_PRIVILEGED_COMMANDS_COLLECTION).update(
        recordId,
        {
          state: 'failed',
          result: null,
          safeError,
          completedAt: new Date().toISOString(),
        },
        { requestKey: null },
      );
    } catch {
      // Recovery polling retries records that could not be terminally updated.
    }
  }

  private async processPairing(record: UnknownRecord): Promise<void> {
    const collection = this.pb.collection(RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION);
    try {
      const result = await this.pairingService.completePairing({
        challengeId: String(record.challengeId ?? ''),
        accountId: String(record.accountId ?? ''),
        authenticatedAccountId: String(record.accountId ?? ''),
        code: String(record.code ?? ''),
        publicJwk: record.publicKey,
        fingerprint: String(record.fingerprint ?? ''),
        hostname: String(record.hostname ?? ''),
        deviceLabel: String(record.deviceLabel ?? ''),
      });
      await collection.update(
        record.id,
        {
          code: 'REDACTED',
          state: 'completed',
          result,
          safeError: '',
          completedAt: new Date().toISOString(),
        },
        { requestKey: null },
      );
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'server-error';
      await collection.update(
        record.id,
        {
          code: 'REDACTED',
          state: 'failed',
          result: null,
          safeError: code,
          completedAt: new Date().toISOString(),
        },
        { requestKey: null },
      );
    }
  }
}
