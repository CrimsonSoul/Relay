import {
  MAX_PRIVILEGED_PASSWORD_LENGTH,
  MIN_PRIVILEGED_PASSWORD_LENGTH,
  getPrivilegedCapabilities,
  type PrivilegedRole,
  type PrivilegedSessionView,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { getEffectiveRole } from '@shared/roleAccounts';
import type { PrivilegedAuthClient } from './PrivilegedPocketBaseClient';

export const PRIVILEGED_REAUTH_PROOF_MS = 5 * 60 * 1_000;

export type PrivilegedSessionErrorCode = 'invalid-input' | 'offline' | 'unauthorized';

export class PrivilegedSessionError extends Error {
  constructor(readonly code: PrivilegedSessionErrorCode) {
    super(messageForSessionError(code));
    this.name = 'PrivilegedSessionError';
  }
}

export type PrivilegedAuthorization = {
  assigned: boolean;
  paired: boolean;
  deviceId: string | null;
  role: PrivilegedRole | null;
};

type ReauthenticationConfirmation = {
  accountId: string;
  username: string;
  displayName: string;
  role: PrivilegedRole;
  deviceId: string | null;
  authenticatedAt: string;
};

type PrivilegedSessionManagerOptions = {
  authClient: PrivilegedAuthClient;
  resolveAuthorization(account: RelayPrivilegedAccountRecord): Promise<PrivilegedAuthorization>;
  confirmReauthentication(input: ReauthenticationConfirmation): Promise<{ requestId: string }>;
  now?: () => number;
  onViewChanged?: (view: PrivilegedSessionView) => void;
};

export interface PrivilegedSessionManagerService {
  getView(): PrivilegedSessionView;
  login(input: { username: string; password: string }): Promise<PrivilegedSessionView>;
  reauthenticate(password: string): Promise<{ proofId: string; expiresAt: string }>;
  activatePairedDevice(deviceId: string): PrivilegedSessionView;
  logout(): void;
  dispose(): void;
}

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

function messageForSessionError(code: PrivilegedSessionErrorCode): string {
  switch (code) {
    case 'invalid-input':
      return 'The privileged sign-in request is invalid.';
    case 'offline':
      return 'Privileged access is unavailable while Relay is offline.';
    case 'unauthorized':
      return 'Unable to authorize this privileged account.';
  }
}

function publicCopy(view: PrivilegedSessionView): PrivilegedSessionView {
  return { ...view, capabilities: [...view.capabilities] };
}

function validatePassword(password: string): void {
  if (
    typeof password !== 'string' ||
    password.length < MIN_PRIVILEGED_PASSWORD_LENGTH ||
    password.length > MAX_PRIVILEGED_PASSWORD_LENGTH
  ) {
    throw new PrivilegedSessionError('invalid-input');
  }
}

function validateUsername(username: string): string {
  const normalized = username.trim().toLocaleLowerCase('en');
  if (normalized.length < 3 || normalized.length > 64 || !/^[a-z0-9._-]+$/.test(normalized)) {
    throw new PrivilegedSessionError('invalid-input');
  }
  return normalized;
}

function validateIdentifier(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
  ) {
    throw new PrivilegedSessionError('invalid-input');
  }
  return normalized;
}

function isSameAccount(
  current: RelayPrivilegedAccountRecord,
  changed: RelayPrivilegedAccountRecord | null,
): changed is RelayPrivilegedAccountRecord {
  return (
    changed !== null &&
    changed.active &&
    changed.id === current.id &&
    changed.username === current.username &&
    changed.storedRole === current.storedRole &&
    changed.credentialVersion === current.credentialVersion
  );
}

export class PrivilegedSessionManager implements PrivilegedSessionManagerService {
  private readonly authClient: PrivilegedAuthClient;
  private readonly resolveAuthorization: PrivilegedSessionManagerOptions['resolveAuthorization'];
  private readonly confirmReauthentication: PrivilegedSessionManagerOptions['confirmReauthentication'];
  private readonly now: () => number;
  private readonly onViewChanged?: (view: PrivilegedSessionView) => void;
  private view = publicCopy(SIGNED_OUT_VIEW);
  private account: RelayPrivilegedAccountRecord | null = null;
  private disposed = false;
  private operationGeneration = 0;

  constructor(options: PrivilegedSessionManagerOptions) {
    this.authClient = options.authClient;
    this.resolveAuthorization = options.resolveAuthorization;
    this.confirmReauthentication = options.confirmReauthentication;
    this.now = options.now ?? Date.now;
    this.onViewChanged = options.onViewChanged;
  }

  getView(): PrivilegedSessionView {
    return publicCopy(this.view);
  }

  async login(input: { username: string; password: string }): Promise<PrivilegedSessionView> {
    this.assertNotDisposed();
    const username = validateUsername(input.username);
    validatePassword(input.password);
    const operation = this.beginOperation();
    let account: RelayPrivilegedAccountRecord;
    try {
      account = await this.authClient.authenticate(username, input.password);
    } catch (error) {
      if (!this.isOperationCurrent(operation)) {
        throw new PrivilegedSessionError('unauthorized');
      }
      if (isOfflineAuthenticationError(error)) {
        this.invalidateSession({ ...SIGNED_OUT_VIEW, state: 'offline' });
        throw new PrivilegedSessionError('offline');
      }
      this.invalidateSession();
      throw error;
    }
    this.assertOperationCurrent(operation);

    if (!account.active || account.username !== username) {
      this.failAuthorization();
    }

    let authorization: PrivilegedAuthorization;
    try {
      authorization = await this.resolveAuthorization(account);
    } catch {
      if (!this.isOperationCurrent(operation)) {
        throw new PrivilegedSessionError('unauthorized');
      }
      this.failAuthorization();
    }
    this.assertOperationCurrent(operation);
    if (!authorization.assigned || !authorization.role) {
      this.failAuthorization();
    }

    this.assertOperationCurrent(operation);
    this.account = account;
    if (!authorization.paired) {
      this.setView({
        state: 'pairing-required',
        accountId: account.id,
        username: account.username,
        displayName: account.displayName,
        role: authorization.role,
        capabilities: [],
        deviceId: null,
        expiresAt: null,
      });
      return this.getView();
    }

    const capabilities = getPrivilegedCapabilities({
      active: account.active,
      assigned: authorization.assigned,
      role: authorization.role,
    });
    this.setView({
      state: 'active',
      accountId: account.id,
      username: account.username,
      displayName: account.displayName,
      role: authorization.role,
      capabilities,
      deviceId: authorization.deviceId,
      expiresAt: null,
    });
    return this.getView();
  }

  async reauthenticate(password: string): Promise<{ proofId: string; expiresAt: string }> {
    this.assertNotDisposed();
    validatePassword(password);
    const account = this.account;
    if (this.view.state !== 'active' || !account) throw new PrivilegedSessionError('unauthorized');
    const operation = this.beginOperation();

    let refreshed: RelayPrivilegedAccountRecord;
    let remoteProof: { requestId: string; expiresAt: string } | null = null;
    try {
      if (this.view.deviceId && this.authClient.reauthenticateRemotely) {
        const result = await this.authClient.reauthenticateRemotely(
          account.username,
          password,
          this.view.deviceId,
        );
        refreshed = result.account;
        remoteProof = { requestId: result.requestId, expiresAt: result.expiresAt };
      } else {
        refreshed = await this.authClient.reauthenticate(account.username, password);
      }
    } catch {
      this.failReauthentication(operation);
    }
    this.assertOperationCurrent(operation);
    if (!isSameAccount(account, refreshed)) {
      this.invalidateSession();
      throw new PrivilegedSessionError('unauthorized');
    }

    let authorization: PrivilegedAuthorization;
    try {
      authorization = await this.resolveAuthorization(refreshed);
    } catch {
      this.failReauthentication(operation);
    }
    this.assertOperationCurrent(operation);
    if (!authorization.assigned || !authorization.role || authorization.role !== this.view.role) {
      this.invalidateSession();
      throw new PrivilegedSessionError('unauthorized');
    }
    this.assertOperationCurrent(operation);
    this.account = refreshed;
    this.setView({
      ...this.view,
      username: refreshed.username,
      displayName: refreshed.displayName,
      role: authorization.role,
    });

    if (remoteProof) {
      if (
        remoteProof.requestId.length === 0 ||
        remoteProof.requestId.length > 128 ||
        !Number.isFinite(Date.parse(remoteProof.expiresAt))
      ) {
        this.invalidateSession();
        throw new PrivilegedSessionError('unauthorized');
      }
      return {
        proofId: remoteProof.requestId,
        expiresAt: new Date(Date.parse(remoteProof.expiresAt)).toISOString(),
      };
    }

    const authenticatedAtMs = this.now();
    const authenticatedAt = new Date(authenticatedAtMs).toISOString();
    let result: { requestId: string };
    try {
      result = await this.confirmReauthentication({
        accountId: account.id,
        username: refreshed.username,
        displayName: refreshed.displayName,
        role: authorization.role,
        deviceId: this.view.deviceId,
        authenticatedAt,
      });
    } catch {
      this.failReauthentication(operation);
    }
    this.assertOperationCurrent(operation);
    if (result.requestId.length === 0 || result.requestId.length > 128) {
      this.invalidateSession();
      throw new PrivilegedSessionError('unauthorized');
    }
    return {
      proofId: result.requestId,
      expiresAt: new Date(authenticatedAtMs + PRIVILEGED_REAUTH_PROOF_MS).toISOString(),
    };
  }

  activatePairedDevice(deviceId: string): PrivilegedSessionView {
    this.assertNotDisposed();
    const normalizedDeviceId = validateIdentifier(deviceId);
    const account = this.account;
    if (this.view.state !== 'pairing-required' || !account) {
      throw new PrivilegedSessionError('unauthorized');
    }
    this.operationGeneration += 1;
    this.setView({
      ...this.view,
      state: 'active',
      capabilities: getPrivilegedCapabilities({
        active: account.active,
        assigned: true,
        role: this.view.role!,
      }),
      deviceId: normalizedDeviceId,
    });
    return this.getView();
  }

  logout(): void {
    if (this.disposed) return;
    this.invalidateSession();
  }

  dispose(): void {
    if (this.disposed) return;
    this.operationGeneration += 1;
    this.disposed = true;
    this.authClient.clear();
    this.clearIdentity();
    this.view = publicCopy(SIGNED_OUT_VIEW);
  }

  handleAccountChanged(changedAccount: RelayPrivilegedAccountRecord | null): void {
    if (!this.account || this.view.state === 'signed-out') return;
    if (!isSameAccount(this.account, changedAccount)) {
      this.invalidateSession();
      return;
    }
    this.account = changedAccount;
    if (this.view.displayName !== changedAccount.displayName) {
      this.setView({ ...this.view, displayName: changedAccount.displayName });
    }
  }

  handleAuthorityChanged(accountIds: readonly string[]): void {
    if (this.account && accountIds.includes(this.account.id)) this.invalidateSession();
  }

  handleAuthoritySnapshot(
    changedAccount: RelayPrivilegedAccountRecord,
    state: RelayPrivilegedStateRecord,
  ): void {
    if (!this.account || this.view.state === 'signed-out') return;
    this.handleAccountChanged(changedAccount);
    if (!this.account) return;
    const role = getEffectiveRole(this.account, state);
    if (!this.account.active || !role || role !== this.view.role) this.invalidateSession();
  }

  handleDisconnect(): void {
    if (this.disposed) return;
    this.operationGeneration += 1;
    this.authClient.clear();
    this.setView({ ...this.view, state: 'offline', capabilities: [], expiresAt: null });
  }

  private invalidateSession(view: PrivilegedSessionView = SIGNED_OUT_VIEW): void {
    this.operationGeneration += 1;
    this.authClient.clear();
    this.clearIdentity();
    this.setView(view);
  }

  private clearIdentity(): void {
    this.account = null;
  }

  private failAuthorization(): never {
    this.invalidateSession();
    throw new PrivilegedSessionError('unauthorized');
  }

  private failReauthentication(operation: number): never {
    if (this.isOperationCurrent(operation)) this.invalidateSession();
    throw new PrivilegedSessionError('unauthorized');
  }

  private beginOperation(): number {
    this.operationGeneration += 1;
    return this.operationGeneration;
  }

  private isOperationCurrent(operation: number): boolean {
    return !this.disposed && this.operationGeneration === operation;
  }

  private assertOperationCurrent(operation: number): void {
    if (!this.isOperationCurrent(operation)) {
      throw new PrivilegedSessionError('unauthorized');
    }
  }

  private setView(view: PrivilegedSessionView): void {
    this.view = publicCopy(view);
    this.onViewChanged?.(this.getView());
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new PrivilegedSessionError('unauthorized');
  }
}

function isOfflineAuthenticationError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'offline'
  );
}
