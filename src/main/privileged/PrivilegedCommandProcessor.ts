import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import {
  getPrivilegedCapabilities,
  type PrivilegedCapability,
  type PrivilegedRole,
  type PrivilegedSessionView,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import {
  MAX_PRIVILEGED_REQUEST_ID_LENGTH,
  canonicalPrivilegedSigningBytes,
  canonicalizePrivilegedValue,
  normalizePrivilegedCommandPayload,
  validateSignedPrivilegedCommandEnvelope,
  type PrivilegedCommandError,
  type PrivilegedCommandName,
  type PrivilegedCommandPayloadMap,
  type PrivilegedCommandResult,
  type PublicPrivilegedCommandName,
  type SignedPrivilegedCommandEnvelope,
} from '@shared/privilegedCommands';
import type { RelayOperatorRecord } from '@shared/operators';
import { createPrivilegedRateLimiters, type KeyedRateLimiter } from '../rateLimiter';

const IN_PROGRESS_RECOVERY_MS = 2 * 60 * 1_000;
const REAUTHENTICATION_PROOF_MS = 5 * 60 * 1_000;
const MAX_SAFE_RESULT_BYTES = 16 * 1_024;

export type PrivilegedCommandClaim = {
  requestId: string;
  accountId: string;
  deviceId: string | null;
  operatorId: string;
  roleClaim: PrivilegedRole;
  command: PrivilegedCommandName;
  issuedAt: string;
  expiresAt: string;
  expectedRevision: number | null;
  payload: PrivilegedCommandPayloadMap[PrivilegedCommandName];
  bodyHash: string;
  signature: string | null;
  state: 'processing';
};

export type StoredPrivilegedCommand = Omit<PrivilegedCommandClaim, 'state'> & {
  id: string;
  state: 'pending' | 'processing' | 'succeeded' | 'failed';
  result: unknown;
  safeError: PrivilegedCommandError | null;
  completedAt: string | null;
  updated: string;
};

export type PrivilegedCommandClaimResult =
  | { kind: 'created'; command: StoredPrivilegedCommand }
  | { kind: 'existing'; command: StoredPrivilegedCommand };

export type PrivilegedCommandCompletion = {
  state: 'succeeded' | 'failed';
  result: unknown;
  safeError: PrivilegedCommandError | null;
  completedAt: string;
};

export interface PrivilegedCommandRepository {
  getAccount(accountId: string): Promise<RelayPrivilegedAccountRecord | null>;
  getOperator(operatorId: string): Promise<RelayOperatorRecord | null>;
  getState(): Promise<RelayPrivilegedStateRecord | null>;
  getDevice(accountId: string, deviceId: string): Promise<RelayPrivilegedDeviceRecord | null>;
  claimCommand(claim: PrivilegedCommandClaim): Promise<PrivilegedCommandClaimResult>;
  tryBeginCommand(
    commandId: string,
    bodyHash: string,
    staleBefore: string | null,
  ): Promise<boolean>;
  completeCommand(requestId: string, completion: PrivilegedCommandCompletion): Promise<void>;
  getCommand(requestId: string): Promise<StoredPrivilegedCommand | null>;
  consumeReauthenticationProof(requestId: string, consumedAt: string): Promise<boolean>;
}

export type PrivilegedAuthorizationContext = {
  account: RelayPrivilegedAccountRecord;
  operator: RelayOperatorRecord;
  state: RelayPrivilegedStateRecord;
  device: RelayPrivilegedDeviceRecord | null;
  role: PrivilegedRole;
};

export type PrivilegedCommandHandlerContext = PrivilegedAuthorizationContext & {
  capabilities: PrivilegedCapability[];
  requestId: string;
};

export type LocalPrivilegedCommand = {
  requestId?: string;
  accountId: string;
  operatorId: string;
  command: PrivilegedCommandName;
  payload: unknown;
  expectedRevision: number | null;
};

export type LocalPrivilegedCommandContext = {
  isServerMode: boolean;
  trustedLocalSender: boolean;
  session: PrivilegedSessionView;
};

export type PrivilegedCommandProcessorOptions = {
  repository: PrivilegedCommandRepository;
  now?: () => number;
  createId?: () => string;
  logger?: { warn(message: string, metadata?: Record<string, unknown>): void };
  capabilityResolver?: (context: PrivilegedAuthorizationContext) => PrivilegedCapability[];
  statusHandler?: (
    context: PrivilegedCommandHandlerContext,
    payload: PrivilegedCommandPayloadMap['privileged.status.read'],
  ) => Promise<unknown>;
  commandLimiter?: KeyedRateLimiter;
  knowledgeUploadCommandLimiter?: KeyedRateLimiter;
};

export type RegisteredPrivilegedCommandName = Exclude<
  PublicPrivilegedCommandName,
  'privileged.status.read'
>;

export type PrivilegedCommandHandler<K extends RegisteredPrivilegedCommandName> = (
  context: PrivilegedCommandHandlerContext,
  payload: PrivilegedCommandPayloadMap[K],
) => Promise<unknown>;

type RegisteredPrivilegedCommand = {
  capability: PrivilegedCapability;
  handler: PrivilegedCommandHandler<RegisteredPrivilegedCommandName>;
};

export class PrivilegedCommandConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super('Refresh administration data and try again.');
    this.name = 'PrivilegedCommandConflictError';
  }
}

export class PrivilegedCommandAuthorizationError extends Error {
  constructor() {
    super('Privileged authorization is required.');
    this.name = 'PrivilegedCommandAuthorizationError';
  }
}

export class PrivilegedCommandSafeError extends Error {
  constructor(readonly code: 'invalid-request' | 'insufficient-storage') {
    super('The privileged command could not be completed safely.');
    this.name = 'PrivilegedCommandSafeError';
  }
}

type NormalizedCommand = {
  requestId: string;
  accountId: string;
  deviceId: string | null;
  operatorId: string;
  roleClaim: PrivilegedRole;
  command: PrivilegedCommandName;
  payload: PrivilegedCommandPayloadMap[PrivilegedCommandName];
  payloadHash: string;
  expectedRevision: number | null;
  issuedAt: string;
  expiresAt: string;
  signature: string | null;
  bodyHash: string;
};

type AuthorizedCommand = {
  command: NormalizedCommand;
  context: PrivilegedCommandHandlerContext;
};

type AuthorizationResult =
  | { ok: true; authorized: AuthorizedCommand }
  | { ok: false; error: PrivilegedCommandError };

const silentLogger = { warn: () => undefined };

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function effectiveRole(
  account: RelayPrivilegedAccountRecord,
  state: RelayPrivilegedStateRecord,
): PrivilegedRole | null {
  if (state.adminOperatorId === account.operatorId) return 'admin';
  if (state.publisherOperatorId === account.operatorId) return 'publisher';
  return null;
}

function defaultCapabilityResolver(
  context: PrivilegedAuthorizationContext,
): PrivilegedCapability[] {
  return getPrivilegedCapabilities({
    active: context.account.active,
    assigned: true,
    role: context.role,
  });
}

function safeRequestId(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PRIVILEGED_REQUEST_ID_LENGTH
  ) {
    return undefined;
  }
  return value;
}

function errorResult(
  error: PrivilegedCommandError,
  requestId?: string,
  conflict?: { currentRevision: number },
): PrivilegedCommandResult<never> {
  const base = requestId ? { ok: false as const, requestId, error } : { ok: false as const, error };
  return conflict
    ? {
        ...base,
        message: 'Refresh administration data and try again.',
        currentRevision: conflict.currentRevision,
        refresh: true,
      }
    : base;
}

function normalizeSafeResult(value: unknown): unknown {
  const canonical = canonicalizePrivilegedValue(value);
  if (Buffer.byteLength(canonical, 'utf8') > MAX_SAFE_RESULT_BYTES) {
    throw new TypeError('Safe command result is too large.');
  }
  return JSON.parse(canonical) as unknown;
}

function parsePublicP256Key(
  value: string,
): { key: ReturnType<typeof createPublicKey>; fingerprint: string } | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record);
    const expected = new Set(['crv', 'kty', 'x', 'y']);
    if (
      keys.length !== expected.size ||
      !keys.every((key) => expected.has(key)) ||
      record.kty !== 'EC' ||
      record.crv !== 'P-256' ||
      typeof record.x !== 'string' ||
      typeof record.y !== 'string'
    ) {
      return null;
    }
    const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: record.x, y: record.y };
    const key = createPublicKey({ format: 'jwk', key: jwk });
    const spki = key.export({ format: 'der', type: 'spki' });
    return { key, fingerprint: sha256(spki) };
  } catch {
    return null;
  }
}

function normalizeLocalPayload(
  command: PrivilegedCommandName,
  payload: unknown,
): PrivilegedCommandPayloadMap[PrivilegedCommandName] | null {
  return normalizePrivilegedCommandPayload(command, payload);
}

function safeStoredError(value: PrivilegedCommandError | null): PrivilegedCommandError {
  const allowed = new Set<PrivilegedCommandError>([
    'unauthorized',
    'locked',
    'offline',
    'pairing-required',
    'invalid-request',
    'insufficient-storage',
    'expired',
    'replayed',
    'conflict',
    'server-error',
  ]);
  return value && allowed.has(value) ? value : 'server-error';
}

export class PrivilegedCommandProcessor {
  private readonly repository: PrivilegedCommandRepository;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly logger: NonNullable<PrivilegedCommandProcessorOptions['logger']>;
  private readonly capabilityResolver: NonNullable<
    PrivilegedCommandProcessorOptions['capabilityResolver']
  >;
  private readonly statusHandler: NonNullable<PrivilegedCommandProcessorOptions['statusHandler']>;
  private readonly commandLimiter: KeyedRateLimiter;
  private readonly knowledgeUploadCommandLimiter: KeyedRateLimiter;
  private readonly registeredCommands = new Map<
    RegisteredPrivilegedCommandName,
    RegisteredPrivilegedCommand
  >();

  constructor(options: PrivilegedCommandProcessorOptions) {
    this.repository = options.repository;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.logger = options.logger ?? silentLogger;
    this.capabilityResolver = options.capabilityResolver ?? defaultCapabilityResolver;
    this.statusHandler =
      options.statusHandler ??
      (async (context) => ({
        assignmentVersion: context.state.assignmentVersion,
        capabilities: context.capabilities,
        deviceRevision: context.device?.revision ?? null,
        role: context.role,
        status: 'ready',
      }));
    const rateLimiters = createPrivilegedRateLimiters();
    this.commandLimiter = options.commandLimiter ?? rateLimiters.signedCommand;
    this.knowledgeUploadCommandLimiter =
      options.knowledgeUploadCommandLimiter ?? rateLimiters.knowledgeUploadCommand;
  }

  registerCommand<K extends RegisteredPrivilegedCommandName>(
    command: K,
    capability: PrivilegedCapability,
    handler: PrivilegedCommandHandler<K>,
  ): void {
    this.registeredCommands.set(command, {
      capability,
      handler: handler as PrivilegedCommandHandler<RegisteredPrivilegedCommandName>,
    });
  }

  async process(value: unknown): Promise<PrivilegedCommandResult> {
    const validation = validateSignedPrivilegedCommandEnvelope(value, this.now());
    if (!validation.ok)
      return errorResult(
        validation.error,
        safeRequestId((value as Record<string, unknown>)?.requestId),
      );
    const { envelope } = validation;
    const requestId = envelope.requestId;
    try {
      if (sha256(canonicalizePrivilegedValue(envelope.payload)) !== envelope.payloadHash) {
        return errorResult('invalid-request', requestId);
      }
      const command = this.normalizeRemoteCommand(envelope);
      const authorization = await this.authorize(command, envelope);
      if (!authorization.ok) return errorResult(authorization.error, requestId);
      return await this.claimAndExecute(authorization.authorized);
    } catch {
      this.warnFailure(requestId, 'processing');
      return errorResult('server-error', requestId);
    }
  }

  async processLocal(
    input: LocalPrivilegedCommand,
    context: LocalPrivilegedCommandContext,
  ): Promise<PrivilegedCommandResult> {
    if (
      !context.isServerMode ||
      !context.trustedLocalSender ||
      context.session.state !== 'active'
    ) {
      return errorResult('unauthorized', safeRequestId(input.requestId));
    }
    const requestId = input.requestId ?? this.createId();
    if (
      !safeRequestId(requestId) ||
      context.session.accountId !== input.accountId ||
      context.session.operatorId !== input.operatorId ||
      context.session.role === null ||
      context.session.deviceId !== null ||
      context.session.expiresAt === null ||
      Date.parse(context.session.expiresAt) <= this.now()
    ) {
      return errorResult('unauthorized', safeRequestId(requestId));
    }
    const payload = normalizeLocalPayload(input.command, input.payload);
    if (!payload) return errorResult('invalid-request', requestId);
    const issuedAt = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + 60_000).toISOString();
    const signingBody = {
      version: 1,
      requestId,
      accountId: input.accountId,
      deviceId: null,
      roleClaim: context.session.role,
      command: input.command,
      payload,
      expectedRevision: input.expectedRevision,
      issuedAt,
      expiresAt,
    };
    const command: NormalizedCommand = {
      ...signingBody,
      operatorId: input.operatorId,
      payloadHash: sha256(canonicalizePrivilegedValue(payload)),
      signature: null,
      bodyHash: sha256(canonicalizePrivilegedValue(signingBody)),
    };
    try {
      const authorization = await this.authorize(command, null);
      if (!authorization.ok) return errorResult(authorization.error, requestId);
      return await this.claimAndExecute(authorization.authorized);
    } catch {
      this.warnFailure(requestId, 'local-processing');
      return errorResult('server-error', requestId);
    }
  }

  async consumeReauthenticationProof(
    requestId: string,
    context: { accountId: string; deviceId: string | null },
  ): Promise<boolean> {
    if (!safeRequestId(requestId)) return false;
    try {
      const command = await this.repository.getCommand(requestId);
      if (!command || !this.isUsableReauthenticationProof(command, context)) return false;
      return this.repository.consumeReauthenticationProof(
        requestId,
        new Date(this.now()).toISOString(),
      );
    } catch {
      this.warnFailure(requestId, 'proof-consumption');
      return false;
    }
  }

  private async authorize(
    command: NormalizedCommand,
    envelope: SignedPrivilegedCommandEnvelope | null,
  ): Promise<AuthorizationResult> {
    const account = await this.repository.getAccount(command.accountId);
    if (!account?.active) return { ok: false, error: 'unauthorized' };
    const operator = await this.repository.getOperator(account.operatorId);
    if (
      !operator?.active ||
      operator.id !== account.operatorId ||
      (command.operatorId.length > 0 && operator.id !== command.operatorId)
    ) {
      return { ok: false, error: 'unauthorized' };
    }
    const state = await this.repository.getState();
    if (!state) return { ok: false, error: 'unauthorized' };
    const role = effectiveRole(account, state);
    if (!role || role !== account.role || role !== command.roleClaim) {
      return { ok: false, error: 'unauthorized' };
    }

    const deviceResult = await this.authorizeDevice(account, command.deviceId, envelope);
    if (!deviceResult.ok) return deviceResult;
    const { device } = deviceResult;

    if (command.expectedRevision !== null && command.expectedRevision !== state.assignmentVersion) {
      return { ok: false, error: 'conflict' };
    }

    const authorization = { account, operator, state, device, role };
    const capabilities = [...new Set(this.capabilityResolver(authorization))];
    const requiredCapability = this.getRequiredCapability(command.command);
    if (!requiredCapability || !capabilities.includes(requiredCapability)) {
      return { ok: false, error: 'unauthorized' };
    }
    const limiterKey = command.deviceId ?? `local:${account.id}`;
    const limiter = command.command.startsWith('knowledge.upload.')
      ? this.knowledgeUploadCommandLimiter
      : this.commandLimiter;
    if (!limiter.tryConsume(limiterKey).allowed) {
      return { ok: false, error: 'conflict' };
    }
    return {
      ok: true,
      authorized: {
        command,
        context: { ...authorization, capabilities, requestId: command.requestId },
      },
    };
  }

  private getRequiredCapability(command: PrivilegedCommandName): PrivilegedCapability | null {
    if (command === 'privileged.status.read' || command === 'privileged.reauth.confirm') {
      return 'privileged.status.read';
    }
    return this.registeredCommands.get(command)?.capability ?? null;
  }

  private async authorizeDevice(
    account: RelayPrivilegedAccountRecord,
    deviceId: string | null,
    envelope: SignedPrivilegedCommandEnvelope | null,
  ): Promise<
    | { ok: true; device: RelayPrivilegedDeviceRecord | null }
    | { ok: false; error: 'invalid-request' | 'pairing-required' }
  > {
    if (deviceId === null) return { ok: true, device: null };
    const device = await this.repository.getDevice(account.id, deviceId);
    if (!device || device.state !== 'active' || device.accountId !== account.id) {
      return { ok: false, error: 'pairing-required' };
    }
    if (!envelope) return { ok: false, error: 'invalid-request' };
    const verificationError = this.getRemoteDeviceVerificationError(device, envelope);
    return verificationError ? { ok: false, error: verificationError } : { ok: true, device };
  }

  private getRemoteDeviceVerificationError(
    device: RelayPrivilegedDeviceRecord,
    envelope: SignedPrivilegedCommandEnvelope,
  ): 'invalid-request' | 'pairing-required' | null {
    const parsed = parsePublicP256Key(device.publicKey);
    if (!parsed || parsed.fingerprint !== device.fingerprint) {
      return 'pairing-required';
    }
    try {
      const verified = verifySignature(
        'sha256',
        canonicalPrivilegedSigningBytes(envelope),
        parsed.key,
        Buffer.from(envelope.signature, 'base64url'),
      );
      return verified ? null : 'invalid-request';
    } catch {
      return 'invalid-request';
    }
  }

  private normalizeRemoteCommand(envelope: SignedPrivilegedCommandEnvelope): NormalizedCommand {
    return {
      requestId: envelope.requestId,
      accountId: envelope.accountId,
      deviceId: envelope.deviceId,
      operatorId: '',
      roleClaim: envelope.roleClaim,
      command: envelope.command,
      payload: envelope.payload,
      payloadHash: envelope.payloadHash,
      expectedRevision: envelope.expectedRevision,
      issuedAt: envelope.issuedAt,
      expiresAt: envelope.expiresAt,
      signature: envelope.signature,
      bodyHash: sha256(canonicalPrivilegedSigningBytes(envelope)),
    };
  }

  private async claimAndExecute(authorized: AuthorizedCommand): Promise<PrivilegedCommandResult> {
    const { command, context } = authorized;
    command.operatorId = context.operator.id;
    const claim: PrivilegedCommandClaim = {
      requestId: command.requestId,
      accountId: command.accountId,
      deviceId: command.deviceId,
      operatorId: command.operatorId,
      roleClaim: command.roleClaim,
      command: command.command,
      issuedAt: command.issuedAt,
      expiresAt: command.expiresAt,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
      bodyHash: command.bodyHash,
      signature: command.signature,
      state: 'processing',
    };
    const claimResult = await this.repository.claimCommand(claim);
    if (claimResult.kind === 'existing') {
      const existingResult = await this.handleExistingCommand(
        claimResult.command,
        command.bodyHash,
      );
      if (existingResult) return existingResult;
    }
    return this.executeHandler(authorized);
  }

  private async handleExistingCommand(
    stored: StoredPrivilegedCommand,
    bodyHash: string,
  ): Promise<PrivilegedCommandResult | null> {
    if (stored.bodyHash !== bodyHash) return errorResult('replayed', stored.requestId);
    if (stored.state === 'succeeded') {
      try {
        return { ok: true, requestId: stored.requestId, value: normalizeSafeResult(stored.result) };
      } catch {
        return errorResult('server-error', stored.requestId);
      }
    }
    if (stored.state === 'failed') {
      const safeError = safeStoredError(stored.safeError);
      return errorResult(
        safeError,
        stored.requestId,
        safeError === 'conflict' ? this.getStoredConflict(stored.result) : undefined,
      );
    }
    const staleBefore = new Date(this.now() - IN_PROGRESS_RECOVERY_MS).toISOString();
    if (stored.state === 'processing' && Date.parse(stored.updated) > Date.parse(staleBefore)) {
      return errorResult('conflict', stored.requestId);
    }
    const began = await this.repository.tryBeginCommand(
      stored.id,
      bodyHash,
      stored.state === 'processing' ? staleBefore : null,
    );
    return began ? null : errorResult('conflict', stored.requestId);
  }

  private async executeHandler(authorized: AuthorizedCommand): Promise<PrivilegedCommandResult> {
    const { command, context } = authorized;
    try {
      const rawResult = await this.invokeHandler(command, context);
      const result = normalizeSafeResult(rawResult);
      await this.repository.completeCommand(command.requestId, {
        state: 'succeeded',
        result,
        safeError: null,
        completedAt: new Date(this.now()).toISOString(),
      });
      return { ok: true, requestId: command.requestId, value: result };
    } catch (error) {
      if (error instanceof PrivilegedCommandAuthorizationError) {
        await this.repository.completeCommand(command.requestId, {
          state: 'failed',
          result: null,
          safeError: 'unauthorized',
          completedAt: new Date(this.now()).toISOString(),
        });
        return errorResult('unauthorized', command.requestId);
      }
      if (error instanceof PrivilegedCommandConflictError) {
        const result = { currentRevision: error.currentRevision, refresh: true as const };
        await this.repository.completeCommand(command.requestId, {
          state: 'failed',
          result,
          safeError: 'conflict',
          completedAt: new Date(this.now()).toISOString(),
        });
        return errorResult('conflict', command.requestId, result);
      }
      if (error instanceof PrivilegedCommandSafeError) {
        await this.repository.completeCommand(command.requestId, {
          state: 'failed',
          result: null,
          safeError: error.code,
          completedAt: new Date(this.now()).toISOString(),
        });
        return errorResult(error.code, command.requestId);
      }
      this.warnFailure(command.requestId, 'handler');
      await this.repository.completeCommand(command.requestId, {
        state: 'failed',
        result: null,
        safeError: 'server-error',
        completedAt: new Date(this.now()).toISOString(),
      });
      return errorResult('server-error', command.requestId);
    }
  }

  private invokeHandler(
    command: NormalizedCommand,
    context: PrivilegedCommandHandlerContext,
  ): Promise<unknown> {
    if (command.command === 'privileged.status.read') {
      return this.statusHandler(
        context,
        command.payload as PrivilegedCommandPayloadMap['privileged.status.read'],
      );
    }
    if (command.command === 'privileged.reauth.confirm') {
      return Promise.resolve(this.createReauthenticationAttestation(command, context));
    }
    const registration = this.registeredCommands.get(command.command);
    if (!registration) return Promise.reject(new TypeError('Privileged command is unavailable.'));
    return registration.handler(context, command.payload);
  }

  private getStoredConflict(value: unknown): { currentRevision: number } | undefined {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const currentRevision = (value as Record<string, unknown>).currentRevision;
    return Number.isInteger(currentRevision) && (currentRevision as number) >= 0
      ? { currentRevision: currentRevision as number }
      : undefined;
  }

  private createReauthenticationAttestation(
    command: NormalizedCommand,
    context: PrivilegedCommandHandlerContext,
  ): { accountId: string; deviceId: string | null; authenticatedAt: string } {
    const payload = command.payload as PrivilegedCommandPayloadMap['privileged.reauth.confirm'];
    const authenticatedAtMs = Date.parse(payload.authenticatedAt);
    if (
      authenticatedAtMs > this.now() + 60_000 ||
      authenticatedAtMs < this.now() - IN_PROGRESS_RECOVERY_MS
    ) {
      throw new TypeError('Invalid reauthentication timestamp.');
    }
    return {
      accountId: context.account.id,
      deviceId: context.device?.deviceId ?? null,
      authenticatedAt: payload.authenticatedAt,
    };
  }

  private isUsableReauthenticationProof(
    command: StoredPrivilegedCommand,
    context: { accountId: string; deviceId: string | null },
  ): boolean {
    if (
      command.command !== 'privileged.reauth.confirm' ||
      command.state !== 'succeeded' ||
      command.accountId !== context.accountId ||
      command.deviceId !== context.deviceId ||
      !command.completedAt
    ) {
      return false;
    }
    const completedAt = Date.parse(command.completedAt);
    if (
      !Number.isFinite(completedAt) ||
      completedAt > this.now() ||
      completedAt < this.now() - REAUTHENTICATION_PROOF_MS
    ) {
      return false;
    }
    if (
      command.result === null ||
      typeof command.result !== 'object' ||
      Array.isArray(command.result)
    ) {
      return false;
    }
    const result = command.result as Record<string, unknown>;
    return (
      Object.keys(result).length === 3 &&
      result.accountId === context.accountId &&
      result.deviceId === context.deviceId &&
      typeof result.authenticatedAt === 'string'
    );
  }

  private warnFailure(requestId: string, phase: string): void {
    this.logger.warn('Privileged command failed safely.', {
      error: 'server-error',
      phase,
      requestId,
    });
  }
}
