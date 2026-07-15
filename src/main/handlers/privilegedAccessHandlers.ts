import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  IPC_CHANNELS,
  type PrivilegedIpcError,
  type PrivilegedIpcResult,
  type PrivilegedPairingCompletionView,
  type PrivilegedReauthenticationProof,
  type PublicPrivilegedCommandRequest,
} from '@shared/ipc';
import {
  PrivilegedLoginSchema,
  PrivilegedPairingCompletionSchema,
  PrivilegedReauthenticationSchema,
  PublicPrivilegedCommandRequestSchema,
} from '@shared/ipcValidation';
import {
  normalizePrivilegedSessionView,
  type PrivilegedPairingChallengeView,
  type PrivilegedSessionView,
} from '@shared/privilegedAccess';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';
import { privilegedRateLimiters, type KeyedRateLimiter } from '../rateLimiter';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';

const SIGNED_OUT_VIEW: PrivilegedSessionView = {
  state: 'signed-out',
  accountId: null,
  operatorId: null,
  operatorName: null,
  role: null,
  capabilities: [],
  deviceId: null,
  expiresAt: null,
};

export interface PrivilegedAccessRuntime {
  getView(): PrivilegedSessionView;
  login(input: { operatorId: string; password: string }): Promise<PrivilegedSessionView>;
  logout(): Promise<void>;
  lock(): void;
  reauthenticate(password: string): Promise<PrivilegedReauthenticationProof>;
  createPairingChallenge(): Promise<PrivilegedPairingChallengeView>;
  completePairing(input: {
    challengeId: string;
    code: string;
    deviceLabel: string;
  }): Promise<PrivilegedPairingCompletionView>;
  submitPublicCommand(input: PublicPrivilegedCommandRequest): Promise<PrivilegedCommandResult>;
}

type TrustedSenderCheck = (event: IpcMainInvokeEvent, channel: string) => boolean;

export type PrivilegedAccessHandlerOptions = {
  ipcMain: Pick<IpcMain, 'handle'>;
  getRuntime: () => PrivilegedAccessRuntime | null;
  isServer: () => boolean;
  assertTrustedIpcSender: TrustedSenderCheck;
  broadcast?: (channel: string, value: unknown) => void;
  subscribeSessionChanged?: (listener: (view: unknown) => void) => () => void;
  loginLimiter?: KeyedRateLimiter;
};

function publicView(value: unknown): PrivilegedSessionView {
  return normalizePrivilegedSessionView(value) ?? { ...SIGNED_OUT_VIEW, capabilities: [] };
}

function failure<T>(error: PrivilegedIpcError): PrivilegedIpcResult<T> {
  return { ok: false, error };
}

function success<T>(value: T): PrivilegedIpcResult<T> {
  return { ok: true, value };
}

function mappedError(error: unknown, fallback: PrivilegedIpcError): PrivilegedIpcError {
  if (error === null || typeof error !== 'object' || !('code' in error)) return fallback;
  const code = (error as { code?: unknown }).code;
  const allowed = new Set<PrivilegedIpcError>([
    'invalid-input',
    'invalid-credentials',
    'unauthorized',
    'locked',
    'offline',
    'pairing-required',
    'conflict',
    'server-error',
  ]);
  return typeof code === 'string' && allowed.has(code as PrivilegedIpcError)
    ? (code as PrivilegedIpcError)
    : fallback;
}

export function setupPrivilegedAccessHandlers(options: PrivilegedAccessHandlerOptions): () => void {
  const {
    ipcMain,
    getRuntime,
    isServer,
    assertTrustedIpcSender,
    broadcast = broadcastToAllWindows,
    subscribeSessionChanged = () => () => undefined,
    loginLimiter = privilegedRateLimiters.login,
  } = options;
  const trusted = (event: IpcMainInvokeEvent, channel: string) =>
    assertTrustedIpcSender(event, channel);

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_GET_SESSION, (event) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_GET_SESSION)) return publicView(null);
    return publicView(getRuntime()?.getView());
  });

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_LOGIN, async (event, input: unknown) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_LOGIN)) return failure('unauthorized');
    const parsed = PrivilegedLoginSchema.safeParse(input);
    if (!parsed.success) return failure('invalid-input');
    const runtime = getRuntime();
    if (!runtime) return failure('offline');
    const limiterKey = `${parsed.data.operatorId}:${runtime.getView().deviceId ?? 'unpaired'}`;
    if (!loginLimiter.tryConsume(limiterKey).allowed) return failure('conflict');
    try {
      return success(publicView(await runtime.login(parsed.data)));
    } catch (error) {
      return failure(mappedError(error, 'invalid-credentials'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_LOGOUT, async (event) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_LOGOUT)) return failure('unauthorized');
    const runtime = getRuntime();
    if (!runtime) return publicView(null);
    await runtime.logout();
    return publicView(runtime.getView());
  });

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_LOCK, (event) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_LOCK)) return failure('unauthorized');
    const runtime = getRuntime();
    if (!runtime) return publicView(null);
    runtime.lock();
    return publicView(runtime.getView());
  });

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_REAUTHENTICATE, async (event, input: unknown) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_REAUTHENTICATE)) {
      return failure('unauthorized');
    }
    const parsed = PrivilegedReauthenticationSchema.safeParse(input);
    if (!parsed.success) return failure('invalid-input');
    const runtime = getRuntime();
    if (!runtime) return failure('offline');
    try {
      return success(await runtime.reauthenticate(parsed.data.password));
    } catch (error) {
      return failure(mappedError(error, 'unauthorized'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_CREATE_PAIRING_CHALLENGE, async (event) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_CREATE_PAIRING_CHALLENGE) || !isServer()) {
      return failure('unauthorized');
    }
    const runtime = getRuntime();
    if (!runtime) return failure('offline');
    try {
      return success(await runtime.createPairingChallenge());
    } catch (error) {
      return failure(mappedError(error, 'server-error'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_COMPLETE_PAIRING, async (event, input: unknown) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_COMPLETE_PAIRING)) {
      return failure('unauthorized');
    }
    const parsed = PrivilegedPairingCompletionSchema.safeParse(input);
    if (!parsed.success) return failure('invalid-input');
    const runtime = getRuntime();
    if (!runtime) return failure('offline');
    try {
      return success(await runtime.completePairing(parsed.data));
    } catch (error) {
      return failure(mappedError(error, 'server-error'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_SUBMIT_COMMAND, async (event, input: unknown) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_SUBMIT_COMMAND)) {
      return { ok: false, error: 'unauthorized' } satisfies PrivilegedCommandResult;
    }
    const parsed = PublicPrivilegedCommandRequestSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: 'invalid-request' } satisfies PrivilegedCommandResult;
    }
    const runtime = getRuntime();
    if (!runtime) return { ok: false, error: 'offline' } satisfies PrivilegedCommandResult;
    try {
      return await runtime.submitPublicCommand(parsed.data);
    } catch {
      return { ok: false, error: 'server-error' } satisfies PrivilegedCommandResult;
    }
  });

  return subscribeSessionChanged((view) => {
    const normalized = normalizePrivilegedSessionView(view);
    if (normalized) broadcast(IPC_CHANNELS.PRIVILEGED_SESSION_CHANGED, normalized);
  });
}
