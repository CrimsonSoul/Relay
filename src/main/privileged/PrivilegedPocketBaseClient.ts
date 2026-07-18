import PocketBase, { BaseAuthStore, ClientResponseError } from 'pocketbase';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  type RelayPrivilegedAccountRecord,
} from '@shared/privilegedAccess';
import { normalizeRoleUsername } from '@shared/roleAccounts';
import { isAllowedRelayServerUrl } from '@shared/urlSecurity';

export type PrivilegedAuthenticationErrorCode = 'invalid-credentials' | 'offline';

export class PrivilegedAuthenticationError extends Error {
  constructor(readonly code: PrivilegedAuthenticationErrorCode) {
    super(
      code === 'offline'
        ? 'Privileged access is unavailable while Relay is offline.'
        : 'Unable to sign in with those credentials.',
    );
    this.name = 'PrivilegedAuthenticationError';
  }
}

type PrivilegedAuthResponse = {
  token: string;
  record: unknown;
};

type PrivilegedAuthCollection = {
  authWithPassword(
    username: string,
    password: string,
    options: { requestKey: null },
  ): Promise<PrivilegedAuthResponse>;
  create<T = Record<string, unknown>>(
    data: Record<string, unknown> | FormData,
    options: { requestKey: null },
  ): Promise<T>;
  getOne<T = Record<string, unknown>>(id: string, options: { requestKey: null }): Promise<T>;
  getFirstListItem<T = Record<string, unknown>>(
    filter: string,
    options: { requestKey: null },
  ): Promise<T>;
};

export type PrivilegedPocketBaseClientAdapter = {
  baseURL: string;
  authStore: BaseAuthStore;
  cancelAllRequests(): unknown;
  collection(name: string): PrivilegedAuthCollection;
};

type PrivilegedPocketBaseClientOptions = {
  serverUrl: string;
  allowInsecureHttp?: boolean;
  createClient?: (serverUrl: string, authStore: BaseAuthStore) => PrivilegedPocketBaseClientAdapter;
};

export interface PrivilegedAuthClient {
  authenticate(username: string, password: string): Promise<RelayPrivilegedAccountRecord>;
  reauthenticate(username: string, password: string): Promise<RelayPrivilegedAccountRecord>;
  clear(): void;
  createRecord?(
    collection: string,
    data: Record<string, unknown> | FormData,
  ): Promise<Record<string, unknown> & { id: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function normalizeAccountRecord(value: unknown): RelayPrivilegedAccountRecord | null {
  if (!isRecord(value)) return null;
  const {
    id,
    collectionName,
    username,
    displayName,
    storedRole,
    active,
    mustChangePassword,
    credentialVersion,
    revision,
    legacyOperatorId,
    created,
    updated,
  } = value;
  if (
    collectionName !== RELAY_PRIVILEGED_ACCOUNTS_COLLECTION ||
    !isBoundedString(id, 200) ||
    !isBoundedString(username, 64) ||
    normalizeRoleUsername(username) !== username ||
    !isBoundedString(displayName, 120) ||
    (storedRole !== 'administrator' && storedRole !== 'publisher') ||
    typeof active !== 'boolean' ||
    typeof mustChangePassword !== 'boolean' ||
    !Number.isSafeInteger(credentialVersion) ||
    (credentialVersion as number) < 0 ||
    !Number.isSafeInteger(revision) ||
    (revision as number) < 0 ||
    (legacyOperatorId !== undefined &&
      legacyOperatorId !== null &&
      legacyOperatorId !== '' &&
      !isBoundedString(legacyOperatorId, 200)) ||
    (created !== undefined && (typeof created !== 'string' || created.length > 100)) ||
    (updated !== undefined && (typeof updated !== 'string' || updated.length > 100))
  ) {
    return null;
  }
  return {
    id,
    username,
    displayName,
    storedRole,
    active,
    mustChangePassword,
    credentialVersion: credentialVersion as number,
    revision: revision as number,
    ...(typeof legacyOperatorId === 'string' && legacyOperatorId.length > 0
      ? { legacyOperatorId }
      : {}),
    created: typeof created === 'string' ? created : '',
    updated: typeof updated === 'string' ? updated : '',
  };
}

function isOfflineError(error: unknown): boolean {
  if (error instanceof ClientResponseError) return error.status === 0 || error.isAbort;
  if (error instanceof TypeError) return true;
  return isRecord(error) && (error.status === 0 || error.name === 'AbortError');
}

function defaultCreateClient(
  serverUrl: string,
  authStore: BaseAuthStore,
): PrivilegedPocketBaseClientAdapter {
  return new PocketBase(serverUrl, authStore) as PrivilegedPocketBaseClientAdapter;
}

export class PrivilegedPocketBaseClient implements PrivilegedAuthClient {
  private serverUrl: string;
  private allowInsecureHttp: boolean;
  private readonly createClient: NonNullable<PrivilegedPocketBaseClientOptions['createClient']>;
  private client: PrivilegedPocketBaseClientAdapter;

  constructor(options: PrivilegedPocketBaseClientOptions) {
    this.allowInsecureHttp = options.allowInsecureHttp === true;
    this.serverUrl = this.validateServerUrl(options.serverUrl, this.allowInsecureHttp);
    this.createClient = options.createClient ?? defaultCreateClient;
    this.client = this.buildClient(this.serverUrl);
  }

  authenticate(username: string, password: string): Promise<RelayPrivilegedAccountRecord> {
    return this.authenticateFresh(username, password);
  }

  reauthenticate(username: string, password: string): Promise<RelayPrivilegedAccountRecord> {
    return this.authenticateFresh(username, password);
  }

  clear(): void {
    this.client.authStore.clear();
  }

  disconnect(): void {
    this.client.cancelAllRequests();
    this.clear();
  }

  reconfigure(serverUrl: string, allowInsecureHttp = false): void {
    const normalizedUrl = this.validateServerUrl(serverUrl, allowInsecureHttp);
    this.disconnect();
    this.serverUrl = normalizedUrl;
    this.allowInsecureHttp = allowInsecureHttp;
    this.client = this.buildClient(normalizedUrl);
  }

  getAccount(): RelayPrivilegedAccountRecord | null {
    return normalizeAccountRecord(this.client.authStore.record);
  }

  async createRecord(
    collection: string,
    data: Record<string, unknown> | FormData,
  ): Promise<Record<string, unknown> & { id: string }> {
    this.assertAuthenticated();
    try {
      return (await this.client
        .collection(collection)
        .create(data, { requestKey: null })) as Record<string, unknown> & { id: string };
    } catch (error) {
      throw new PrivilegedAuthenticationError(
        isOfflineError(error) ? 'offline' : 'invalid-credentials',
      );
    }
  }

  async getRecord(
    collection: string,
    id: string,
  ): Promise<Record<string, unknown> & { id: string }> {
    this.assertAuthenticated();
    try {
      return (await this.client.collection(collection).getOne(id, { requestKey: null })) as Record<
        string,
        unknown
      > & { id: string };
    } catch (error) {
      throw new PrivilegedAuthenticationError(
        isOfflineError(error) ? 'offline' : 'invalid-credentials',
      );
    }
  }

  async getFirstRecord(
    collection: string,
    filter: string,
  ): Promise<Record<string, unknown> & { id: string }> {
    this.assertAuthenticated();
    try {
      return (await this.client.collection(collection).getFirstListItem(filter, {
        requestKey: null,
      })) as Record<string, unknown> & { id: string };
    } catch (error) {
      throw new PrivilegedAuthenticationError(
        isOfflineError(error) ? 'offline' : 'invalid-credentials',
      );
    }
  }

  private async authenticateFresh(
    username: string,
    password: string,
  ): Promise<RelayPrivilegedAccountRecord> {
    this.clear();
    try {
      const normalizedUsername = normalizeRoleUsername(username);
      const response = await this.client
        .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
        .authWithPassword(normalizedUsername, password, { requestKey: null });
      const account = normalizeAccountRecord(response.record);
      if (!account || account.username !== normalizedUsername) {
        this.clear();
        throw new PrivilegedAuthenticationError('invalid-credentials');
      }
      return account;
    } catch (error) {
      this.clear();
      if (error instanceof PrivilegedAuthenticationError) throw error;
      throw new PrivilegedAuthenticationError(
        isOfflineError(error) ? 'offline' : 'invalid-credentials',
      );
    }
  }

  private buildClient(serverUrl: string): PrivilegedPocketBaseClientAdapter {
    return this.createClient(serverUrl, new BaseAuthStore());
  }

  private assertAuthenticated(): void {
    if (!this.client.authStore.token || !this.getAccount()) {
      throw new PrivilegedAuthenticationError('invalid-credentials');
    }
  }

  private validateServerUrl(serverUrl: string, allowInsecureHttp: boolean): string {
    if (!isAllowedRelayServerUrl(serverUrl, allowInsecureHttp)) {
      throw new Error('Invalid Relay server URL for privileged access.');
    }
    return serverUrl;
  }
}
