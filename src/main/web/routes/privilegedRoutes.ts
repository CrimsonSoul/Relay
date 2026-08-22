import type {
  PrivilegedCredentialSetupView,
  PrivilegedIpcError,
  PrivilegedIpcResult,
} from '@shared/ipc';
import {
  PrivilegedCredentialSetupSchema,
  PrivilegedInitialOwnerSetupSchema,
  PrivilegedLoginSchema,
  PrivilegedReauthenticationSchema,
  PublicPrivilegedCommandRequestSchema,
} from '@shared/ipcValidation';
import { z } from 'zod';
import type { PrivilegedAccessRuntime } from '../../handlers/privilegedAccessHandlers';
import type { PrivilegedAccountManager } from '../../privileged/PrivilegedAccountManager';
import type {
  WebApprovalCodeStore,
  WebApprovalOperation,
  WebApprovalRequest,
} from '../WebApprovalCodeStore';
import type { WebRouteContext, WebRouter } from '../WebRouter';

const PairingTargetSchema = z.object({ targetAccountId: z.string().min(1).max(200) }).strict();

export type WebPrivilegedRouteSession = {
  runtime: PrivilegedAccessRuntime;
  sourceLabel: string;
};

type AccountManagerPort = Pick<
  PrivilegedAccountManager,
  'setupInitialAdministrator' | 'setupCredential'
>;

export type PrivilegedRouteOptions = {
  getSession(logicalSessionId: string, context: WebRouteContext): WebPrivilegedRouteSession | null;
  approvalCodes: WebApprovalCodeStore;
  getAccountManager(): AccountManagerPort | null;
};

function failure<T>(
  error: PrivilegedIpcError,
  approvalRequest?: WebApprovalRequest,
): PrivilegedIpcResult<T> {
  return {
    ok: false,
    error,
    ...(approvalRequest ? { approvalRequest } : {}),
  };
}

function mappedError(error: unknown, fallback: PrivilegedIpcError): PrivilegedIpcError {
  if (!error || typeof error !== 'object' || !('code' in error)) return fallback;
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

// Everything privileged is keyed on the logical session id: an approval code issued before a
// /session/refresh must still be consumable afterwards, and the cookie has rotated by then.
function routeSession(
  options: PrivilegedRouteOptions,
  context: WebRouteContext,
): WebPrivilegedRouteSession | null {
  return context.logicalSessionId ? options.getSession(context.logicalSessionId, context) : null;
}

function approvalRequired(
  options: PrivilegedRouteOptions,
  session: WebPrivilegedRouteSession,
  logicalSessionId: string,
  operation: WebApprovalOperation,
  input: { approvalRequestId?: string; approvalCode?: string },
): WebApprovalRequest | null {
  if (
    input.approvalRequestId &&
    input.approvalCode &&
    options.approvalCodes.consume({
      requestId: input.approvalRequestId,
      sessionId: logicalSessionId,
      operation,
      code: input.approvalCode,
    })
  ) {
    return null;
  }
  const existing = input.approvalRequestId
    ? options.approvalCodes.getForSession(input.approvalRequestId, logicalSessionId, operation)
    : null;
  return (
    existing ??
    options.approvalCodes.request({
      sessionId: logicalSessionId,
      operation,
      sourceLabel: session.sourceLabel,
    })
  );
}

export function registerPrivilegedRoutes(router: WebRouter, options: PrivilegedRouteOptions): void {
  router.register({
    method: 'GET',
    path: '/relay-api/v1/privileged/session',
    authenticated: true,
    handler: async (context) => {
      const session = routeSession(options, context);
      return session
        ? { status: 200, body: session.runtime.getView() }
        : { status: 503, body: { ...failure('offline') } };
    },
  });

  router.register({
    method: 'POST',
    path: '/relay-api/v1/privileged/login',
    authenticated: true,
    csrf: true,
    bodySchema: PrivilegedLoginSchema,
    rateLimit: { bucket: 'privileged-login', key: 'ip', limit: 10, windowMs: 60_000 },
    handler: async (context) => {
      const session = routeSession(options, context);
      if (!session) return { status: 200, body: failure('offline') };
      try {
        return {
          status: 200,
          body: { ok: true, value: await session.runtime.login(context.body) },
        };
      } catch (error) {
        return { status: 200, body: failure(mappedError(error, 'invalid-credentials')) };
      }
    },
  });

  router.register({
    method: 'POST',
    path: '/relay-api/v1/privileged/logout',
    authenticated: true,
    csrf: true,
    handler: async (context) => {
      const session = routeSession(options, context);
      if (!session) return { status: 200, body: failure('offline') };
      await session.runtime.logout();
      return { status: 200, body: session.runtime.getView() };
    },
  });

  router.register({
    method: 'POST',
    path: '/relay-api/v1/privileged/reauthenticate',
    authenticated: true,
    csrf: true,
    bodySchema: PrivilegedReauthenticationSchema,
    rateLimit: { bucket: 'privileged-reauth', key: 'session', limit: 10, windowMs: 60_000 },
    handler: async (context) => {
      const session = routeSession(options, context);
      if (!session) return { status: 200, body: failure('offline') };
      try {
        return {
          status: 200,
          body: { ok: true, value: await session.runtime.reauthenticate(context.body.password) },
        };
      } catch (error) {
        return { status: 200, body: failure(mappedError(error, 'unauthorized')) };
      }
    },
  });

  router.register({
    method: 'POST',
    path: '/relay-api/v1/privileged/pairing-challenge',
    authenticated: true,
    csrf: true,
    capability: 'devices.manage',
    bodySchema: PairingTargetSchema,
    rateLimit: { bucket: 'privileged-pairing', key: 'session', limit: 10, windowMs: 60_000 },
    handler: async (context) => {
      const session = routeSession(options, context);
      if (!session) return { status: 200, body: failure('offline') };
      try {
        return {
          status: 200,
          body: {
            ok: true,
            value: await session.runtime.createPairingChallenge(context.body.targetAccountId),
          },
        };
      } catch (error) {
        return { status: 200, body: failure(mappedError(error, 'server-error')) };
      }
    },
  });

  router.register({
    method: 'POST',
    path: '/relay-api/v1/privileged/commands',
    authenticated: true,
    csrf: true,
    bodySchema: PublicPrivilegedCommandRequestSchema,
    rateLimit: { bucket: 'privileged-command', key: 'session', limit: 120, windowMs: 60_000 },
    handler: async (context) => {
      const session = routeSession(options, context);
      if (!session) return { status: 200, body: { ok: false, error: 'offline' } };
      try {
        return { status: 200, body: await session.runtime.submitPublicCommand(context.body) };
      } catch {
        return { status: 200, body: { ok: false, error: 'server-error' } };
      }
    },
  });

  router.register({
    method: 'POST',
    path: '/relay-api/v1/privileged/initial-owner',
    authenticated: true,
    csrf: true,
    bodySchema: PrivilegedInitialOwnerSetupSchema,
    rateLimit: { bucket: 'privileged-approval', key: 'session', limit: 10, windowMs: 60_000 },
    handler: async (context) => {
      const session = routeSession(options, context);
      if (!session || !context.logicalSessionId) return { status: 200, body: failure('offline') };
      const pending = approvalRequired(
        options,
        session,
        context.logicalSessionId,
        'initial-owner-credential',
        context.body,
      );
      if (pending) return { status: 200, body: failure('approval-required', pending) };
      const manager = options.getAccountManager();
      if (!manager) return { status: 200, body: failure('offline') };
      try {
        const value: PrivilegedCredentialSetupView = await manager.setupInitialAdministrator({
          username: context.body.username,
          password: context.body.password,
          passwordConfirm: context.body.passwordConfirm,
        });
        return { status: 200, body: { ok: true, value } };
      } catch {
        return { status: 200, body: failure('server-error') };
      }
    },
  });

  router.register({
    method: 'POST',
    path: '/relay-api/v1/privileged/credential',
    authenticated: true,
    csrf: true,
    bodySchema: PrivilegedCredentialSetupSchema,
    rateLimit: { bucket: 'privileged-approval', key: 'session', limit: 10, windowMs: 60_000 },
    handler: async (context) => {
      const session = routeSession(options, context);
      if (!session || !context.logicalSessionId) return { status: 200, body: failure('offline') };
      const view = session.runtime.getView();
      if (
        view.state !== 'active' ||
        !view.accountId ||
        (view.role !== 'owner' && view.role !== 'admin') ||
        view.deviceId !== null
      ) {
        return { status: 200, body: failure('unauthorized') };
      }
      const pending = approvalRequired(
        options,
        session,
        context.logicalSessionId,
        'credential-recovery',
        context.body,
      );
      if (pending) return { status: 200, body: failure('approval-required', pending) };
      const manager = options.getAccountManager();
      if (!manager) return { status: 200, body: failure('offline') };
      try {
        const value: PrivilegedCredentialSetupView = await manager.setupCredential({
          actorAccountId: view.accountId,
          accountId: context.body.accountId,
          password: context.body.password,
          passwordConfirm: context.body.passwordConfirm,
        });
        return { status: 200, body: { ok: true, value } };
      } catch {
        return { status: 200, body: failure('server-error') };
      }
    },
  });
}
