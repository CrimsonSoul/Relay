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
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type PrivilegedPairingChallengeView,
  type PrivilegedSessionView,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { getEffectiveRole } from '@shared/roleAccounts';
import { KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION } from '@shared/knowledge';
import type { RelayConfig } from '../config/AppConfig';
import type { DynatraceProblemsManager } from '../dynatrace/DynatraceProblemsManager';
import { loggers } from '../logger';
import {
  PrivilegedPocketBaseClient,
  type PrivilegedAuthClient,
  type PrivilegedAuthoritySnapshot,
} from './PrivilegedPocketBaseClient';
import {
  PrivilegedDeviceStore,
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
import { RoleAccountManager } from './RoleAccountManager';
import { AuthorityMutationCoordinator } from './AuthorityMutationCoordinator';
import { registerKnowledgeManagementCommands } from '../knowledge/registerKnowledgeManagementCommands';
import { ManagedKnowledgeService } from '../knowledge/ManagedKnowledgeService';
import { KnowledgeMutationCoordinator } from '../knowledge/KnowledgeMutationCoordinator';
import { KnowledgeUploadCapacity } from '../knowledge/KnowledgeUploadCapacity';
import { KnowledgeUploadCoordinator } from '../knowledge/KnowledgeUploadCoordinator';
import { KnowledgeExtractorWorker } from '../knowledge/KnowledgeExtractorWorker';
import { KnowledgeSearchIndexer } from '../knowledge/KnowledgeSearchIndexer';
import { PocketBaseKnowledgeUploadRepository } from '../knowledge/PocketBaseKnowledgeUploadRepository';
import { ProductionPrivilegedHost, type PrivilegedRuntimeSource } from './ProductionPrivilegedHost';

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

export type PrivilegedAccountIdentity = Pick<PrivilegedAuthorization, 'assigned' | 'role'>;

export interface PrivilegedClientTransport {
  completePairing(
    input: PairingCompletionInput & { displayNameSnapshot: string },
  ): Promise<PairingCompletion>;
  submitCommand(
    envelope: SignedPrivilegedCommandEnvelope,
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
  localSource?: PrivilegedRuntimeSource;
  ownsPairingService?: boolean;
};

type SessionListener = (view: PrivilegedSessionView) => void;

type PrivilegedSessionIdentity = {
  state: 'active' | 'pairing-required';
  accountId: string;
  deviceId: string | null;
  role: NonNullable<PrivilegedSessionView['role']>;
  generation: number;
};

type AuthenticationTransition = {
  cancelled: boolean;
  deferredReadyView: PrivilegedSessionView | null;
};

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
  private readonly resolvePairingTarget: PrivilegedRuntimeOptions['resolvePairingTarget'];
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly additionalDisposable?: { dispose(): void | Promise<void> };
  private readonly localSource: PrivilegedRuntimeSource;
  private readonly ownsPairingService: boolean;
  private readonly sessionManager: PrivilegedSessionManager;
  private readonly listeners = new Set<SessionListener>();
  private disposed = false;
  private disposePromise: Promise<void> | null = null;
  private authorityStop: (() => Promise<void>) | null = null;
  private authorityGeneration = 0;
  private sessionGeneration = 0;
  private authenticationTransition: AuthenticationTransition | null = null;

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
    this.localSource = options.localSource ?? { kind: 'electron' };
    this.ownsPairingService = options.ownsPairingService ?? true;

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
      onViewChanged: (view) => {
        this.sessionGeneration += 1;
        if (view.state !== 'active' && view.state !== 'pairing-required') {
          void this.stopAuthorityMonitoring();
        }
        const transition = this.authenticationTransition;
        if (transition && (view.state === 'active' || view.state === 'pairing-required')) {
          transition.deferredReadyView = publicCopy(view);
          return;
        }
        if (transition) transition.deferredReadyView = null;
        this.emit(view);
      },
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
      this.authenticationTransition ||
      view.state !== 'active' ||
      !view.accountId ||
      !view.role ||
      !view.capabilities.includes('knowledge.manage') ||
      !this.authClient.createRecord
    ) {
      throw runtimeError('unauthorized');
    }
    const initiatingSession: PrivilegedSessionIdentity = {
      state: 'active',
      accountId: view.accountId,
      deviceId: view.deviceId,
      role: view.role,
      generation: this.sessionGeneration,
    };
    await applyKnowledgeChunkE2EDelay(collection);
    if (!this.matchesPrivilegedSession(initiatingSession)) throw runtimeError('unauthorized');
    const record = await this.authClient.createRecord(collection, data);
    if (!this.matchesPrivilegedSession(initiatingSession)) throw runtimeError('unauthorized');
    return record;
  }

  async login(input: { username: string; password: string }): Promise<PrivilegedSessionView> {
    this.assertAvailable();
    const transition = this.beginAuthenticationTransition();
    try {
      await this.stopAuthorityMonitoring();
      if (!this.isAuthenticationTransitionCurrent(transition)) return this.getView();
      const view = await this.sessionManager.login(input);
      this.assertAuthenticationTransition(transition);
      if (
        this.mode === 'client' &&
        (view.state === 'active' || view.state === 'pairing-required')
      ) {
        try {
          await this.startAuthorityMonitoring(view.accountId!);
        } catch (error) {
          if (this.isAuthenticationTransitionCurrent(transition)) {
            this.sessionManager.logout();
            throw error;
          }
        }
      }
      if (!this.isAuthenticationTransitionCurrent(transition)) return this.getView();
      const current = this.getView();
      if (current.state === 'offline') throw runtimeError('offline');
      return current;
    } finally {
      this.endAuthenticationTransition(transition);
    }
  }

  async logout(): Promise<void> {
    this.cancelAuthenticationTransition();
    const monitoringStop = this.stopAuthorityMonitoring();
    this.sessionManager.logout();
    await monitoringStop;
  }

  async reauthenticate(password: string): Promise<PrivilegedReauthenticationProof> {
    this.assertAvailable();
    const transition = this.beginAuthenticationTransition();
    try {
      await this.stopAuthorityMonitoring();
      this.assertAuthenticationTransition(transition);
      const proof = await this.sessionManager.reauthenticate(password);
      this.assertAuthenticationTransition(transition);
      const view = this.getView();
      if (this.mode === 'client' && view.state === 'active' && view.accountId) {
        try {
          await this.startAuthorityMonitoring(view.accountId);
        } catch (error) {
          this.sessionManager.logout();
          throw error;
        }
      }
      this.assertAuthenticationTransition(transition);
      return proof;
    } finally {
      this.endAuthenticationTransition(transition);
    }
  }

  async createPairingChallenge(targetAccountId: string): Promise<PrivilegedPairingChallengeView> {
    this.assertAvailable();
    const view = this.getView();
    if (
      this.authenticationTransition ||
      this.mode !== 'server' ||
      view.state !== 'active' ||
      !view.accountId ||
      !view.role ||
      !view.capabilities.includes('devices.manage')
    ) {
      throw runtimeError('unauthorized');
    }
    const initiatingSession: PrivilegedSessionIdentity = {
      state: 'active',
      accountId: view.accountId,
      deviceId: view.deviceId,
      role: view.role,
      generation: this.sessionGeneration,
    };
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(targetAccountId)) {
      throw runtimeError('unauthorized');
    }
    const eligible = this.resolvePairingTarget
      ? await this.resolvePairingTarget(targetAccountId)
      : targetAccountId === view.accountId;
    if (!this.matchesPrivilegedSession(initiatingSession)) throw runtimeError('unauthorized');
    if (!eligible) throw runtimeError('unauthorized');
    const challenge = await this.pairingService!.createChallenge(
      { accountId: targetAccountId },
      { isServerMode: true, trustedLocalSender: true },
    );
    if (!this.matchesPrivilegedSession(initiatingSession)) throw runtimeError('unauthorized');
    return challenge;
  }

  async completePairing(
    input: PrivilegedPairingCompletionInput,
  ): Promise<PrivilegedPairingCompletionView> {
    this.assertAvailable();
    const view = this.getView();
    if (
      this.authenticationTransition ||
      this.mode !== 'client' ||
      view.state !== 'pairing-required' ||
      !view.accountId ||
      !view.displayName ||
      !view.role
    ) {
      throw runtimeError('unauthorized');
    }
    const initiatingSession: PrivilegedSessionIdentity = {
      state: 'pairing-required',
      accountId: view.accountId,
      deviceId: view.deviceId,
      role: view.role,
      generation: this.sessionGeneration,
    };

    const pending = await this.deviceStore.create(view.accountId, input.deviceLabel);
    if (!this.matchesPrivilegedSession(initiatingSession)) {
      await this.deviceStore
        .removePending(view.accountId, pending.pendingKeyId)
        .catch(() => undefined);
      throw runtimeError('unauthorized');
    }
    let completion: PairingCompletion;
    try {
      completion = await this.clientTransport!.completePairing(
        this.toPairingRequest(input, view.accountId, view.displayName, pending),
      );
    } catch (error) {
      await this.deviceStore
        .removePending(view.accountId, pending.pendingKeyId)
        .catch(() => undefined);
      throw error;
    }
    if (!this.matchesPrivilegedSession(initiatingSession)) {
      await this.deviceStore
        .removePending(view.accountId, pending.pendingKeyId)
        .catch(() => undefined);
      throw runtimeError('unauthorized');
    }
    await this.deviceStore.bind(view.accountId, pending.pendingKeyId, completion.deviceId);
    if (!this.matchesPrivilegedSession(initiatingSession)) throw runtimeError('unauthorized');
    this.sessionManager.activatePairedDevice(completion.deviceId);
    return completion;
  }

  submitPublicCommand(input: PublicPrivilegedCommandRequest): Promise<PrivilegedCommandResult> {
    this.assertAvailable();
    if (this.authenticationTransition) {
      return Promise.resolve({ ok: false, error: 'unauthorized' });
    }
    const view = this.getView();
    if (view.state !== 'active' || !view.accountId || !view.displayName || !view.role) {
      return Promise.resolve({ ok: false, error: 'unauthorized' });
    }
    if (this.mode === 'server') {
      return this.submitLocal(input.command, input.payload, input.expectedRevision, view, {
        state: 'active',
        accountId: view.accountId,
        deviceId: view.deviceId,
        role: view.role,
        generation: this.sessionGeneration,
      });
    }
    if (!view.deviceId) return Promise.resolve({ ok: false, error: 'pairing-required' });
    return this.submitRemote(
      {
        accountId: view.accountId,
        displayName: view.displayName,
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

  handleAuthorityChanged(accountIds: readonly string[]): void {
    this.sessionManager.handleAuthorityChanged(accountIds);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.cancelAuthenticationTransition();
    const authorityDisposal = this.stopAuthorityMonitoring();
    const clientDisposal = this.clientTransport?.dispose();
    this.sessionManager.dispose();
    this.listeners.clear();
    this.disposePromise = (async () => {
      await authorityDisposal;
      await clientDisposal;
      await this.additionalDisposable?.dispose();
      if (this.ownsPairingService) this.pairingService?.dispose();
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
      { accountId: account.id, displayName: account.displayName, role: identity.role! },
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
    username: string;
    displayName: string;
    role: NonNullable<PrivilegedSessionView['role']>;
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
    } else {
      // Paired clients obtain proof directly from the authenticated PocketBase
      // route. Internal confirmation is never accepted over the signed command
      // surface.
      result = { ok: false, error: 'unauthorized' };
    }
    if (!result.ok || !result.requestId) throw runtimeError('unauthorized');
    return { requestId: result.requestId };
  }

  private submitLocal<K extends PrivilegedCommandName>(
    command: K,
    payload: PrivilegedCommandPayloadMap[K],
    expectedRevision: number | null,
    view = this.getView(),
    initiatingSession?: PrivilegedSessionIdentity,
  ): Promise<PrivilegedCommandResult> {
    if (!view.accountId) {
      return Promise.resolve({ ok: false, error: 'unauthorized' });
    }
    const result = this.commandProcessor!.processLocal(
      {
        requestId: this.createId(),
        accountId: view.accountId,
        command,
        payload,
        expectedRevision,
      },
      {
        isServerMode: true,
        trustedLocalSender: true,
        session: view,
        source: this.localSource.kind,
        ...(this.localSource.kind === 'web'
          ? {
              browserFamily: this.localSource.browserFamily,
              addressLabel: this.localSource.addressLabel,
              rateLimitKey: `web:${this.localSource.sessionId}:${view.accountId}`,
            }
          : {}),
      },
    );
    if (!initiatingSession) return result;
    return result.then((resolved) =>
      this.matchesPrivilegedSession(initiatingSession)
        ? resolved
        : { ok: false, error: 'unauthorized' },
    );
  }

  private async submitRemote<K extends PrivilegedCommandName>(
    identity: {
      accountId: string;
      displayName: string;
      role: NonNullable<PrivilegedSessionView['role']>;
    },
    deviceId: string,
    command: K,
    payload: PrivilegedCommandPayloadMap[K],
    expectedRevision: number | null,
    invalidateOnUnauthorized = true,
  ): Promise<PrivilegedCommandResult> {
    const initiatingSession = invalidateOnUnauthorized
      ? {
          state: 'active' as const,
          accountId: identity.accountId,
          deviceId,
          role: identity.role,
          generation: this.sessionGeneration,
        }
      : null;
    const issuedAtMs = this.now();
    const payloadHash = sha256(canonicalizePrivilegedValue(payload));
    const envelope: SignedPrivilegedCommandEnvelope<K> = {
      version: 1,
      requestId: this.createId(),
      accountId: identity.accountId,
      deviceId,
      roleClaim: identity.role,
      displayNameSnapshot: identity.displayName,
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
    if (initiatingSession && !this.matchesPrivilegedSession(initiatingSession)) {
      return { ok: false, requestId: envelope.requestId, error: 'unauthorized' };
    }
    const result = await this.clientTransport!.submitCommand(envelope, sha256(bytes));
    if (initiatingSession && !this.matchesPrivilegedSession(initiatingSession)) {
      return { ok: false, requestId: envelope.requestId, error: 'unauthorized' };
    }
    if (initiatingSession && !result.ok && result.error === 'unauthorized') {
      void this.logout();
    }
    return result;
  }

  private beginAuthenticationTransition(): AuthenticationTransition {
    if (this.authenticationTransition) throw runtimeError('unauthorized');
    const transition: AuthenticationTransition = { cancelled: false, deferredReadyView: null };
    this.authenticationTransition = transition;
    this.sessionGeneration += 1;
    return transition;
  }

  private assertAuthenticationTransition(expected: AuthenticationTransition): void {
    if (!this.isAuthenticationTransitionCurrent(expected)) {
      throw runtimeError('unauthorized');
    }
  }

  private isAuthenticationTransitionCurrent(expected: AuthenticationTransition): boolean {
    return this.authenticationTransition === expected && !expected.cancelled;
  }

  private cancelAuthenticationTransition(): void {
    if (!this.authenticationTransition) return;
    const transition = this.authenticationTransition;
    transition.cancelled = true;
    this.authenticationTransition = null;
    this.sessionGeneration += 1;
  }

  private endAuthenticationTransition(expected: AuthenticationTransition): void {
    if (this.authenticationTransition !== expected) return;
    this.authenticationTransition = null;
    if (expected.deferredReadyView) this.emit(this.getView());
  }

  private matchesPrivilegedSession(expected: PrivilegedSessionIdentity): boolean {
    const current = this.getView();
    return (
      !this.authenticationTransition &&
      this.sessionGeneration === expected.generation &&
      current.state === expected.state &&
      current.accountId === expected.accountId &&
      current.deviceId === expected.deviceId &&
      current.role === expected.role
    );
  }

  private handleAuthoritySnapshot(snapshot: PrivilegedAuthoritySnapshot): void {
    this.sessionManager.handleAuthoritySnapshot(snapshot.account, snapshot.state);
  }

  private async startAuthorityMonitoring(accountId: string): Promise<void> {
    if (!this.authClient.monitorAuthority) return;
    await this.stopAuthorityMonitoring();
    const generation = ++this.authorityGeneration;
    let stop: () => void | Promise<void>;
    try {
      stop = await this.authClient.monitorAuthority(accountId, {
        onDisconnect: () => {
          if (this.authorityGeneration === generation) this.sessionManager.handleDisconnect();
        },
        onSnapshot: (snapshot) => {
          if (this.authorityGeneration === generation) this.handleAuthoritySnapshot(snapshot);
        },
      });
    } catch (error) {
      if (this.authorityGeneration !== generation) return;
      throw error;
    }
    const view = this.getView();
    if (
      this.authorityGeneration !== generation ||
      this.disposed ||
      view.accountId !== accountId ||
      (view.state !== 'active' && view.state !== 'pairing-required')
    ) {
      await stop();
      return;
    }
    this.authorityStop = stop;
  }

  private async stopAuthorityMonitoring(): Promise<void> {
    this.authorityGeneration += 1;
    const stop = this.authorityStop;
    this.authorityStop = null;
    await stop?.();
  }

  private toPairingRequest(
    input: PrivilegedPairingCompletionInput,
    accountId: string,
    displayName: string,
    pending: PendingDeviceKey,
  ): PairingCompletionInput & { displayNameSnapshot: string } {
    return {
      challengeId: input.challengeId,
      accountId,
      authenticatedAccountId: accountId,
      displayNameSnapshot: displayName,
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
    if (this.disposed) throw runtimeError('unauthorized');
  }
}

export type { LoadedDeviceKey } from './PrivilegedDeviceStore';

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

export function startKnowledgeSearchIndexerBestEffort(
  searchIndexer: Pick<KnowledgeSearchIndexer, 'start'>,
): void {
  void Promise.resolve()
    .then(() => searchIndexer.start())
    .catch((error) => {
      loggers.main.warn('Wiki search indexer startup failed', { error });
    });
}

type ProductionAdministrationRegistrar = Pick<PrivilegedCommandProcessor, 'registerCommand'>;

export function registerProductionAdministrationCommands(options: {
  pb: PocketBase;
  registrar: ProductionAdministrationRegistrar;
  administrationService?: RelayAdministrationService;
  consumeReauthenticationProof: (
    requestId: string,
    context: { accountId: string; deviceId: string | null },
  ) => Promise<boolean>;
  onAuthorityChanged?: (accountIds: string[]) => void | Promise<void>;
}): {
  roleAccountManager: RoleAccountManager;
  publisherManager: PublisherAssignmentManager;
  deviceManager: PrivilegedDeviceManager;
  snapshotReader: RelayAdministrationSnapshotReader;
  coordinator: AuthorityMutationCoordinator;
} {
  const deviceManager = new PrivilegedDeviceManager({ pb: options.pb });
  const snapshotReader = new RelayAdministrationSnapshotReader({
    pb: options.pb,
    deviceManager,
    administrationService: options.administrationService ?? { getSettingSummaries: () => [] },
    logger: loggers.security,
  });
  const coordinator = new AuthorityMutationCoordinator();
  const roleAccountManager = new RoleAccountManager({
    pb: options.pb,
    snapshotReader,
    coordinator,
    onAuthorityChanged: options.onAuthorityChanged,
  });
  const publisherManager = new PublisherAssignmentManager({
    pb: options.pb,
    coordinator,
    onAssignmentChanged: options.onAuthorityChanged,
  });
  registerAdministrationCommands({
    registrar: options.registrar,
    roleAccountManager,
    publisherManager,
    deviceManager,
    administrationService: options.administrationService,
    snapshotReader,
    consumeReauthenticationProof: options.consumeReauthenticationProof,
  });
  return { roleAccountManager, publisherManager, deviceManager, snapshotReader, coordinator };
}

async function resolveProductionIdentity(
  authClient: PrivilegedPocketBaseClient,
  account: RelayPrivilegedAccountRecord,
): Promise<PrivilegedAccountIdentity> {
  const state = (await authClient.getFirstRecord(
    RELAY_PRIVILEGED_STATE_COLLECTION,
    'key="primary"',
  )) as unknown as RelayPrivilegedStateRecord;
  const role = getEffectiveRole(account, state);
  return { assigned: account.active && role !== null, role };
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
    return getEffectiveRole(account, state) !== null;
  } catch {
    return false;
  }
}

type ProductionServerSharedResources = {
  commandProcessor: PrivilegedCommandProcessor;
  pairingService: PrivilegedPairingService;
  searchIndexer: KnowledgeSearchIndexer;
  setAuthorityChangedHandler(handler: (accountIds: string[]) => void): void;
  dispose(): Promise<void>;
};

async function createProductionServerSharedResources(
  options: ProductionPrivilegedRuntimeOptions & { serverClient: PocketBase },
): Promise<ProductionServerSharedResources> {
  const repository = new PocketBasePrivilegedRepository(
    options.serverClient as unknown as PrivilegedServerPocketBase,
  );
  const pairingService = new PrivilegedPairingService({ repository });
  const commandProcessor = new PrivilegedCommandProcessor({
    repository,
    logger: loggers.security,
  });
  const administrationService = options.dynatraceProblemsManager
    ? new RelayAdministrationService({ dynatrace: options.dynatraceProblemsManager })
    : undefined;
  let authorityChanged: (accountIds: string[]) => void = (_accountIds) => undefined;
  registerProductionAdministrationCommands({
    pb: options.serverClient,
    registrar: commandProcessor,
    administrationService,
    consumeReauthenticationProof: (requestId, context) =>
      commandProcessor.consumeReauthenticationProof(requestId, context),
    onAuthorityChanged: (accountIds) => authorityChanged(accountIds),
  });
  const managedKnowledgeService = new ManagedKnowledgeService({ pb: options.serverClient });
  const searchIndexer = new KnowledgeSearchIndexer({ pb: options.serverClient });
  const knowledgeUploadRepository = new PocketBaseKnowledgeUploadRepository({
    pb: options.serverClient,
  });
  const knowledgeUploadCoordinator = new KnowledgeUploadCoordinator({
    repository: knowledgeUploadRepository,
    capacity: new KnowledgeUploadCapacity({
      storagePath: join(options.dataDir, 'pb_data', 'storage'),
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
    searchIndexer,
    consumeReauthenticationProof: (requestId, context) =>
      commandProcessor.consumeReauthenticationProof(requestId, context),
  });
  const serverQueue = new PrivilegedServerQueue({
    pb: options.serverClient as unknown as PrivilegedServerPocketBase,
    commandProcessor,
    pairingService,
  });
  await serverQueue.start();
  startKnowledgeSearchIndexerBestEffort(searchIndexer);
  return {
    commandProcessor,
    pairingService,
    searchIndexer,
    setAuthorityChangedHandler: (handler) => {
      authorityChanged = handler;
    },
    dispose: async () => {
      try {
        await serverQueue.dispose();
      } finally {
        try {
          await knowledgeCommands.dispose();
        } finally {
          await searchIndexer.dispose();
        }
      }
    },
  };
}

function createServerRuntime(options: {
  production: ProductionPrivilegedRuntimeOptions & { serverClient: PocketBase };
  shared: ProductionServerSharedResources;
  source: PrivilegedRuntimeSource;
  deviceStore: PrivilegedDeviceKeyStore;
  additionalDisposable?: { dispose(): void | Promise<void> };
  ownsPairingService: boolean;
}): PrivilegedRuntime {
  const serverUrl = `http://127.0.0.1:${(options.production.config as { port: number }).port}`;
  const authClient = new PrivilegedPocketBaseClient({ serverUrl, allowInsecureHttp: true });
  return new PrivilegedRuntime({
    ...(options.additionalDisposable ? { additionalDisposable: options.additionalDisposable } : {}),
    authClient,
    commandProcessor: options.shared.commandProcessor,
    deviceStore: options.deviceStore,
    hostname: options.production.hostname ?? getHostname(),
    localSource: options.source,
    mode: 'server',
    ownsPairingService: options.ownsPairingService,
    pairingService: options.shared.pairingService,
    resolvePairingTarget: (targetAccountId) =>
      resolveProductionPairingTarget(options.production.serverClient, targetAccountId),
    resolveAccountIdentity: (account) => resolveProductionIdentity(authClient, account),
  });
}

function createEphemeralServerDeviceStore(): PrivilegedDeviceKeyStore {
  const unavailable = async (): Promise<never> => {
    throw new TypeError('Ephemeral server sessions cannot create device keys.');
  };
  return {
    create: unavailable,
    load: async () => null,
    findForAccount: async () => null,
    bind: unavailable,
    remove: async () => undefined,
    removePending: async () => undefined,
    sign: unavailable,
  };
}

export async function createProductionPrivilegedHost(
  options: ProductionPrivilegedRuntimeOptions,
): Promise<ProductionPrivilegedHost> {
  if (options.config.mode !== 'server' || !options.serverClient) {
    throw new TypeError('Production privileged host requires server mode and PocketBase.');
  }
  const production = { ...options, serverClient: options.serverClient };
  const shared = await createProductionServerSharedResources(production);
  const electronDeviceStore = new PrivilegedDeviceStore({ dataDir: options.dataDir });
  const host = new ProductionPrivilegedHost({
    createRuntime: (source) =>
      createServerRuntime({
        production,
        shared,
        source,
        deviceStore:
          source.kind === 'electron' ? electronDeviceStore : createEphemeralServerDeviceStore(),
        ownsPairingService: false,
      }),
    disposeShared: async () => {
      try {
        await shared.dispose();
      } finally {
        shared.pairingService.dispose();
      }
    },
  });
  shared.setAuthorityChangedHandler((accountIds) => host.handleAuthorityChanged(accountIds));
  return host;
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
  const production = { ...options, serverClient: options.serverClient };
  const shared = await createProductionServerSharedResources(production);
  let runtime: PrivilegedRuntime | null = null;
  authClient.disconnect();
  runtime = createServerRuntime({
    production,
    shared,
    source: { kind: 'electron' },
    deviceStore,
    ownsPairingService: true,
    additionalDisposable: shared,
  });
  shared.setAuthorityChangedHandler((accountIds) => runtime?.handleAuthorityChanged(accountIds));
  return runtime;
}
