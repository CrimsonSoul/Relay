import type { BridgeAPI } from '@shared/ipc';
import {
  WebPrivilegedCommandResultSchema,
  WebPrivilegedCredentialSetupViewSchema,
  WebPrivilegedPairingChallengeSchema,
  WebPrivilegedReauthenticationProofSchema,
  WebPrivilegedSessionSchema,
  webPrivilegedIpcResultSchema,
} from '@shared/webApi';
import {
  noopSubscription,
  privilegedUnavailable,
  validatedRequest,
  type WebBridgeContext,
} from './context';

export type PrivilegedWebApi = Pick<
  BridgeAPI,
  | 'getPrivilegedSession'
  | 'loginPrivileged'
  | 'logoutPrivileged'
  | 'reauthenticatePrivileged'
  | 'createPrivilegedPairingChallenge'
  | 'completePrivilegedPairing'
  | 'submitPrivilegedCommand'
  | 'setupInitialAdministratorCredential'
  | 'setupPrivilegedCredential'
  | 'onPrivilegedSessionChanged'
  | 'listWebApprovalRequests'
  | 'generateWebApprovalCode'
  | 'cancelWebApprovalRequest'
  | 'onWebApprovalRequestsChanged'
>;

export function createPrivilegedWebApi({ request, subscribe }: WebBridgeContext): PrivilegedWebApi {
  return {
    getPrivilegedSession: () =>
      validatedRequest(
        request,
        '/privileged/session',
        { method: 'GET' },
        WebPrivilegedSessionSchema,
      ),
    loginPrivileged: (input) =>
      validatedRequest(
        request,
        '/privileged/login',
        { method: 'POST', body: input },
        webPrivilegedIpcResultSchema(WebPrivilegedSessionSchema),
      ),
    logoutPrivileged: () =>
      validatedRequest(
        request,
        '/privileged/logout',
        { method: 'POST' },
        WebPrivilegedSessionSchema,
      ),
    reauthenticatePrivileged: (input) =>
      validatedRequest(
        request,
        '/privileged/reauthenticate',
        { method: 'POST', body: input },
        webPrivilegedIpcResultSchema(WebPrivilegedReauthenticationProofSchema),
      ),
    createPrivilegedPairingChallenge: (targetAccountId) =>
      validatedRequest(
        request,
        '/privileged/pairing-challenge',
        { method: 'POST', body: { targetAccountId } },
        webPrivilegedIpcResultSchema(WebPrivilegedPairingChallengeSchema),
      ),
    completePrivilegedPairing: async () => privilegedUnavailable(),
    submitPrivilegedCommand: (input) =>
      validatedRequest(
        request,
        '/privileged/commands',
        { method: 'POST', body: input },
        WebPrivilegedCommandResultSchema,
      ),
    setupInitialAdministratorCredential: (input) =>
      validatedRequest(
        request,
        '/privileged/initial-owner',
        { method: 'POST', body: input },
        webPrivilegedIpcResultSchema(WebPrivilegedCredentialSetupViewSchema),
      ),
    setupPrivilegedCredential: (input) =>
      validatedRequest(
        request,
        '/privileged/credential',
        { method: 'POST', body: input },
        webPrivilegedIpcResultSchema(WebPrivilegedCredentialSetupViewSchema),
      ),
    onPrivilegedSessionChanged: (callback) => subscribe('privileged-session-changed', callback),
    listWebApprovalRequests: async () => [],
    generateWebApprovalCode: async () => ({ ok: false, error: 'unauthorized' }),
    cancelWebApprovalRequest: async () => false,
    onWebApprovalRequestsChanged: noopSubscription,
  } satisfies PrivilegedWebApi;
}
