import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc';
import { type RelayOperatorRecord } from '@shared/operators';
import { setupRelayOperatorHandlers } from './relayOperatorHandlers';

type Handler = (event: unknown, input: unknown) => unknown;

function operator(overrides: Partial<RelayOperatorRecord> = {}): RelayOperatorRecord {
  return {
    id: 'operator-1',
    displayName: 'Ryan Bell',
    active: true,
    revision: 0,
    created: '2026-07-13 08:00:00.000Z',
    updated: '2026-07-13 08:00:00.000Z',
    ...overrides,
  };
}

describe('setupRelayOperatorHandlers', () => {
  const handlers: Record<string, Handler> = {};
  const ipcMain = { handle: vi.fn() };
  const collection = {
    getFullList: vi.fn(async () => [] as RelayOperatorRecord[]),
    getOne: vi.fn(async () => operator()),
    getFirstListItem: vi.fn(async () => ({
      adminOperatorId: 'admin-operator',
      publisherOperatorId: null,
    })),
    create: vi.fn(async (data: unknown) => operator(data as Partial<RelayOperatorRecord>)),
    update: vi.fn(async (id: string, data: unknown) =>
      operator({ id, ...(data as Partial<RelayOperatorRecord>) }),
    ),
  };
  const authStore = {
    isValid: true,
    record: {
      id: 'superuser-1',
      collectionId: 'pbc_3142635823',
      collectionName: '_superusers',
    } as { id: string; collectionId: string; collectionName: string } | null,
  };
  const pbClient = { authStore, collection: vi.fn(() => collection) };
  const isServer = vi.fn(() => true);
  const getPbClient = vi.fn(() => pbClient);
  const assertTrustedIpcSender = vi.fn(() => true);

  beforeEach(() => {
    vi.clearAllMocks();
    for (const channel of Object.keys(handlers)) delete handlers[channel];
    collection.getFullList.mockResolvedValue([]);
    collection.getOne.mockResolvedValue(operator());
    authStore.isValid = true;
    authStore.record = {
      id: 'superuser-1',
      collectionId: 'pbc_3142635823',
      collectionName: '_superusers',
    };
    isServer.mockReturnValue(true);
    getPbClient.mockReturnValue(pbClient);
    assertTrustedIpcSender.mockReturnValue(true);
    ipcMain.handle.mockImplementation((channel: string, handler: Handler) => {
      handlers[channel] = handler;
      return ipcMain;
    });

    setupRelayOperatorHandlers({
      ipcMain: ipcMain as never,
      isServer,
      getPbClient: getPbClient as never,
      assertTrustedIpcSender: assertTrustedIpcSender as never,
    });
  });

  it('registers only the three approved management operations', () => {
    expect(handlers).toEqual(
      expect.objectContaining({
        [IPC_CHANNELS.RELAY_OPERATOR_CREATE]: expect.any(Function),
        [IPC_CHANNELS.RELAY_OPERATOR_RENAME]: expect.any(Function),
        [IPC_CHANNELS.RELAY_OPERATOR_SET_ACTIVE]: expect.any(Function),
      }),
    );
    expect('RELAY_OPERATOR_DELETE' in IPC_CHANNELS).toBe(false);
  });

  it.each([
    ['create', () => IPC_CHANNELS.RELAY_OPERATOR_CREATE, { displayName: 'Morgan Lee' }],
    [
      'rename',
      () => IPC_CHANNELS.RELAY_OPERATOR_RENAME,
      {
        id: 'operator-1',
        displayName: 'Morgan Lee',
        expectedUpdated: '2026-07-13 08:00:00.000Z',
      },
    ],
    [
      'active-state change',
      () => IPC_CHANNELS.RELAY_OPERATOR_SET_ACTIVE,
      {
        id: 'operator-1',
        active: false,
        expectedUpdated: '2026-07-13 08:00:00.000Z',
      },
    ],
  ])('rejects an untrusted sender before %s', async (_label, getChannel, input) => {
    assertTrustedIpcSender.mockReturnValue(false);
    const channel = getChannel();
    const event = {};

    await expect(handlers[channel](event, input)).resolves.toEqual({
      success: false,
      error: 'Untrusted sender',
    });
    expect(assertTrustedIpcSender).toHaveBeenCalledWith(event, channel);
    expect(pbClient.collection).not.toHaveBeenCalled();
  });

  it('rejects management from Relay client mode', async () => {
    isServer.mockReturnValue(false);

    await expect(
      handlers[IPC_CHANNELS.RELAY_OPERATOR_CREATE]({}, { displayName: 'Morgan Lee' }),
    ).resolves.toEqual({
      success: false,
      error: 'Manage operators on the Relay server.',
    });
    expect(getPbClient).not.toHaveBeenCalled();
  });

  it('rejects management until the authenticated PocketBase client is ready', async () => {
    getPbClient.mockReturnValue(null);

    await expect(
      handlers[IPC_CHANNELS.RELAY_OPERATOR_CREATE]({}, { displayName: 'Morgan Lee' }),
    ).resolves.toEqual({
      success: false,
      error: 'Relay operator management is unavailable.',
    });
    expect(pbClient.collection).not.toHaveBeenCalled();
    expect(collection.create).not.toHaveBeenCalled();
    expect(collection.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an expired auth store',
      () => {
        authStore.isValid = false;
      },
    ],
    [
      'an ordinary app-user auth model',
      () => {
        authStore.record = {
          id: 'app-user-1',
          collectionId: 'pbc_784818227',
          collectionName: '_pb_users_auth_',
        };
      },
    ],
    [
      'a missing auth record',
      () => {
        authStore.record = null;
      },
    ],
  ])('rejects %s before every manager operation', async (_label, configureAuth) => {
    configureAuth();
    const requests = [
      [IPC_CHANNELS.RELAY_OPERATOR_CREATE, { displayName: 'Morgan Lee' }],
      [
        IPC_CHANNELS.RELAY_OPERATOR_RENAME,
        {
          id: 'operator-1',
          displayName: 'Morgan Lee',
          expectedUpdated: '2026-07-13 08:00:00.000Z',
        },
      ],
      [
        IPC_CHANNELS.RELAY_OPERATOR_SET_ACTIVE,
        {
          id: 'operator-1',
          active: false,
          expectedUpdated: '2026-07-13 08:00:00.000Z',
        },
      ],
    ] as const;

    for (const [channel, input] of requests) {
      await expect(handlers[channel]({}, input)).resolves.toEqual({
        success: false,
        error: 'Relay operator management is unavailable.',
      });
    }
    expect(pbClient.collection).not.toHaveBeenCalled();
    expect(collection.create).not.toHaveBeenCalled();
    expect(collection.update).not.toHaveBeenCalled();
  });

  it('allows an authenticated _superusers model to manage operators', async () => {
    await expect(
      handlers[IPC_CHANNELS.RELAY_OPERATOR_CREATE]({}, { displayName: 'Morgan Lee' }),
    ).resolves.toMatchObject({
      success: true,
      data: { displayName: 'Morgan Lee', active: true },
    });
    expect(authStore).toMatchObject({
      isValid: true,
      record: { collectionName: '_superusers' },
    });
    expect(collection.create).toHaveBeenCalledOnce();
  });

  it.each([
    [() => IPC_CHANNELS.RELAY_OPERATOR_CREATE, { displayName: 42 }],
    [() => IPC_CHANNELS.RELAY_OPERATOR_RENAME, { id: 'operator-1', displayName: 'Morgan Lee' }],
    [
      () => IPC_CHANNELS.RELAY_OPERATOR_SET_ACTIVE,
      {
        id: 'operator-1',
        active: 'false',
        expectedUpdated: '2026-07-13 08:00:00.000Z',
      },
    ],
  ])('rejects malformed IPC input before PocketBase access', async (getChannel, input) => {
    await expect(handlers[getChannel()]({}, input)).resolves.toEqual({
      success: false,
      error: 'Invalid Relay operator request.',
    });
    expect(pbClient.collection).not.toHaveBeenCalled();
  });

  it('returns structured success results for create, rename, and active-state changes', async () => {
    const created = await handlers[IPC_CHANNELS.RELAY_OPERATOR_CREATE](
      {},
      {
        displayName: '  Morgan   Lee ',
      },
    );
    const renamed = await handlers[IPC_CHANNELS.RELAY_OPERATOR_RENAME](
      {},
      {
        id: 'operator-1',
        displayName: 'Ryan Cooper',
        expectedUpdated: '2026-07-13 08:00:00.000Z',
      },
    );
    const deactivated = await handlers[IPC_CHANNELS.RELAY_OPERATOR_SET_ACTIVE](
      {},
      {
        id: 'operator-1',
        active: false,
        expectedUpdated: '2026-07-13 08:00:00.000Z',
      },
    );

    expect(created).toMatchObject({
      success: true,
      data: { displayName: 'Morgan Lee', active: true },
    });
    expect(renamed).toMatchObject({
      success: true,
      data: { id: 'operator-1', displayName: 'Ryan Cooper' },
    });
    expect(deactivated).toMatchObject({
      success: true,
      data: { id: 'operator-1', active: false },
    });
  });

  it('returns manager failures as structured IPC errors', async () => {
    collection.getFullList.mockResolvedValue([
      operator({ id: 'operator-2', displayName: 'MORGAN LEE', active: false }),
    ]);

    await expect(
      handlers[IPC_CHANNELS.RELAY_OPERATOR_CREATE]({}, { displayName: 'Morgan Lee' }),
    ).resolves.toEqual({
      success: false,
      error: 'An operator with this display name already exists.',
    });
  });
});
