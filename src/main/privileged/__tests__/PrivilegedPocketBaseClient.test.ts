import { BaseAuthStore, ClientResponseError } from 'pocketbase';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RELAY_PRIVILEGED_ACCOUNTS_COLLECTION } from '@shared/privilegedAccess';
import {
  PrivilegedAuthenticationError,
  PrivilegedPocketBaseClient,
  type PrivilegedPocketBaseClientAdapter,
} from '../PrivilegedPocketBaseClient';

const USERNAME = 'ryan';
const PASSWORD = 'Test-access-value-123!';
const RAW_TOKEN = 'raw-privileged-token-value';

function accountRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-admin',
    collectionName: RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
    username: USERNAME,
    displayName: 'Ryan Bledsoe',
    storedRole: 'administrator',
    active: true,
    mustChangePassword: false,
    credentialVersion: 1,
    revision: 3,
    email: 'ryan@relay.invalid',
    created: '2026-07-15T12:00:00.000Z',
    updated: '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

function authorityState(overrides: Record<string, unknown> = {}) {
  return {
    id: 'privileged-state',
    key: 'primary',
    ownerAccountId: 'account-admin',
    publisherAccountId: null,
    assignmentVersion: 1,
    identityMigrationVersion: 1,
    updatedByAccountId: 'account-admin',
    created: '2026-07-15T12:00:00.000Z',
    updated: '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe('PrivilegedPocketBaseClient', () => {
  let authStores: BaseAuthStore[];
  let adapters: PrivilegedPocketBaseClientAdapter[];
  let authWithPassword: ReturnType<typeof vi.fn>;
  let createRecord: ReturnType<typeof vi.fn>;
  let getOne: ReturnType<typeof vi.fn>;
  let getFirstListItem: ReturnType<typeof vi.fn>;
  let subscribe: ReturnType<typeof vi.fn>;
  let subscriptionCallbacks: Map<string, (event: unknown) => void>;
  let subscriptionDisposers: ReturnType<typeof vi.fn>[];
  let createClient: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    authStores = [];
    adapters = [];
    authWithPassword = vi.fn(async () => {
      const authStore = authStores.at(-1) as BaseAuthStore;
      const record = accountRecord();
      authStore.save(RAW_TOKEN, record);
      return { token: RAW_TOKEN, record };
    });
    createRecord = vi.fn(async (data) => ({ id: 'created-record', ...data }));
    getOne = vi.fn(async (id) => ({ id, value: 'safe' }));
    getFirstListItem = vi.fn(async () => ({ id: 'first-record', value: 'safe' }));
    subscriptionCallbacks = new Map();
    subscriptionDisposers = [];
    subscribe = vi.fn(
      async (collection: string, topic: string, callback: (event: unknown) => void) => {
        subscriptionCallbacks.set(`${collection}/${topic}`, callback);
        const dispose = vi.fn(async () => undefined);
        subscriptionDisposers.push(dispose);
        return dispose;
      },
    );
    createClient = vi.fn((serverUrl: string, authStore: BaseAuthStore) => {
      authStores.push(authStore);
      const adapter: PrivilegedPocketBaseClientAdapter = {
        baseURL: serverUrl,
        authStore,
        cancelAllRequests: vi.fn(),
        realtime: { onDisconnect: undefined },
        collection: vi.fn((collectionName: string) => ({
          authWithPassword,
          create: createRecord,
          getOne,
          getFirstListItem,
          subscribe: (topic, callback) => subscribe(collectionName, topic, callback),
        })),
      };
      adapters.push(adapter);
      return adapter;
    });
  });

  function createPrivilegedClient() {
    return new PrivilegedPocketBaseClient({
      allowInsecureHttp: false,
      createClient,
      serverUrl: 'https://relay.example.com',
    });
  }

  it('uses an independent in-memory BaseAuthStore and never mutates the shared Relay store', async () => {
    const sharedAuthStore = new BaseAuthStore();
    sharedAuthStore.save('shared-app-token', { id: 'shared-user' });
    const client = createPrivilegedClient();

    await client.authenticate(USERNAME, PASSWORD);

    expect(authStores).toHaveLength(1);
    expect(authStores[0]).toBeInstanceOf(BaseAuthStore);
    expect(authStores[0]).not.toBe(sharedAuthStore);
    expect(sharedAuthStore.token).toBe('shared-app-token');
    expect(sharedAuthStore.record).toEqual({ id: 'shared-user' });
  });

  it('authenticates only against the privileged collection and returns sanitized account data', async () => {
    const client = createPrivilegedClient();

    const account = await client.authenticate(USERNAME, PASSWORD);

    expect(adapters[0]?.collection).toHaveBeenCalledWith(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION);
    expect(authWithPassword).toHaveBeenCalledWith(USERNAME, PASSWORD, { requestKey: null });
    expect(account).toEqual(accountRecord({ collectionName: undefined, email: undefined }));
    expect(JSON.stringify(account)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(account)).not.toContain('@relay.invalid');
    expect(Object.keys(account)).not.toContain('token');
  });

  it('canonicalizes mixed-case usernames before PocketBase authentication', async () => {
    const client = createPrivilegedClient();

    await client.authenticate('  RyAn  ', PASSWORD);

    expect(authWithPassword).toHaveBeenCalledWith('ryan', PASSWORD, { requestKey: null });
  });

  it('accepts PocketBase auth responses that omit non-authorizing timestamps', async () => {
    authWithPassword.mockImplementationOnce(async () => {
      const authStore = authStores.at(-1) as BaseAuthStore;
      const record = accountRecord({ created: undefined, updated: undefined });
      authStore.save(RAW_TOKEN, record);
      return { token: RAW_TOKEN, record };
    });
    const client = createPrivilegedClient();

    await expect(client.authenticate(USERNAME, PASSWORD)).resolves.toMatchObject({
      id: 'account-admin',
      username: USERNAME,
      displayName: 'Ryan Bledsoe',
      created: '',
      updated: '',
    });
  });

  it('clears privileged authentication on disconnect and reconfigure', async () => {
    const client = createPrivilegedClient();
    await client.authenticate(USERNAME, PASSWORD);
    const originalStore = authStores[0] as BaseAuthStore;

    client.disconnect();
    expect(originalStore.token).toBe('');
    expect(adapters[0]?.cancelAllRequests).toHaveBeenCalled();

    await client.authenticate(USERNAME, PASSWORD);
    client.reconfigure('https://relay-two.example.com', false);

    expect(originalStore.token).toBe('');
    expect(authStores).toHaveLength(2);
    expect(authStores[1]).not.toBe(originalStore);
    expect(adapters[1]?.baseURL).toBe('https://relay-two.example.com');
  });

  it('monitors only the authenticated account and authority state with deterministic cleanup', async () => {
    const client = createPrivilegedClient();
    await client.authenticate(USERNAME, PASSWORD);
    getOne.mockResolvedValueOnce(accountRecord());
    getFirstListItem.mockResolvedValueOnce({
      id: 'privileged-state',
      key: 'primary',
      ownerAccountId: 'account-admin',
      publisherAccountId: null,
      assignmentVersion: 1,
      identityMigrationVersion: 1,
      updatedByAccountId: 'account-admin',
      created: '2026-07-15T12:00:00.000Z',
      updated: '2026-07-15T12:00:00.000Z',
    });
    const onSnapshot = vi.fn();
    const onDisconnect = vi.fn();

    const stop = await client.monitorAuthority('account-admin', {
      onDisconnect,
      onSnapshot,
    });

    expect(subscribe).toHaveBeenCalledWith(
      RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
      'account-admin',
      expect.any(Function),
    );
    expect(subscribe).toHaveBeenCalledWith('relay_privileged_state', '*', expect.any(Function));
    expect(onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({ id: 'account-admin', displayName: 'Ryan Bledsoe' }),
        state: expect.objectContaining({ ownerAccountId: 'account-admin' }),
      }),
    );

    onSnapshot.mockClear();
    getOne.mockResolvedValueOnce(accountRecord({ displayName: 'Ryan Updated' }));
    getFirstListItem.mockResolvedValueOnce({
      id: 'privileged-state',
      key: 'primary',
      ownerAccountId: 'account-charles',
      publisherAccountId: null,
      assignmentVersion: 2,
      identityMigrationVersion: 1,
      updatedByAccountId: 'account-charles',
      created: '2026-07-15T12:00:00.000Z',
      updated: '2026-07-15T12:01:00.000Z',
    });
    subscriptionCallbacks.get('relay_privileged_state/*')?.({ action: 'update', record: {} });
    await vi.waitFor(() =>
      expect(onSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          account: expect.objectContaining({ displayName: 'Ryan Updated' }),
          state: expect.objectContaining({ ownerAccountId: 'account-charles' }),
        }),
      ),
    );

    adapters[0]!.realtime.onDisconnect?.([
      'relay_privileged_accounts/account-admin',
      'relay_privileged_state/*',
    ]);
    expect(onDisconnect).toHaveBeenCalledOnce();

    client.reconfigure('https://relay-two.example.com', false);
    await vi.waitFor(() =>
      expect(subscriptionDisposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true),
    );
    await stop();
    expect(subscriptionDisposers).toHaveLength(2);
    expect(subscriptionDisposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(adapters[0]!.realtime.onDisconnect).toBeUndefined();
  });

  it('installs EventSource for main-process PocketBase realtime without replacing a host value', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
    try {
      Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: undefined,
        writable: true,
      });
      const client = createPrivilegedClient();
      await client.authenticate(USERNAME, PASSWORD);
      getOne.mockResolvedValueOnce(accountRecord());
      getFirstListItem.mockResolvedValueOnce(authorityState());

      const stop = await client.monitorAuthority('account-admin', {
        onDisconnect: vi.fn(),
        onSnapshot: vi.fn(),
      });

      expect(globalThis.EventSource).toEqual(expect.any(Function));
      const installed = globalThis.EventSource;
      await stop();

      const hostEventSource = vi.fn();
      Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: hostEventSource,
        writable: true,
      });
      const secondClient = createPrivilegedClient();
      await secondClient.authenticate(USERNAME, PASSWORD);
      getOne.mockResolvedValueOnce(accountRecord());
      getFirstListItem.mockResolvedValueOnce(authorityState());
      const stopSecond = await secondClient.monitorAuthority('account-admin', {
        onDisconnect: vi.fn(),
        onSnapshot: vi.fn(),
      });

      expect(installed).not.toBe(hostEventSource);
      expect(globalThis.EventSource).toBe(hostEventSource);
      await stopSecond();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'EventSource', originalDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'EventSource');
      }
    }
  });

  it('awaits an in-flight authority teardown when clear and the scoped disposer overlap', async () => {
    const client = createPrivilegedClient();
    await client.authenticate(USERNAME, PASSWORD);
    getOne.mockResolvedValueOnce(accountRecord());
    getFirstListItem.mockResolvedValueOnce({
      id: 'privileged-state',
      key: 'primary',
      ownerAccountId: 'account-admin',
      publisherAccountId: null,
      assignmentVersion: 1,
      identityMigrationVersion: 1,
      updatedByAccountId: 'account-admin',
    });
    const stop = await client.monitorAuthority('account-admin', {
      onDisconnect: vi.fn(),
      onSnapshot: vi.fn(),
    });
    let releaseCleanup!: () => void;
    const cleanupBlocked = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    for (const dispose of subscriptionDisposers) {
      dispose.mockImplementationOnce(() => cleanupBlocked);
    }

    client.clear();
    let stopped = false;
    const stopPromise = stop().then(() => {
      stopped = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(stopped).toBe(false);

    releaseCleanup();
    await stopPromise;
    expect(stopped).toBe(true);
  });

  it('registers cleanup before a delayed first subscription can finish', async () => {
    const client = createPrivilegedClient();
    await client.authenticate(USERNAME, PASSWORD);
    const firstSubscription = deferred<void>();
    subscribe.mockImplementationOnce(
      async (collection: string, topic: string, callback: (event: unknown) => void) => {
        subscriptionCallbacks.set(`${collection}/${topic}`, callback);
        const dispose = vi.fn(async () => undefined);
        subscriptionDisposers.push(dispose);
        await firstSubscription.promise;
        return dispose;
      },
    );
    getOne.mockResolvedValueOnce(accountRecord());
    getFirstListItem.mockResolvedValueOnce(authorityState());
    const onSnapshot = vi.fn();

    const monitoring = client.monitorAuthority('account-admin', {
      onDisconnect: vi.fn(),
      onSnapshot,
    });
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
    client.clear();
    firstSubscription.resolve();

    await expect(monitoring).rejects.toMatchObject({ code: 'invalid-credentials' });
    expect(subscribe).toHaveBeenCalledOnce();
    expect(subscriptionDisposers[0]).toHaveBeenCalledOnce();
    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it('invalidates a delayed initial snapshot read before it can deliver', async () => {
    const client = createPrivilegedClient();
    await client.authenticate(USERNAME, PASSWORD);
    const accountRead = deferred<Record<string, unknown>>();
    getOne.mockImplementationOnce(() => accountRead.promise);
    getFirstListItem.mockResolvedValueOnce(authorityState());
    const onSnapshot = vi.fn();

    const monitoring = client.monitorAuthority('account-admin', {
      onDisconnect: vi.fn(),
      onSnapshot,
    });
    await vi.waitFor(() => expect(getOne).toHaveBeenCalledOnce());
    client.clear();
    accountRead.resolve(accountRecord({ displayName: 'Stale Ryan' }));

    await expect(monitoring).rejects.toMatchObject({ code: 'invalid-credentials' });
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(subscriptionDisposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it('reconfigure waits for and suppresses an old in-flight realtime refresh', async () => {
    const client = createPrivilegedClient();
    await client.authenticate(USERNAME, PASSWORD);
    getOne.mockResolvedValueOnce(accountRecord());
    getFirstListItem.mockResolvedValueOnce(authorityState());
    const onSnapshot = vi.fn();
    const stop = await client.monitorAuthority('account-admin', {
      onDisconnect: vi.fn(),
      onSnapshot,
    });
    onSnapshot.mockClear();

    const accountRead = deferred<Record<string, unknown>>();
    getOne.mockImplementationOnce(() => accountRead.promise);
    getFirstListItem.mockResolvedValueOnce(
      authorityState({ ownerAccountId: 'account-charles', assignmentVersion: 2 }),
    );
    subscriptionCallbacks.get('relay_privileged_state/*')?.({ action: 'update', record: {} });
    await vi.waitFor(() => expect(getOne).toHaveBeenCalledTimes(2));

    client.reconfigure('https://relay-two.example.com', false);
    let stopped = false;
    const stopPromise = stop().then(() => {
      stopped = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(stopped).toBe(false);

    accountRead.resolve(accountRecord({ displayName: 'Stale Ryan' }));
    await stopPromise;
    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it('maps invalid credentials to a generic error without retaining server details', async () => {
    authWithPassword.mockRejectedValueOnce(
      new ClientResponseError({
        status: 400,
        response: { message: 'username or credential was wrong: sensitive detail' },
      }),
    );
    const client = createPrivilegedClient();

    let error: unknown;
    try {
      await client.authenticate(USERNAME, PASSWORD);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(PrivilegedAuthenticationError);
    expect(error).toMatchObject({ code: 'invalid-credentials' });
    expect(String(error)).not.toContain('sensitive detail');
    expect(authStores[0]?.token).toBe('');
  });

  it('maps connection failures to offline without exposing the raw exception', async () => {
    authWithPassword.mockRejectedValueOnce(
      new ClientResponseError({ status: 0, response: { message: 'fetch failed at secret host' } }),
    );
    const client = createPrivilegedClient();

    await expect(client.authenticate(USERNAME, PASSWORD)).rejects.toMatchObject({
      code: 'offline',
      message: 'Privileged access is unavailable while Relay is offline.',
    });
  });

  it('rejects malformed or mismatched username responses and clears their tokens', async () => {
    authWithPassword.mockImplementationOnce(async () => {
      const authStore = authStores.at(-1) as BaseAuthStore;
      const record = accountRecord({ username: 'charles' });
      authStore.save(RAW_TOKEN, record);
      return { token: RAW_TOKEN, record };
    });
    const client = createPrivilegedClient();

    await expect(client.authenticate(USERNAME, PASSWORD)).rejects.toMatchObject({
      code: 'invalid-credentials',
    });
    expect(authStores[0]?.token).toBe('');
  });

  it('applies Relay server URL policy before constructing a privileged client', () => {
    expect(
      () =>
        new PrivilegedPocketBaseClient({
          allowInsecureHttp: false,
          createClient,
          serverUrl: 'http://public.example.com',
        }),
    ).toThrow('Invalid Relay server URL');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('keeps authenticated record transport in main and rejects it after logout', async () => {
    const client = createPrivilegedClient();
    await expect(client.getRecord('relay_privileged_commands', 'record-1')).rejects.toMatchObject({
      code: 'invalid-credentials',
    });

    await client.authenticate(USERNAME, PASSWORD);
    await expect(
      client.createRecord('relay_privileged_commands', { state: 'pending' }),
    ).resolves.toMatchObject({ id: 'created-record', state: 'pending' });
    await expect(client.getRecord('relay_privileged_commands', 'record-1')).resolves.toEqual({
      id: 'record-1',
      value: 'safe',
    });
    await expect(
      client.getFirstRecord('relay_privileged_state', 'key="primary"'),
    ).resolves.toMatchObject({ id: 'first-record' });

    client.clear();
    await expect(client.getRecord('relay_privileged_commands', 'record-1')).rejects.toMatchObject({
      code: 'invalid-credentials',
    });
  });
});
