import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  IPC_CHANNELS,
  type PrivilegedIpcError,
  type PrivilegedIpcResult,
  type PrivilegedPairingCompletionView,
  type PrivilegedCredentialSetupView,
  type PrivilegedReauthenticationProof,
  type PublicPrivilegedCommandRequest,
  type PrivilegedApprovalRequestView,
} from '@shared/ipc';
import {
  PrivilegedLoginSchema,
  PrivilegedCredentialSetupSchema,
  PrivilegedInitialOwnerSetupSchema,
  PrivilegedPairingCompletionSchema,
  PrivilegedPairingTargetAccountSchema,
  PrivilegedReauthenticationSchema,
  PublicPrivilegedCommandRequestSchema,
} from '@shared/ipcValidation';
import {
  normalizePrivilegedSessionView,
  type PrivilegedPairingChallengeView,
  type PrivilegedSessionView,
} from '@shared/privilegedAccess';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';
import type { PrivilegedAccountManager } from '../privileged/PrivilegedAccountManager';
import { privilegedRateLimiters, type KeyedRateLimiter } from '../rateLimiter';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import type { WebApprovalCodeStore } from '../web/WebApprovalCodeStore';

const SIGNED_OUT_VIEW: PrivilegedSessionView = {
  state: 'signed-out',
  accountId: null,
  username: null,
  displayName: null,
  role: null,
  capabilities: [],
  deviceId: null,
  expiresAt: null,
};

export interface PrivilegedAccessRuntime {
  getView(): PrivilegedSessionView;
  login(input: { username: string; password: string }): Promise<PrivilegedSessionView>;
  logout(): Promise<void>;
  reauthenticate(password: string): Promise<PrivilegedReauthenticationProof>;
  createPairingChallenge(targetAccountId: string): Promise<PrivilegedPairingChallengeView>;
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
  getAccountManager?: () => Pick<
    PrivilegedAccountManager,
    'setupInitialAdministrator' | 'setupCredential'
  > | null;
  getApprovalCodes?: () => WebApprovalCodeStore | null;
  subscribeApprovalRequestsChanged?: (
    listener: (requests: PrivilegedApprovalRequestView[]) => void,
  ) => () => void;
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
    getAccountManager = () => null,
    getApprovalCodes = () => null,
    subscribeApprovalRequestsChanged = () => () => undefined,
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
    const limiterKey = `${parsed.data.username}:${runtime.getView().deviceId ?? 'unpaired'}`;
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

  ipcMain.handle(
    IPC_CHANNELS.PRIVILEGED_CREATE_PAIRING_CHALLENGE,
    async (event, input: unknown) => {
      if (!trusted(event, IPC_CHANNELS.PRIVILEGED_CREATE_PAIRING_CHALLENGE) || !isServer()) {
        return failure('unauthorized');
      }
      const parsed = PrivilegedPairingTargetAccountSchema.safeParse(input);
      if (!parsed.success) return failure('invalid-input');
      const runtime = getRuntime();
      if (!runtime) return failure('offline');
      try {
        return success(await runtime.createPairingChallenge(parsed.data));
      } catch (error) {
        return failure(mappedError(error, 'server-error'));
      }
    },
  );

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

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_SETUP_INITIAL_ADMIN, async (event, input: unknown) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_SETUP_INITIAL_ADMIN) || !isServer()) {
      return failure('unauthorized');
    }
    const parsed = PrivilegedInitialOwnerSetupSchema.safeParse(input);
    if (!parsed.success) return failure('invalid-input');
    const manager = getAccountManager();
    if (!manager) return failure('offline');
    try {
      return success<PrivilegedCredentialSetupView>(
        await manager.setupInitialAdministrator({
          username: parsed.data.username,
          password: parsed.data.password,
          passwordConfirm: parsed.data.passwordConfirm,
        }),
      );
    } catch {
      return failure('server-error');
    }
  });

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_SETUP_CREDENTIAL, async (event, input: unknown) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_SETUP_CREDENTIAL) || !isServer()) {
      return failure('unauthorized');
    }
    const parsed = PrivilegedCredentialSetupSchema.safeParse(input);
    if (!parsed.success) return failure('invalid-input');
    const runtime = getRuntime();
    const view = runtime?.getView();
    if (
      !runtime ||
      view?.state !== 'active' ||
      (view.role !== 'owner' && view.role !== 'admin') ||
      view.deviceId !== null ||
      !view.accountId
    ) {
      return failure('unauthorized');
    }
    const manager = getAccountManager();
    if (!manager) return failure('offline');
    try {
      return success<PrivilegedCredentialSetupView>(
        await manager.setupCredential({
          actorAccountId: view.accountId,
          accountId: parsed.data.accountId,
          password: parsed.data.password,
          passwordConfirm: parsed.data.passwordConfirm,
        }),
      );
    } catch {
      return failure('server-error');
    }
  });

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_APPROVAL_LIST, (event) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_APPROVAL_LIST) || !isServer()) return [];
    return getApprovalCodes()?.listPending() ?? [];
  });

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_APPROVAL_GENERATE, (event, input: unknown) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_APPROVAL_GENERATE) || !isServer()) {
      return failure('unauthorized');
    }
    const parsed = PrivilegedPairingTargetAccountSchema.safeParse(input);
    if (!parsed.success) return failure('invalid-input');
    const issued = getApprovalCodes()?.generate(parsed.data);
    return issued ? success(issued) : failure('unauthorized');
  });

  ipcMain.handle(IPC_CHANNELS.PRIVILEGED_APPROVAL_CANCEL, (event, input: unknown) => {
    if (!trusted(event, IPC_CHANNELS.PRIVILEGED_APPROVAL_CANCEL) || !isServer()) return false;
    const parsed = PrivilegedPairingTargetAccountSchema.safeParse(input);
    return parsed.success ? (getApprovalCodes()?.cancel(parsed.data) ?? false) : false;
  });

  const stopSession = subscribeSessionChanged((view) => {
    const normalized = normalizePrivilegedSessionView(view);
    if (normalized) broadcast(IPC_CHANNELS.PRIVILEGED_SESSION_CHANGED, normalized);
  });
  const stopApprovals = subscribeApprovalRequestsChanged((requests) => {
    broadcast(IPC_CHANNELS.PRIVILEGED_APPROVAL_CHANGED, requests);
  });
  return () => {
    stopSession();
    stopApprovals();
  };
}
