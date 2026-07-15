import { BaseAuthStore, ClientResponseError } from 'pocketbase';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RELAY_PRIVILEGED_ACCOUNTS_COLLECTION } from '@shared/privilegedAccess';
import {
  PrivilegedAuthenticationError,
  PrivilegedPocketBaseClient,
  type PrivilegedPocketBaseClientAdapter,
} from '../PrivilegedPocketBaseClient';

const OPERATOR_ID = 'operator-ryan-bledsoe';
const PASSWORD = 'Test-access-value-123!';
const RAW_TOKEN = 'raw-privileged-token-value';

function accountRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-admin',
    collectionName: RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
    operatorId: OPERATOR_ID,
    role: 'admin',
    active: true,
    mustChangePassword: false,
    credentialVersion: 1,
    created: '2026-07-15T12:00:00.000Z',
    updated: '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('PrivilegedPocketBaseClient', () => {
  let authStores: BaseAuthStore[];
  let adapters: PrivilegedPocketBaseClientAdapter[];
  let authWithPassword: ReturnType<typeof vi.fn>;
  let createRecord: ReturnType<typeof vi.fn>;
  let getOne: ReturnType<typeof vi.fn>;
  let getFirstListItem: ReturnType<typeof vi.fn>;
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
    createClient = vi.fn((serverUrl: string, authStore: BaseAuthStore) => {
      authStores.push(authStore);
      const adapter: PrivilegedPocketBaseClientAdapter = {
        baseURL: serverUrl,
        authStore,
        cancelAllRequests: vi.fn(),
        collection: vi.fn(() => ({
          authWithPassword,
          create: createRecord,
          getOne,
          getFirstListItem,
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

    await client.authenticate(OPERATOR_ID, PASSWORD);

    expect(authStores).toHaveLength(1);
    expect(authStores[0]).toBeInstanceOf(BaseAuthStore);
    expect(authStores[0]).not.toBe(sharedAuthStore);
    expect(sharedAuthStore.token).toBe('shared-app-token');
    expect(sharedAuthStore.record).toEqual({ id: 'shared-user' });
  });

  it('authenticates only against the privileged collection and returns sanitized account data', async () => {
    const client = createPrivilegedClient();

    const account = await client.authenticate(OPERATOR_ID, PASSWORD);

    expect(adapters[0]?.collection).toHaveBeenCalledWith(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION);
    expect(authWithPassword).toHaveBeenCalledWith(OPERATOR_ID, PASSWORD, { requestKey: null });
    expect(account).toEqual(accountRecord({ collectionName: undefined }));
    expect(JSON.stringify(account)).not.toContain(RAW_TOKEN);
    expect(Object.keys(account)).not.toContain('token');
  });

  it('clears privileged authentication on disconnect and reconfigure', async () => {
    const client = createPrivilegedClient();
    await client.authenticate(OPERATOR_ID, PASSWORD);
    const originalStore = authStores[0] as BaseAuthStore;

    client.disconnect();
    expect(originalStore.token).toBe('');
    expect(adapters[0]?.cancelAllRequests).toHaveBeenCalled();

    await client.authenticate(OPERATOR_ID, PASSWORD);
    client.reconfigure('https://relay-two.example.com', false);

    expect(originalStore.token).toBe('');
    expect(authStores).toHaveLength(2);
    expect(authStores[1]).not.toBe(originalStore);
    expect(adapters[1]?.baseURL).toBe('https://relay-two.example.com');
  });

  it('maps invalid credentials to a generic error without retaining server details', async () => {
    authWithPassword.mockRejectedValueOnce(
      new ClientResponseError({
        status: 400,
        response: { message: 'operatorId or credential was wrong: sensitive detail' },
      }),
    );
    const client = createPrivilegedClient();

    let error: unknown;
    try {
      await client.authenticate(OPERATOR_ID, PASSWORD);
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

    await expect(client.authenticate(OPERATOR_ID, PASSWORD)).rejects.toMatchObject({
      code: 'offline',
      message: 'Privileged access is unavailable while Relay is offline.',
    });
  });

  it('rejects malformed or mismatched account responses and clears their tokens', async () => {
    authWithPassword.mockImplementationOnce(async () => {
      const authStore = authStores.at(-1) as BaseAuthStore;
      const record = accountRecord({ operatorId: 'different-operator' });
      authStore.save(RAW_TOKEN, record);
      return { token: RAW_TOKEN, record };
    });
    const client = createPrivilegedClient();

    await expect(client.authenticate(OPERATOR_ID, PASSWORD)).rejects.toMatchObject({
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

    await client.authenticate(OPERATOR_ID, PASSWORD);
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
