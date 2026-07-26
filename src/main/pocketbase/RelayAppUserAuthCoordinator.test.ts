import type PocketBase from 'pocketbase';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RelayAppUserAuthCoordinator,
  type RelayAppUserAuthOptions,
} from './RelayAppUserAuthCoordinator';

type AuthSnapshot = {
  token: string;
  record: {
    id: string;
    email: string;
    collectionId: string;
    collectionName: string;
  };
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function snapshot(id: string): AuthSnapshot {
  return {
    token: `valid-token-${id}`,
    record: {
      id,
      email: 'relay@relay.app',
      collectionId: '_pb_users_auth_',
      collectionName: 'users',
    },
  };
}

function createClient(
  authenticate: (
    email: string,
    secret: string,
    options: { requestKey: null; signal: AbortSignal },
  ) => Promise<AuthSnapshot> = async () => snapshot('relay-user'),
  options: { acceptSavedAuth?: boolean; saveAuthenticationResult?: boolean } = {},
) {
  const authStore = {
    token: '',
    record: null as AuthSnapshot['record'] | null,
    get isValid() {
      return this.token.startsWith('valid-token-');
    },
    save(token: string, record?: AuthSnapshot['record'] | null) {
      if (options.acceptSavedAuth === false) return;
      this.token = token;
      this.record = record ?? null;
    },
    clear() {
      this.token = '';
      this.record = null;
    },
  };
  const authWithPassword = vi.fn(
    async (
      email: string,
      secret: string,
      requestOptions: { requestKey: null; signal: AbortSignal },
    ) => {
      const result = await authenticate(email, secret, requestOptions);
      if (options.saveAuthenticationResult !== false) {
        authStore.save(result.token, result.record);
      }
      return result;
    },
  );
  const value = {
    authStore,
    collection: vi.fn(() => ({ authWithPassword })),
  } as unknown as PocketBase;
  return { authStore, authWithPassword, value };
}

type TestClient = ReturnType<typeof createClient>;

let coordinator: RelayAppUserAuthCoordinator | null = null;
let createdOwners: TestClient[] = [];
let queuedOwners: TestClient[] = [];

function queueAuthOwner(owner: TestClient): void {
  queuedOwners.push(owner);
}

function authenticateRelayAppUserShared(
  client: PocketBase,
  serverUrl: string,
  secret: string,
  options: RelayAppUserAuthOptions = {},
): Promise<void> {
  if (!coordinator) throw new Error('Test coordinator is unavailable');
  return coordinator.authenticate(client, serverUrl, secret, options);
}

function primeRelayAppUserAuth(client: PocketBase, serverUrl: string, secret: string): void {
  if (!coordinator) throw new Error('Test coordinator is unavailable');
  coordinator.prime(client, serverUrl, secret);
}

function clearRelayAppUserAuthCoordinator(): void {
  coordinator?.clear();
}

describe('RelayAppUserAuthCoordinator', () => {
  beforeEach(() => {
    clearRelayAppUserAuthCoordinator();
    vi.useRealTimers();
    createdOwners = [];
    queuedOwners = [];
    coordinator = new RelayAppUserAuthCoordinator(() => {
      const owner = queuedOwners.shift() ?? createClient();
      createdOwners.push(owner);
      return owner.value;
    });
  });

  it('single-flights concurrent authentication for the same server and secret', async () => {
    const pending = deferred<AuthSnapshot>();
    const owner = createClient(() => pending.promise);
    queueAuthOwner(owner);
    const first = createClient();
    const second = createClient();

    const firstAuth = authenticateRelayAppUserShared(
      first.value,
      'https://relay.example.com',
      'shared-secret',
    );
    const secondAuth = authenticateRelayAppUserShared(
      second.value,
      'https://relay.example.com',
      'shared-secret',
    );
    await vi.waitFor(() => expect(owner.authWithPassword).toHaveBeenCalledOnce());
    expect(first.authWithPassword).not.toHaveBeenCalled();
    expect(second.authWithPassword).not.toHaveBeenCalled();

    pending.resolve(snapshot('shared-user'));
    await Promise.all([firstAuth, secondAuth]);

    expect(first.authStore).toMatchObject({
      token: 'valid-token-shared-user',
      record: { id: 'shared-user' },
      isValid: true,
    });
    expect(second.authStore).toMatchObject({
      token: 'valid-token-shared-user',
      record: { id: 'shared-user' },
      isValid: true,
    });
    expect(owner.authStore.isValid).toBe(false);
  });

  it('reuses a successful snapshot for four seconds and authenticates again after expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    const first = createClient();
    await authenticateRelayAppUserShared(first.value, 'https://relay.example.com', 'shared-secret');

    vi.setSystemTime(new Date('2026-07-26T12:00:03.999Z'));
    const withinWindow = createClient();
    await authenticateRelayAppUserShared(
      withinWindow.value,
      'https://relay.example.com',
      'shared-secret',
    );
    expect(withinWindow.authWithPassword).not.toHaveBeenCalled();
    expect(withinWindow.authStore.isValid).toBe(true);

    vi.setSystemTime(new Date('2026-07-26T12:00:04.001Z'));
    const expired = createClient();
    await authenticateRelayAppUserShared(
      expired.value,
      'https://relay.example.com',
      'shared-secret',
    );
    expect(expired.authWithPassword).not.toHaveBeenCalled();
    expect(createdOwners).toHaveLength(2);
    expect(createdOwners[1]?.authWithPassword).toHaveBeenCalledOnce();
  });

  it('actively releases a completed snapshot when its four-second window expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    const first = createClient();
    await authenticateRelayAppUserShared(first.value, 'https://relay.example.com', 'shared-secret');
    expect(vi.getTimerCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(4_001);

    expect(vi.getTimerCount()).toBe(0);
    const afterExpiry = createClient();
    await authenticateRelayAppUserShared(
      afterExpiry.value,
      'https://relay.example.com',
      'shared-secret',
    );
    expect(afterExpiry.authWithPassword).not.toHaveBeenCalled();
    expect(createdOwners).toHaveLength(2);
    expect(createdOwners[1]?.authWithPassword).toHaveBeenCalledOnce();
  });

  it('never reuses authentication for a different server URL or secret', async () => {
    const first = createClient();
    const differentUrl = createClient();
    const differentSecret = createClient();

    await authenticateRelayAppUserShared(
      first.value,
      'https://relay-a.example.com',
      'shared-secret',
    );
    await authenticateRelayAppUserShared(
      differentUrl.value,
      'https://relay-b.example.com',
      'shared-secret',
    );
    await authenticateRelayAppUserShared(
      differentSecret.value,
      'https://relay-a.example.com',
      'different-secret',
    );

    expect(first.authWithPassword).not.toHaveBeenCalled();
    expect(differentUrl.authWithPassword).not.toHaveBeenCalled();
    expect(differentSecret.authWithPassword).not.toHaveBeenCalled();
    expect(createdOwners).toHaveLength(3);
    expect(createdOwners.every((owner) => owner.authWithPassword.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it('never starts more than two staggered password requests per credential in three seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    const transientFailure = () =>
      createClient(async () => {
        throw Object.assign(new Error('temporary server failure'), { status: 500 });
      });
    queueAuthOwner(transientFailure());
    queueAuthOwner(transientFailure());

    await expect(
      authenticateRelayAppUserShared(
        createClient().value,
        'https://relay.example.com',
        'shared-secret',
      ),
    ).rejects.toMatchObject({ status: 500 });
    await vi.advanceTimersByTimeAsync(750);
    await expect(
      authenticateRelayAppUserShared(
        createClient().value,
        'https://relay.example.com',
        'shared-secret',
      ),
    ).rejects.toMatchObject({ status: 500 });
    await vi.advanceTimersByTimeAsync(750);

    await expect(
      authenticateRelayAppUserShared(
        createClient().value,
        'https://relay.example.com',
        'shared-secret',
      ),
    ).rejects.toThrow('Relay app-user authentication is cooling down');
    expect(createdOwners).toHaveLength(2);
    expect(
      createdOwners.reduce((count, owner) => count + owner.authWithPassword.mock.calls.length, 0),
    ).toBe(2);
  });

  it('shares a definitive credential rejection without starting a second password request', async () => {
    const rejectedOwner = createClient(async () => {
      throw Object.assign(new Error('invalid credentials'), { status: 401 });
    });
    queueAuthOwner(rejectedOwner);

    await expect(
      authenticateRelayAppUserShared(
        createClient().value,
        'https://relay.example.com',
        'wrong-secret',
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateRelayAppUserShared(
        createClient().value,
        'https://relay.example.com',
        'wrong-secret',
      ),
    ).rejects.toMatchObject({ status: 401 });

    expect(rejectedOwner.authWithPassword).toHaveBeenCalledOnce();
    expect(createdOwners).toHaveLength(1);
  });

  it('primes a second client from an already-authenticated bootstrap client', async () => {
    const bootstrap = createClient();
    bootstrap.authStore.save('valid-token-bootstrap', snapshot('bootstrap').record);
    primeRelayAppUserAuth(bootstrap.value, 'http://127.0.0.1:8090', 'server-startup-secret');
    const renderer = createClient();

    await authenticateRelayAppUserShared(
      renderer.value,
      'http://127.0.0.1:8090',
      'server-startup-secret',
    );

    expect(renderer.authWithPassword).not.toHaveBeenCalled();
    expect(renderer.authStore).toMatchObject({
      token: 'valid-token-bootstrap',
      record: { id: 'bootstrap' },
      isValid: true,
    });
  });

  it('rejects an invalid source or copied auth store instead of treating it as authenticated', async () => {
    const invalidOwner = createClient(async () => snapshot('invalid'), {
      saveAuthenticationResult: false,
    });
    queueAuthOwner(invalidOwner);
    const invalidSourceTarget = createClient();
    await expect(
      authenticateRelayAppUserShared(
        invalidSourceTarget.value,
        'https://relay.example.com',
        'invalid-source-secret',
      ),
    ).rejects.toThrow('PocketBase did not accept Relay app-user authentication');
    expect(invalidSourceTarget.authStore.isValid).toBe(false);
    expect(invalidOwner.authStore.isValid).toBe(false);

    const source = createClient();
    source.authStore.save('valid-token-source', snapshot('source').record);
    primeRelayAppUserAuth(source.value, 'https://relay.example.com', 'copy-secret');
    const invalidTarget = createClient(undefined, { acceptSavedAuth: false });
    await expect(
      authenticateRelayAppUserShared(
        invalidTarget.value,
        'https://relay.example.com',
        'copy-secret',
      ),
    ).rejects.toThrow('PocketBase did not accept the shared Relay app-user session');
    expect(invalidTarget.authWithPassword).not.toHaveBeenCalled();
  });

  it('never primes or shares a token from a different authentication collection', () => {
    const superuser = createClient();
    superuser.authStore.save('valid-token-superuser', {
      ...snapshot('superuser').record,
      collectionName: '_superusers',
    });

    expect(() =>
      primeRelayAppUserAuth(superuser.value, 'http://127.0.0.1:8090', 'server-startup-secret'),
    ).toThrow('PocketBase did not retain the authenticated Relay app-user session');
  });

  it('never primes another user from the Relay app-user collection', () => {
    const otherUser = createClient();
    otherUser.authStore.save('valid-token-other-user', {
      ...snapshot('other-user').record,
      email: 'someone-else@relay.app',
    });

    expect(() =>
      primeRelayAppUserAuth(otherUser.value, 'http://127.0.0.1:8090', 'server-startup-secret'),
    ).toThrow('PocketBase did not retain the authenticated Relay app-user session');
  });

  it('copies only the fixed app-user identity from a record with non-cloneable extras', async () => {
    const source = createClient();
    source.authStore.save('valid-token-source', {
      ...snapshot('source').record,
      unsafeMethod: () => 'must not be copied',
      internalState: { credentialHint: 'must not be copied' },
    } as never);
    primeRelayAppUserAuth(source.value, 'https://relay.example.com', 'copy-secret');
    const target = createClient();

    await authenticateRelayAppUserShared(target.value, 'https://relay.example.com', 'copy-secret');

    expect(target.authStore.record).toEqual(snapshot('source').record);
  });

  it('rejects a target auth store that rewrites the shared session as another collection', async () => {
    const source = createClient();
    source.authStore.save('valid-token-source', snapshot('shared-user').record);
    primeRelayAppUserAuth(source.value, 'https://relay.example.com', 'copy-secret');
    const target = createClient();
    const originalSave = target.authStore.save.bind(target.authStore);
    target.authStore.save = (token, record) => {
      originalSave(token, record ? { ...record, collectionName: '_superusers' } : record);
    };

    await expect(
      authenticateRelayAppUserShared(target.value, 'https://relay.example.com', 'copy-secret'),
    ).rejects.toThrow('PocketBase did not accept the shared Relay app-user session');
  });

  it('lets one caller abort without cancelling a matching caller that still needs the login', async () => {
    const pending = deferred<AuthSnapshot>();
    let sharedSignal: AbortSignal | undefined;
    const owner = createClient((_email, _secret, options) => {
      sharedSignal = options.signal;
      return pending.promise;
    });
    queueAuthOwner(owner);
    const first = createClient();
    const second = createClient();
    const firstController = new AbortController();
    const secondController = new AbortController();

    const firstAuth = authenticateRelayAppUserShared(
      first.value,
      'https://relay.example.com',
      'shared-secret',
      { signal: firstController.signal },
    );
    const secondAuth = authenticateRelayAppUserShared(
      second.value,
      'https://relay.example.com',
      'shared-secret',
      { signal: secondController.signal },
    );
    await vi.waitFor(() => expect(owner.authWithPassword).toHaveBeenCalledOnce());
    firstController.abort();

    await expect(firstAuth).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedSignal?.aborted).toBe(false);
    pending.resolve(snapshot('remaining-caller'));
    await expect(secondAuth).resolves.toBeUndefined();
    expect(first.authStore.isValid).toBe(false);
    expect(second.authStore.isValid).toBe(true);
    expect(owner.authStore.isValid).toBe(false);
  });

  it('aborts the underlying request when its last caller stops waiting', async () => {
    let sharedSignal: AbortSignal | undefined;
    const owner = createClient(
      (_email, _secret, options) =>
        new Promise((_resolve, reject) => {
          sharedSignal = options.signal;
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    queueAuthOwner(owner);
    const client = createClient();
    const controller = new AbortController();

    const authentication = authenticateRelayAppUserShared(
      client.value,
      'https://relay.example.com',
      'shared-secret',
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(owner.authWithPassword).toHaveBeenCalledOnce());
    controller.abort();

    await expect(authentication).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedSignal?.aborted).toBe(true);
    expect(client.authStore.isValid).toBe(false);
    expect(owner.authStore.isValid).toBe(false);
  });

  it('bounds a hung shared authentication even when the caller has no signal', async () => {
    vi.useFakeTimers();
    let sharedSignal: AbortSignal | undefined;
    const owner = createClient(
      (_email, _secret, options) =>
        new Promise((_resolve, reject) => {
          sharedSignal = options.signal;
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    queueAuthOwner(owner);
    const client = createClient();

    const authentication = authenticateRelayAppUserShared(
      client.value,
      'https://relay.example.com',
      'shared-secret',
    );
    const rejection = expect(authentication).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(15_001);

    await rejection;
    expect(sharedSignal?.aborted).toBe(true);
    expect(client.authStore.isValid).toBe(false);
    expect(owner.authStore.isValid).toBe(false);
  });

  it('reset aborts in-flight work and a stale completion cannot repopulate the cache', async () => {
    const pending = deferred<AuthSnapshot>();
    let sharedSignal: AbortSignal | undefined;
    const owner = createClient((_email, _secret, options) => {
      sharedSignal = options.signal;
      return pending.promise;
    });
    queueAuthOwner(owner);
    const first = createClient();
    const second = createClient();
    const firstInFlight = authenticateRelayAppUserShared(
      first.value,
      'https://relay.example.com',
      'shared-secret',
    );
    const secondInFlight = authenticateRelayAppUserShared(
      second.value,
      'https://relay.example.com',
      'shared-secret',
    );
    await vi.waitFor(() => expect(owner.authWithPassword).toHaveBeenCalledOnce());
    const firstRejection = expect(firstInFlight).rejects.toMatchObject({ name: 'AbortError' });
    const secondRejection = expect(secondInFlight).rejects.toMatchObject({ name: 'AbortError' });

    clearRelayAppUserAuthCoordinator();
    await Promise.all([firstRejection, secondRejection]);
    expect(sharedSignal?.aborted).toBe(true);
    expect(first.authStore.isValid).toBe(false);
    expect(second.authStore.isValid).toBe(false);
    pending.resolve(snapshot('stale-user'));
    await owner.authWithPassword.mock.results[0]?.value;
    expect(owner.authStore.isValid).toBe(false);
    expect(second.authStore.isValid).toBe(false);

    const afterReset = createClient();
    await authenticateRelayAppUserShared(
      afterReset.value,
      'https://relay.example.com',
      'shared-secret',
    );
    expect(afterReset.authWithPassword).not.toHaveBeenCalled();
    expect(createdOwners.at(-1)?.authWithPassword).toHaveBeenCalledOnce();
    expect(afterReset.authStore.record?.id).toBe('relay-user');
  });

  it('late owner cleanup never clears a newer target session after reset', async () => {
    const pending = deferred<AuthSnapshot>();
    const owner = createClient(() => pending.promise);
    queueAuthOwner(owner);
    const target = createClient();
    const inFlight = authenticateRelayAppUserShared(
      target.value,
      'https://relay.example.com',
      'shared-secret',
    );
    await vi.waitFor(() => expect(owner.authWithPassword).toHaveBeenCalledOnce());
    const rejection = expect(inFlight).rejects.toMatchObject({ name: 'AbortError' });

    clearRelayAppUserAuthCoordinator();
    await rejection;
    target.authStore.save('valid-token-new-runtime', snapshot('new-runtime').record);
    pending.resolve(snapshot('stale-runtime'));
    await owner.authWithPassword.mock.results[0]?.value;

    expect(owner.authStore.isValid).toBe(false);
    expect(target.authStore).toMatchObject({
      isValid: true,
      token: 'valid-token-new-runtime',
      record: { id: 'new-runtime' },
    });
  });

  it('force refreshes through the same single-flight without using a completed snapshot', async () => {
    const first = createClient();
    await authenticateRelayAppUserShared(first.value, 'https://relay.example.com', 'shared-secret');
    const refresh = createClient();

    await authenticateRelayAppUserShared(
      refresh.value,
      'https://relay.example.com',
      'shared-secret',
      { forceRefresh: true },
    );

    expect(refresh.authWithPassword).not.toHaveBeenCalled();
    expect(createdOwners).toHaveLength(2);
    expect(createdOwners[1]?.authWithPassword).toHaveBeenCalledOnce();
  });

  it('evicts the oldest completed snapshot instead of growing without bound', async () => {
    for (let index = 0; index < 17; index += 1) {
      const client = createClient();
      await authenticateRelayAppUserShared(
        client.value,
        'https://relay.example.com',
        `secret-${index}`,
      );
    }
    const oldest = createClient();

    await authenticateRelayAppUserShared(oldest.value, 'https://relay.example.com', 'secret-0');

    expect(oldest.authWithPassword).not.toHaveBeenCalled();
    expect(createdOwners).toHaveLength(18);
    expect(createdOwners[17]?.authWithPassword).toHaveBeenCalledOnce();
  });

  it('rejects excess distinct in-flight credentials instead of growing without bound', async () => {
    const owners = Array.from({ length: 16 }, () =>
      createClient(
        (_email, _secret, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      ),
    );
    owners.forEach(queueAuthOwner);
    const clients = Array.from({ length: 16 }, () => createClient());
    const inFlight = clients.map((client, index) =>
      authenticateRelayAppUserShared(
        client.value,
        'https://relay.example.com',
        `pending-secret-${index}`,
      ),
    );
    const settlements = Promise.allSettled(inFlight);
    await vi.waitFor(() =>
      expect(owners.every((owner) => owner.authWithPassword.mock.calls.length === 1)).toBe(true),
    );
    const excess = createClient();

    await expect(
      authenticateRelayAppUserShared(
        excess.value,
        'https://relay.example.com',
        'pending-secret-16',
      ),
    ).rejects.toThrow('Relay app-user authentication capacity is temporarily unavailable');
    expect(excess.authWithPassword).not.toHaveBeenCalled();

    clearRelayAppUserAuthCoordinator();
    expect(await settlements).toEqual(
      Array.from({ length: 16 }, () =>
        expect.objectContaining({
          status: 'rejected',
          reason: expect.objectContaining({ name: 'AbortError' }),
        }),
      ),
    );
    expect(owners.every((owner) => owner.authStore.isValid === false)).toBe(true);
  });

  it('bounds recent authentication windows for distinct credentials', async () => {
    for (let index = 0; index < 32; index += 1) {
      queueAuthOwner(
        createClient(async () => {
          throw Object.assign(new Error('temporary server failure'), { status: 500 });
        }),
      );
      await expect(
        authenticateRelayAppUserShared(
          createClient().value,
          'https://relay.example.com',
          `failed-secret-${index}`,
        ),
      ).rejects.toMatchObject({ status: 500 });
    }

    await expect(
      authenticateRelayAppUserShared(
        createClient().value,
        'https://relay.example.com',
        'failed-secret-32',
      ),
    ).rejects.toThrow('Relay app-user authentication capacity is temporarily unavailable');
    expect(createdOwners).toHaveLength(32);
  });

  it('clears completed sessions so runtime reconfiguration cannot reuse old credentials', async () => {
    const first = createClient();
    await authenticateRelayAppUserShared(first.value, 'https://relay.example.com', 'shared-secret');
    clearRelayAppUserAuthCoordinator();
    const afterReconfigure = createClient();

    await authenticateRelayAppUserShared(
      afterReconfigure.value,
      'https://relay.example.com',
      'shared-secret',
    );

    expect(afterReconfigure.authWithPassword).not.toHaveBeenCalled();
    expect(createdOwners).toHaveLength(2);
    expect(createdOwners[1]?.authWithPassword).toHaveBeenCalledOnce();
  });
});
