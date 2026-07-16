import { createHash, randomUUID } from 'node:crypto';
import { hostname as getHostname } from 'node:os';
import { join } from 'node:path';
import type PocketBase from 'pocketbase';
import type { JsonWebKey } from 'node:crypto';
import type {
  PrivilegedPairingCompletionInput,
  PrivilegedPairingCompletionView,
  PrivilegedReauthenticationProof,
  PublicPrivilegedCommandRequest,
} from '@shared/ipc';
import {
  canonicalPrivilegedSigningBytes,
  canonicalizePrivilegedValue,
  PRIVILEGED_COMMAND_MAX_LIFETIME_MS,
  type PrivilegedCommandName,
  type PrivilegedCommandPayloadMap,
  type PrivilegedCommandResult,
  type SignedPrivilegedCommandEnvelope,
} from '@shared/privilegedCommands';
import {
  isPrivilegedAdministrator,
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type PrivilegedPairingChallengeView,
  type PrivilegedSessionView,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { RELAY_OPERATORS_COLLECTION } from '@shared/operators';
import { KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION } from '@shared/knowledge';
import type { RelayConfig } from '../config/AppConfig';
import type { DynatraceProblemsManager } from '../dynatrace/DynatraceProblemsManager';
import { loggers } from '../logger';
import { RelayOperatorManager } from '../operators/RelayOperatorManager';
import {
  PrivilegedPocketBaseClient,
  type PrivilegedAuthClient,
} from './PrivilegedPocketBaseClient';
import {
  PrivilegedDeviceStore,
  type LoadedDeviceKey,
  type PendingDeviceKey,
  type PrivilegedDeviceKeyStore,
} from './PrivilegedDeviceStore';
import {
  PrivilegedPairingService,
  type PairingCompletion,
  type PairingCompletionInput,
} from './PrivilegedPairingService';
import { PrivilegedCommandProcessor } from './PrivilegedCommandProcessor';
import {
  PocketBasePrivilegedRepository,
  PrivilegedPocketBaseClientTransport,
  PrivilegedServerQueue,
  type PrivilegedServerPocketBase,
} from './PrivilegedPocketBaseTransport';
import {
  PrivilegedSessionError,
  PrivilegedSessionManager,
  type PrivilegedAuthorization,
} from './PrivilegedSessionManager';
import { registerAdministrationCommands } from './registerAdministrationCommands';
import { PublisherAssignmentManager } from './PublisherAssignmentManager';
import { PrivilegedDeviceManager } from './PrivilegedDeviceManager';
import { RelayAdministrationSnapshotReader } from './RelayAdministrationSnapshotReader';
import { RelayAdministrationService } from './RelayAdministrationService';
import { registerKnowledgeManagementCommands } from '../knowledge/registerKnowledgeManagementCommands';
import { ManagedKnowledgeService } from '../knowledge/ManagedKnowledgeService';
import { KnowledgeMutationCoordinator } from '../knowledge/KnowledgeMutationCoordinator';
import { KnowledgeUploadCapacity } from '../knowledge/KnowledgeUploadCapacity';
import { KnowledgeUploadCoordinator } from '../knowledge/KnowledgeUploadCoordinator';
import { KnowledgeExtractorWorker } from '../knowledge/KnowledgeExtractorWorker';
import { PocketBaseKnowledgeUploadRepository } from '../knowledge/PocketBaseKnowledgeUploadRepository';

export type PrivilegedRuntimeMode = 'server' | 'client';

async function applyKnowledgeChunkE2EDelay(collection: string): Promise<void> {
  if (
    collection !== KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION ||
    process.env.NODE_ENV !== 'test' ||
    process.env.RELAY_E2E_PRIVILEGED_FIXTURES !== '1'
  ) {
    return;
  }
  const delayMs = Number(process.env.RELAY_E2E_KNOWLEDGE_CHUNK_DELAY_MS);
  if (!Number.isSafeInteger(delayMs) || delayMs < 1 || delayMs > 1_000) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export type PrivilegedAccountIdentity = Pick<PrivilegedAuthorization, 'assigned' | 'operatorName'>;

export interface PrivilegedClientTransport {
  completePairing(
    input: PairingCompletionInput & { operatorId: string },
  ): Promise<PairingCompletion>;
  submitCommand(
    envelope: SignedPrivilegedCommandEnvelope,
    operatorId: string,
    bodyHash: string,
  ): Promise<PrivilegedCommandResult>;
  dispose(): void | Promise<void>;
}

type CommandProcessorPort = Pick<PrivilegedCommandProcessor, 'process' | 'processLocal'>;
type PairingServicePort = Pick<
  PrivilegedPairingService,
  'completePairing' | 'createChallenge' | 'dispose'
>;

export type PrivilegedRuntimeOptions = {
  mode: PrivilegedRuntimeMode;
  hostname: string;
  authClient: PrivilegedAuthClient;
  deviceStore: PrivilegedDeviceKeyStore;
  resolveAccountIdentity(account: RelayPrivilegedAccountRecord): Promise<PrivilegedAccountIdentity>;
  clientTransport?: PrivilegedClientTransport;
  commandProcessor?: CommandProcessorPort;
  pairingService?: PairingServicePort;
  resolvePairingTarget?(targetAccountId: string): Promise<boolean>;
  now?: () => number;
  createId?: () => string;
  additionalDisposable?: { dispose(): void | Promise<void> };
};

type SessionListener = (view: PrivilegedSessionView) => void;

type PrivilegedE2EControl = {
  simulateInactivity(): PrivilegedSessionView | null;
};

export function installPrivilegedE2EControl(
  getRuntime: () => Pick<PrivilegedRuntime, 'getView' | 'lock'> | null,
): () => void {
  if (process.env.NODE_ENV !== 'test' || process.env.RELAY_E2E_PRIVILEGED_FIXTURES !== '1') {
    return () => undefined;
  }
  const scope = globalThis as typeof globalThis & {
    __relayE2EPrivileged?: PrivilegedE2EControl;
  };
  const control: PrivilegedE2EControl = {
    simulateInactivity: () => {
      const runtime = getRuntime();
      if (!runtime) return null;
      runtime.lock();
      return runtime.getView();
    },
  };
  Object.defineProperty(scope, '__relayE2EPrivileged', {
    configurable: true,
    enumerable: false,
    value: control,
    writable: false,
  });
  return () => {
    if (scope.__relayE2EPrivileged === control) delete scope.__relayE2EPrivileged;
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function runtimeError(code: PrivilegedSessionError['code']): PrivilegedSessionError {
  return new PrivilegedSessionError(code);
}

function publicCopy(view: PrivilegedSessionView): PrivilegedSessionView {
  return { ...view, capabilities: [...view.capabilities] };
}

export class PrivilegedRuntime {
  private readonly mode: PrivilegedRuntimeMode;
  private readonly hostname: string;
  private readonly authClient: PrivilegedAuthClient;
  private readonly deviceStore: PrivilegedDeviceKeyStore;
  private readonly resolveAccountIdentity: PrivilegedRuntimeOptions['resolveAccountIdentity'];
  private readonly clientTransport?: PrivilegedClientTransport;
  private readonly commandProcessor?: CommandProcessorPort;
  private readonly pairingService?: PairingServicePort;
  private readonly resolvePairingTarget?: PrivilegedRuntimeOptions['resolvePairingTarget'];
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly additionalDisposable?: { dispose(): void | Promise<void> };
  private readonly sessionManager: PrivilegedSessionManager;
  private readonly listeners = new Set<SessionListener>();
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  constructor(options: PrivilegedRuntimeOptions) {
    this.mode = options.mode;
    this.hostname = options.hostname;
    this.authClient = options.authClient;
    this.deviceStore = options.deviceStore;
    this.resolveAccountIdentity = options.resolveAccountIdentity;
    this.clientTransport = options.clientTransport;
    this.commandProcessor = options.commandProcessor;
    this.pairingService = options.pairingService;
    this.resolvePairingTarget = options.resolvePairingTarget;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.additionalDisposable = options.additionalDisposable;

    if (this.mode === 'server' && (!this.commandProcessor || !this.pairingService)) {
      throw new TypeError('Server privileged runtime requires command and pairing services.');
    }
    if (this.mode === 'client' && !this.clientTransport) {
      throw new TypeError('Client privileged runtime requires a client transport.');
    }

    this.sessionManager = new PrivilegedSessionManager({
      authClient: options.authClient,
      confirmReauthentication: (input) => this.confirmReauthentication(input),
      now: this.now,
      onViewChanged: (view) => this.emit(view),
      resolveAuthorization: (account) => this.resolveAuthorization(account),
    });
  }

  getView(): PrivilegedSessionView {
    return this.sessionManager.getView();
  }

  async createPrivilegedRecord(
    collection: string,
    data: Record<string, unknown> | FormData,
  ): Promise<Record<string, unknown> & { id: string }> {
    this.assertAvailable();
    const view = this.getView();
    if (
      view.state !== 'active' ||
      !view.accountId ||
      !view.operatorId ||
      !view.capabilities.includes('knowledge.manage') ||
      !this.authClient.createRecord
    ) {
      throw runtimeError('unauthorized');
    }
    await applyKnowledgeChunkE2EDelay(collection);
    return this.authClient.createRecord(collection, data);
  }

  login(input: { operatorId: string; password: string }): Promise<PrivilegedSessionView> {
    this.assertAvailable();
    return this.sessionManager.login(input);
  }

  logout(): Promise<void> {
    return this.sessionManager.logout();
  }

  lock(): void {
    this.sessionManager.lock();
  }

  reauthenticate(password: string): Promise<PrivilegedReauthenticationProof> {
    this.assertAvailable();
    return this.sessionManager.reauthenticate(password);
  }

  async createPairingChallenge(targetAccountId: string): Promise<PrivilegedPairingChallengeView> {
    this.assertAvailable();
    const view = this.getView();
    if (
      this.mode !== 'server' ||
      view.state !== 'active' ||
      !view.accountId ||
      !view.capabilities.includes('devices.manage')
    ) {
      throw runtimeError('unauthorized');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(targetAccountId)) {
      throw runtimeError('unauthorized');
    }
    const eligible = this.resolvePairingTarget
      ? await this.resolvePairingTarget(targetAccountId)
      : targetAccountId === view.accountId;
    if (!eligible) throw runtimeError('unauthorized');
    return this.pairingService!.createChallenge(
      { accountId: targetAccountId },
      { isServerMode: true, trustedLocalSender: true },
    );
  }

  async completePairing(
    input: PrivilegedPairingCompletionInput,
  ): Promise<PrivilegedPairingCompletionView> {
    this.assertAvailable();
    const view = this.getView();
    if (
      this.mode !== 'client' ||
      view.state !== 'pairing-required' ||
      !view.accountId ||
      !view.operatorId
    ) {
      throw runtimeError('unauthorized');
    }

    const pending = await this.deviceStore.create(view.accountId, input.deviceLabel);
    let completion: PairingCompletion;
    try {
      completion = await this.clientTransport!.completePairing(
        this.toPairingRequest(input, view.accountId, view.operatorId, pending),
      );
    } catch (error) {
      await this.deviceStore
        .removePending(view.accountId, pending.pendingKeyId)
        .catch(() => undefined);
      throw error;
    }
    await this.deviceStore.bind(view.accountId, pending.pendingKeyId, completion.deviceId);
    this.sessionManager.activatePairedDevice(completion.deviceId);
    return completion;
  }

  submitPublicCommand(input: PublicPrivilegedCommandRequest): Promise<PrivilegedCommandResult> {
    this.assertAvailable();
    const view = this.getView();
    if (view.state !== 'active' || !view.accountId || !view.operatorId || !view.role) {
      return Promise.resolve({ ok: false, error: 'locked' });
    }
    if (this.mode === 'server') {
      return this.submitLocal(input.command, input.payload, input.expectedRevision);
    }
    if (!view.deviceId) return Promise.resolve({ ok: false, error: 'pairing-required' });
    return this.submitRemote(
      {
        accountId: view.accountId,
        operatorId: view.operatorId,
        role: view.role,
      },
      view.deviceId,
      input.command,
      input.payload,
      input.expectedRevision,
    );
  }

  onSessionChanged(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    const clientDisposal = this.clientTransport?.dispose();
    this.sessionManager.dispose();
    this.listeners.clear();
    this.disposePromise = (async () => {
      await clientDisposal;
      await this.additionalDisposable?.dispose();
      this.pairingService?.dispose();
    })();
    return this.disposePromise;
  }

  private async resolveAuthorization(
    account: RelayPrivilegedAccountRecord,
  ): Promise<PrivilegedAuthorization> {
    const identity = await this.resolveAccountIdentity(account);
    if (!identity.assigned) return { ...identity, deviceId: null, paired: false };
    if (this.mode === 'server') {
      return { ...identity, deviceId: null, paired: true };
    }
    const device = await this.deviceStore.findForAccount(account.id);
    if (!device) return { ...identity, deviceId: null, paired: false };
    const probe = await this.submitRemote(
      { accountId: account.id, operatorId: account.operatorId, role: account.role },
      device.deviceId,
      'privileged.status.read',
      { clientVersion: '1' },
      null,
      false,
    );
    return {
      ...identity,
      deviceId: probe.ok ? device.deviceId : null,
      paired: probe.ok,
    };
  }

  private async confirmReauthentication(input: {
    accountId: string;
    operatorId: string;
    role: RelayPrivilegedAccountRecord['role'];
    deviceId: string | null;
    authenticatedAt: string;
  }): Promise<{ requestId: string }> {
    let result: PrivilegedCommandResult;
    if (this.mode === 'server') {
      result = await this.submitLocal(
        'privileged.reauth.confirm',
        { authenticatedAt: input.authenticatedAt },
        null,
      );
    } else if (input.deviceId) {
      result = await this.submitRemote(
        input,
        input.deviceId,
        'privileged.reauth.confirm',
        { authenticatedAt: input.authenticatedAt },
        null,
      );
    } else {
      result = { ok: false, error: 'pairing-required' };
    }
    if (!result.ok || !result.requestId) throw runtimeError('unauthorized');
    return { requestId: result.requestId };
  }

  private submitLocal<K extends PrivilegedCommandName>(
    command: K,
    payload: PrivilegedCommandPayloadMap[K],
    expectedRevision: number | null,
  ): Promise<PrivilegedCommandResult> {
    const view = this.getView();
    if (!view.accountId || !view.operatorId) {
      return Promise.resolve({ ok: false, error: 'unauthorized' });
    }
    return this.commandProcessor!.processLocal(
      {
        requestId: this.createId(),
        accountId: view.accountId,
        operatorId: view.operatorId,
        command,
        payload,
        expectedRevision,
      },
      {
        isServerMode: true,
        trustedLocalSender: true,
        session: view,
      },
    );
  }

  private async submitRemote<K extends PrivilegedCommandName>(
    identity: {
      accountId: string;
      operatorId: string;
      role: RelayPrivilegedAccountRecord['role'];
    },
    deviceId: string,
    command: K,
    payload: PrivilegedCommandPayloadMap[K],
    expectedRevision: number | null,
    recordActivity = true,
  ): Promise<PrivilegedCommandResult> {
    const issuedAtMs = this.now();
    const payloadHash = sha256(canonicalizePrivilegedValue(payload));
    const envelope: SignedPrivilegedCommandEnvelope<K> = {
      version: 1,
      requestId: this.createId(),
      accountId: identity.accountId,
      deviceId,
      roleClaim: identity.role,
      command,
      payload,
      payloadHash,
      expectedRevision,
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(issuedAtMs + PRIVILEGED_COMMAND_MAX_LIFETIME_MS).toISOString(),
      signature: '',
    };
    const bytes = canonicalPrivilegedSigningBytes(envelope);
    envelope.signature = await this.deviceStore.sign(identity.accountId, deviceId, bytes);
    const result = await this.clientTransport!.submitCommand(
      envelope,
      identity.operatorId,
      sha256(bytes),
    );
    if (result.ok && recordActivity) this.sessionManager.recordPrivilegedActivity();
    return result;
  }

  private toPairingRequest(
    input: PrivilegedPairingCompletionInput,
    accountId: string,
    operatorId: string,
    pending: PendingDeviceKey,
  ): PairingCompletionInput & { operatorId: string } {
    return {
      challengeId: input.challengeId,
      accountId,
      authenticatedAccountId: accountId,
      operatorId,
      code: input.code,
      publicJwk: pending.publicJwk as JsonWebKey,
      fingerprint: pending.fingerprint,
      hostname: this.hostname,
      deviceLabel: pending.label,
    };
  }

  private emit(view: PrivilegedSessionView): void {
    const safeView = publicCopy(view);
    for (const listener of this.listeners) listener(safeView);
  }

  private assertAvailable(): void {
    if (this.disposed) throw runtimeError('locked');
  }
}

export type { LoadedDeviceKey };

export type ProductionPrivilegedRuntimeOptions = {
  config: RelayConfig;
  dataDir: string;
  serverClient?: PocketBase | null;
  hostname?: string;
  dynatraceProblemsManager?: Pick<
    DynatraceProblemsManager,
    'getSettings' | 'saveSettings' | 'saveAlertingProfiles'
  > | null;
};

function boundedIdentityString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

async function resolveProductionIdentity(
  authClient: PrivilegedPocketBaseClient,
  account: RelayPrivilegedAccountRecord,
): Promise<PrivilegedAccountIdentity> {
  const [state, operator] = await Promise.all([
    authClient.getFirstRecord(RELAY_PRIVILEGED_STATE_COLLECTION, 'key="primary"'),
    authClient.getRecord(RELAY_OPERATORS_COLLECTION, account.operatorId),
  ]);
  const operatorName = boundedIdentityString(operator.displayName, 120) ? operator.displayName : '';
  const operatorIsCurrent = operator.id === account.operatorId && operator.active === true;
  const assigned =
    operatorIsCurrent &&
    ((account.role === 'admin' && isPrivilegedAdministrator(state, account.operatorId)) ||
      (account.role === 'publisher' && state.publisherOperatorId === account.operatorId));
  return { assigned, operatorName };
}

export async function resolveProductionPairingTarget(
  pb: PocketBase,
  targetAccountId: string,
): Promise<boolean> {
  try {
    const [state, account] = await Promise.all([
      pb
        .collection(RELAY_PRIVILEGED_STATE_COLLECTION)
        .getFirstListItem<RelayPrivilegedStateRecord>('key="primary"', { requestKey: null }),
      pb
        .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
        .getOne<RelayPrivilegedAccountRecord>(targetAccountId, { requestKey: null }),
    ]);
    if (account.id !== targetAccountId || account.active !== true) return false;
    return (
      (account.role === 'admin' && isPrivilegedAdministrator(state, account.operatorId)) ||
      (account.role === 'publisher' && account.operatorId === state.publisherOperatorId)
    );
  } catch {
    return false;
  }
}

export async function createProductionPrivilegedRuntime(
  options: ProductionPrivilegedRuntimeOptions,
): Promise<PrivilegedRuntime> {
  const { config, dataDir } = options;
  const mode = config.mode;
  const serverUrl = mode === 'server' ? `http://127.0.0.1:${config.port}` : config.serverUrl;
  const authClient = new PrivilegedPocketBaseClient({
    serverUrl,
    allowInsecureHttp: mode === 'server' || config.allowInsecureHttp === true,
  });
  const deviceStore = new PrivilegedDeviceStore({ dataDir });
  const resolveAccountIdentity = (account: RelayPrivilegedAccountRecord) =>
    resolveProductionIdentity(authClient, account);

  if (mode === 'client') {
    const clientTransport = new PrivilegedPocketBaseClientTransport({ client: authClient });
    return new PrivilegedRuntime({
      authClient,
      clientTransport,
      deviceStore,
      hostname: options.hostname ?? getHostname(),
      mode,
      resolveAccountIdentity,
    });
  }

  if (!options.serverClient) {
    authClient.disconnect();
    throw new TypeError('Server PocketBase must be ready before privileged access starts.');
  }
  const repository = new PocketBasePrivilegedRepository(
    options.serverClient as unknown as PrivilegedServerPocketBase,
  );
  const pairingService = new PrivilegedPairingService({ repository });
  const commandProcessor = new PrivilegedCommandProcessor({
    repository,
    logger: loggers.security,
  });
  const operatorManager = new RelayOperatorManager(options.serverClient);
  const publisherManager = new PublisherAssignmentManager({ pb: options.serverClient });
  const deviceManager = new PrivilegedDeviceManager({ pb: options.serverClient });
  const administrationService = options.dynatraceProblemsManager
    ? new RelayAdministrationService({ dynatrace: options.dynatraceProblemsManager })
    : undefined;
  registerAdministrationCommands({
    registrar: commandProcessor,
    operatorManager,
    publisherManager,
    deviceManager,
    administrationService,
    snapshotReader: administrationService
      ? new RelayAdministrationSnapshotReader({
          pb: options.serverClient,
          deviceManager,
          administrationService,
          logger: loggers.security,
        })
      : undefined,
    consumeReauthenticationProof: (requestId, context) =>
      commandProcessor.consumeReauthenticationProof(requestId, context),
  });
  const managedKnowledgeService = new ManagedKnowledgeService({ pb: options.serverClient });
  const knowledgeUploadRepository = new PocketBaseKnowledgeUploadRepository({
    pb: options.serverClient,
  });
  const knowledgeUploadCoordinator = new KnowledgeUploadCoordinator({
    repository: knowledgeUploadRepository,
    capacity: new KnowledgeUploadCapacity({
      storagePath: join(dataDir, 'pb_data', 'storage'),
      hasActiveBatch: (accountId) => knowledgeUploadRepository.hasActiveBatch(accountId),
    }),
    extractor: new KnowledgeExtractorWorker(),
  });
  await knowledgeUploadCoordinator.start();
  const knowledgeCommands = registerKnowledgeManagementCommands({
    registrar: commandProcessor,
    pb: options.serverClient,
    service: managedKnowledgeService,
    coordinator: new KnowledgeMutationCoordinator(),
    uploadCoordinator: knowledgeUploadCoordinator,
    consumeReauthenticationProof: (requestId, context) =>
      commandProcessor.consumeReauthenticationProof(requestId, context),
  });
  const serverQueue = new PrivilegedServerQueue({
    pb: options.serverClient as unknown as PrivilegedServerPocketBase,
    commandProcessor,
    pairingService,
  });
  await serverQueue.start();
  return new PrivilegedRuntime({
    additionalDisposable: {
      dispose: async () => {
        await serverQueue.dispose();
        await knowledgeCommands.dispose();
      },
    },
    authClient,
    commandProcessor,
    deviceStore,
    hostname: options.hostname ?? getHostname(),
    mode,
    pairingService,
    resolvePairingTarget: (targetAccountId) =>
      resolveProductionPairingTarget(options.serverClient!, targetAccountId),
    resolveAccountIdentity,
  });
}
