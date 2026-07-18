import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetFullList = vi.fn();
const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockGetOne = vi.fn();
const mockUpdate = vi.fn();
const mockCollectionGetFullList = vi.fn();
const mockCollectionGetList = vi.fn();
const mockCollectionCreate = vi.fn();
const mockCollectionUpdate = vi.fn();
const mockCollectionDelete = vi.fn();
const mockPrivilegedStateGetList = vi.fn();
const mockPrivilegedStateGetFullList = vi.fn();
const mockPrivilegedStateCreate = vi.fn();
const mockPrivilegedStateUpdate = vi.fn();
const mockPrivilegedAccountGetList = vi.fn();
const mockPrivilegedAccountGetFullList = vi.fn();
const mockPrivilegedAccountCreate = vi.fn();
const mockPrivilegedAccountUpdate = vi.fn();
const mockKnowledgeStateGetList = vi.fn();
const mockKnowledgeStateCreate = vi.fn();
const mockKnowledgeStateUpdate = vi.fn();
const mockBatchCreate = vi.fn();
const mockBatchSend = vi.fn();
const mockCreateBatch = vi.fn(() => ({
  collection: () => ({ create: mockBatchCreate }),
  send: mockBatchSend,
}));

const mockPbCollection = vi.fn((name: string) => {
  if (name === 'relay_privileged_state') {
    return {
      getList: mockPrivilegedStateGetList,
      getFullList: mockPrivilegedStateGetFullList,
      create: mockPrivilegedStateCreate,
      update: mockPrivilegedStateUpdate,
    };
  }
  if (name === 'relay_privileged_accounts') {
    return {
      getList: mockPrivilegedAccountGetList,
      getFullList: mockPrivilegedAccountGetFullList,
      create: mockPrivilegedAccountCreate,
      update: mockPrivilegedAccountUpdate,
    };
  }
  if (name === 'knowledge_library_state') {
    return {
      getList: mockKnowledgeStateGetList,
      create: mockKnowledgeStateCreate,
      update: mockKnowledgeStateUpdate,
    };
  }
  return {
    getFullList: mockCollectionGetFullList,
    getList: mockCollectionGetList,
    create: mockCollectionCreate,
    update: mockCollectionUpdate,
    delete: mockCollectionDelete,
  };
});

const mockPb = {
  collections: {
    getFullList: mockGetFullList,
    create: mockCreate,
    delete: mockDelete,
    getOne: mockGetOne,
    update: mockUpdate,
  },
  collection: mockPbCollection,
  createBatch: mockCreateBatch,
} as never;

import { ensureCollections } from '../CollectionBootstrap';

beforeEach(() => {
  vi.clearAllMocks();
  mockCollectionGetList.mockReset();
  mockCollectionCreate.mockReset();
  mockPrivilegedStateGetList.mockReset();
  mockPrivilegedStateGetFullList.mockReset();
  mockPrivilegedStateCreate.mockReset();
  mockPrivilegedStateUpdate.mockReset();
  mockPrivilegedAccountGetList.mockReset();
  mockPrivilegedAccountGetFullList.mockReset();
  mockPrivilegedAccountCreate.mockReset();
  mockPrivilegedAccountUpdate.mockReset();
  mockKnowledgeStateGetList.mockReset();
  mockKnowledgeStateCreate.mockReset();
  mockKnowledgeStateUpdate.mockReset();
  mockCollectionGetList.mockResolvedValue({
    totalItems: 1,
    items: [{ id: 'custom', displayName: 'Custom Operator', active: true }],
  });
  mockCollectionCreate.mockImplementation(async (record: { displayName?: string }) => ({
    id: record.displayName
      ? `operator-${record.displayName.toLocaleLowerCase('en').replace(/[^a-z]+/g, '-')}`
      : 'record-created',
    ...record,
  }));
  mockPrivilegedStateGetList.mockResolvedValue({
    totalItems: 1,
    items: [
      {
        id: 'privileged-state',
        key: 'primary',
        adminOperatorId: 'operator-ryan-bledsoe',
        adminOperatorIds: ['operator-ryan-bledsoe', 'operator-charles-gibbs'],
        publisherOperatorId: null,
        assignmentVersion: 1,
        rosterMigrationVersion: 2,
      },
    ],
  });
  mockPrivilegedStateGetFullList.mockResolvedValue([]);
  mockPrivilegedStateCreate.mockImplementation(async (record: Record<string, unknown>) => ({
    id: 'privileged-state',
    ...record,
  }));
  mockPrivilegedStateUpdate.mockResolvedValue({});
  mockPrivilegedAccountGetList.mockResolvedValue({
    totalItems: 1,
    items: [{ id: 'admin-account', operatorId: 'operator-ryan-bledsoe', role: 'admin' }],
  });
  mockPrivilegedAccountGetFullList.mockResolvedValue([]);
  mockPrivilegedAccountCreate.mockImplementation(async (record: Record<string, unknown>) => ({
    id: `account-${String(record.username ?? 'legacy')}`,
    ...record,
  }));
  mockPrivilegedAccountUpdate.mockResolvedValue({});
  mockKnowledgeStateGetList.mockResolvedValue({
    totalItems: 1,
    items: [{ id: 'knowledge-state', key: 'primary', mode: 'managed', revision: 1 }],
  });
  mockKnowledgeStateCreate.mockResolvedValue({});
  mockKnowledgeStateUpdate.mockResolvedValue({});
  mockBatchSend.mockResolvedValue([]);
});

function mockSuccessfulCollectionCreation(): void {
  mockCreate.mockImplementation(async (value: { name: string }) => ({
    id: `${value.name}-collection-id`,
    name: value.name,
  }));
}

describe('ensureCollections', () => {
  it('seeds a managed Knowledge library state on a clean PocketBase server', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();
    mockKnowledgeStateGetList.mockResolvedValue({ totalItems: 0, items: [] });

    await ensureCollections(mockPb);

    expect(mockKnowledgeStateCreate).toHaveBeenCalledWith({
      key: 'primary',
      mode: 'managed',
      transitionedAt: expect.any(String),
      transitionedByOperatorId: '',
      safeError: '',
      revision: 1,
    });
  });

  it('leaves unknown collections untouched during startup bootstrap', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'col1', name: 'contacts' },
      { id: 'col2', name: 'oncall_layout' },
      { id: 'col3', name: 'servers' },
    ]);
    mockSuccessfulCollectionCreation();
    mockDelete.mockResolvedValue(undefined);
    mockGetOne.mockResolvedValue({ fields: [] });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockDelete).not.toHaveBeenCalledWith('col2');
  });

  it('skips system collections starting with underscore', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'sys1', name: '_superusers' },
      { id: 'sys2', name: '_pb_users_auth_' },
      { id: 'col1', name: 'contacts' },
    ]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({ fields: [] });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('skips the users collection', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'u1', name: 'users' },
      { id: 'col1', name: 'contacts' },
    ]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({ fields: [] });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('creates missing collections including alert reminders and privileged access without operators', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockImplementation(async (value: { name: string }) => ({
      id: `${value.name}-collection-id`,
      name: value.name,
    }));

    await ensureCollections(mockPb);

    expect(mockCreate).toHaveBeenCalledTimes(30);
    expect(
      mockCreate.mock.calls.some(
        (call: unknown[]) => (call[0] as { name: string }).name === 'alert_reminders',
      ),
    ).toBe(true);
    expect(
      mockCreate.mock.calls.some(
        (call: unknown[]) => (call[0] as { name: string }).name === 'client_presence',
      ),
    ).toBe(true);
    expect(
      mockCreate.mock.calls.some(
        (call: unknown[]) => (call[0] as { name: string }).name === 'relay_operators',
      ),
    ).toBe(false);
    for (const name of [
      'relay_privileged_accounts',
      'relay_privileged_state',
      'relay_privileged_devices',
      'relay_privileged_commands',
      'relay_privileged_pairing_challenges',
      'relay_privileged_pairing_requests',
    ]) {
      expect(
        mockCreate.mock.calls.some(
          (call: unknown[]) => (call[0] as { name: string }).name === name,
        ),
      ).toBe(true);
    }
  });

  it('creates a self-readable password auth collection keyed by normalized username', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const definition = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_accounts',
    )?.[0] as
      | {
          type: string;
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          authRule: string;
          manageRule: string | null;
          passwordAuth: { enabled: boolean; identityFields: string[] };
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;

    expect(definition).toMatchObject({
      type: 'auth',
      listRule:
        '@request.auth.collectionName = "relay_privileged_accounts" && id = @request.auth.id',
      viewRule:
        '@request.auth.collectionName = "relay_privileged_accounts" && id = @request.auth.id',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      authRule: 'active = true',
      manageRule: null,
      passwordAuth: { enabled: true, identityFields: ['username'] },
    });
    expect(definition?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'username', type: 'text', required: true }),
        expect.objectContaining({ name: 'displayName', type: 'text', required: true }),
        expect.objectContaining({ name: 'operatorId', type: 'text', required: false }),
        expect.objectContaining({ name: 'role', type: 'select', required: false }),
        expect.objectContaining({
          name: 'storedRole',
          type: 'select',
          values: ['administrator', 'publisher'],
          maxSelect: 1,
        }),
        expect.objectContaining({ name: 'legacyOperatorId', type: 'text', required: false }),
        expect.objectContaining({ name: 'active', type: 'bool' }),
        expect.objectContaining({ name: 'mustChangePassword', type: 'bool' }),
        expect.objectContaining({ name: 'credentialVersion', type: 'number' }),
      ]),
    );
    expect(definition?.fields.some((field) => field.name === 'created')).toBe(false);
    expect(definition?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_relay_privileged_accounts_username_nocase ON relay_privileged_accounts (username COLLATE NOCASE)',
    );
  });

  it('creates public role state with account pointers and an identity migration marker', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const definition = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_state',
    )?.[0] as
      | {
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;

    expect(definition).toMatchObject({
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(definition?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'key', type: 'text', required: true }),
        expect.objectContaining({ name: 'ownerAccountId', type: 'text', required: true }),
        expect.objectContaining({ name: 'publisherAccountId', type: 'text' }),
        expect.objectContaining({ name: 'assignmentVersion', type: 'number', required: true }),
        expect.objectContaining({
          name: 'identityMigrationVersion',
          type: 'number',
          required: true,
        }),
        expect.objectContaining({ name: 'updatedByAccountId', type: 'text' }),
        expect.objectContaining({ name: 'adminOperatorId', type: 'text', required: false }),
        expect.objectContaining({ name: 'publisherOperatorId', type: 'text', required: false }),
      ]),
    );
    expect(definition?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_relay_privileged_state_key ON relay_privileged_state (key)',
    );
  });

  it('patches populated legacy auth collections in compatibility and final phases', async () => {
    const collections = [
      { id: 'accounts-col', name: 'relay_privileged_accounts' },
      { id: 'state-col', name: 'relay_privileged_state' },
      { id: 'operators-col', name: 'relay_operators' },
      {
        id: 'login-roster-view',
        name: 'relay_login_roster',
        type: 'view',
        viewQuery: 'SELECT id, displayName FROM relay_operators WHERE active = TRUE',
      },
    ];
    mockGetFullList.mockResolvedValue(collections);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockImplementation(async (id: string) =>
      id === 'accounts-col'
        ? {
            fields: [
              { type: 'text', name: 'operatorId', required: true, max: 200 },
              {
                type: 'select',
                name: 'role',
                required: true,
                values: ['admin', 'publisher', 'operator'],
                maxSelect: 1,
              },
              { type: 'bool', name: 'active' },
              { type: 'bool', name: 'mustChangePassword' },
              { type: 'number', name: 'credentialVersion' },
            ],
            indexes: [
              'CREATE UNIQUE INDEX idx_relay_privileged_accounts_operator_id ON relay_privileged_accounts (operatorId)',
            ],
            authRule: 'active = true',
            manageRule: null,
            passwordAuth: { enabled: true, identityFields: ['operatorId'] },
          }
        : {
            fields: [
              { type: 'text', name: 'key', required: true, max: 40 },
              { type: 'text', name: 'adminOperatorId', required: true, max: 200 },
              { type: 'json', name: 'adminOperatorIds' },
              { type: 'text', name: 'publisherOperatorId', max: 200 },
              { type: 'number', name: 'assignmentVersion', required: true },
            ],
            indexes: [
              'CREATE UNIQUE INDEX idx_relay_privileged_state_key ON relay_privileged_state (key)',
            ],
            listRule: '@request.auth.id != ""',
            viewRule: '@request.auth.id != ""',
            createRule: null,
            updateRule: null,
            deleteRule: null,
          },
    );
    mockUpdate.mockResolvedValue({});
    mockDelete.mockResolvedValue(undefined);

    const accounts = [
      {
        id: 'account-ryan',
        operatorId: 'ryan-op',
        role: 'admin',
        active: true,
        mustChangePassword: false,
        credentialVersion: 5,
      },
      {
        id: 'account-charles',
        operatorId: 'charles-op',
        role: 'admin',
        active: true,
        mustChangePassword: false,
        credentialVersion: 3,
      },
    ];
    const states = [
      {
        id: 'privileged-state',
        key: 'primary',
        adminOperatorId: 'ryan-op',
        adminOperatorIds: ['ryan-op', 'charles-op'],
        publisherOperatorId: '',
        assignmentVersion: 2,
      },
    ];
    mockPrivilegedAccountGetFullList.mockImplementation(async () => structuredClone(accounts));
    mockPrivilegedStateGetFullList.mockImplementation(async () => structuredClone(states));
    mockPrivilegedAccountUpdate.mockImplementation(
      async (id: string, data: Record<string, unknown>) => {
        const account = accounts.find((candidate) => candidate.id === id)!;
        Object.assign(account, data);
        return structuredClone(account);
      },
    );
    mockPrivilegedStateUpdate.mockImplementation(
      async (id: string, data: Record<string, unknown>) => {
        const state = states.find((candidate) => candidate.id === id)!;
        Object.assign(state, data);
        return structuredClone(state);
      },
    );
    mockCollectionGetFullList.mockResolvedValue([
      { id: 'ryan-op', displayName: 'Ryan Bledsoe', active: true },
      { id: 'charles-op', displayName: 'Charles Gibbs', active: true },
    ]);

    await ensureCollections(mockPb);

    const accountSchemaPatches = mockUpdate.mock.calls
      .filter(([id]) => id === 'accounts-col')
      .map(([, update]) => update as Record<string, unknown>);
    expect(accountSchemaPatches).toHaveLength(2);
    expect(accountSchemaPatches[0]).not.toHaveProperty('passwordAuth');
    expect(
      (accountSchemaPatches[0]?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'username',
      ),
    ).toMatchObject({ required: false });
    expect(
      (accountSchemaPatches[0]?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'role',
      ),
    ).toMatchObject({ values: ['admin', 'publisher', 'operator'] });
    expect(accountSchemaPatches[1]).toMatchObject({
      passwordAuth: { enabled: true, identityFields: ['username'] },
      indexes: [
        'CREATE UNIQUE INDEX idx_relay_privileged_accounts_username_nocase ON relay_privileged_accounts (username COLLATE NOCASE)',
      ],
    });
    expect(
      (accountSchemaPatches[1]?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'username',
      ),
    ).toMatchObject({ required: true });
    expect(
      (accountSchemaPatches[1]?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'operatorId',
      ),
    ).toMatchObject({ required: false });
    expect(
      (accountSchemaPatches[1]?.fields as Array<Record<string, unknown>>).find(
        ({ name }) => name === 'role',
      ),
    ).toMatchObject({ values: ['admin', 'publisher'] });
    expect(mockDelete.mock.calls).toEqual([['login-roster-view'], ['operators-col']]);
  });

  it('does not reapply the compatibility auth identity after the roster is retired', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'accounts-col', name: 'relay_privileged_accounts' },
      { id: 'state-col', name: 'relay_privileged_state' },
    ]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({ fields: [], indexes: [] });
    mockPrivilegedAccountGetFullList.mockResolvedValue([
      {
        id: 'account-ryan',
        username: 'ryan',
        displayName: 'Ryan Bledsoe',
        storedRole: 'administrator',
      },
      {
        id: 'account-charles',
        username: 'charles',
        displayName: 'Charles Gibbs',
        storedRole: 'administrator',
      },
    ]);
    mockPrivilegedStateGetFullList.mockResolvedValue([
      {
        id: 'privileged-state',
        key: 'primary',
        ownerAccountId: 'account-ryan',
        publisherAccountId: '',
        identityMigrationVersion: 1,
      },
    ]);

    await ensureCollections(mockPb);

    const accountSchemaPatches = mockUpdate.mock.calls
      .filter(([id]) => id === 'accounts-col')
      .map(([, update]) => update as { passwordAuth?: { identityFields: string[] } });
    expect(accountSchemaPatches).not.toContainEqual(
      expect.objectContaining({
        passwordAuth: expect.objectContaining({ identityFields: ['operatorId'] }),
      }),
    );
  });

  it('keeps devices server-hidden and scopes command creation to its active privileged account', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const devices = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_devices',
    )?.[0] as Record<string, unknown> | undefined;
    const commands = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_commands',
    )?.[0] as
      | (Record<string, unknown> & {
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        })
      | undefined;

    expect(devices).toMatchObject({
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(commands?.listRule).toContain('@request.auth.collectionName');
    expect(commands?.listRule).toContain('accountId = @request.auth.id');
    expect(commands?.createRule).toContain('state = "pending"');
    expect(commands?.createRule).not.toContain('@request.auth.operatorId');
    expect(commands?.createRule).toContain('deviceId != ""');
    expect(commands?.createRule).toContain('signature != ""');
    expect(commands?.createRule).toContain('@collection.relay_privileged_devices.accountId');
    expect(commands?.createRule).toContain('@collection.relay_privileged_devices.deviceId');
    expect(commands?.createRule).toContain('@collection.relay_privileged_devices.state');
    expect(commands).toMatchObject({ updateRule: null, deleteRule: null });
    expect(commands?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'requestId', type: 'text', required: true, max: 128 }),
        expect.objectContaining({ name: 'deviceId', type: 'text', required: false }),
        expect.objectContaining({ name: 'payload', type: 'json', required: false }),
        expect.objectContaining({ name: 'hasExpectedRevision', type: 'bool' }),
        expect.objectContaining({ name: 'bodyHash', type: 'text', required: true, max: 64 }),
        expect.objectContaining({ name: 'signature', type: 'text', required: false }),
        expect.objectContaining({ name: 'proofConsumedAt', type: 'date' }),
        expect.objectContaining({
          name: 'state',
          type: 'select',
          values: ['pending', 'processing', 'succeeded', 'failed'],
        }),
      ]),
    );
    expect(commands?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_relay_privileged_commands_request_id ON relay_privileged_commands (requestId)',
    );
  });

  it('authorizes fresh role accounts by account ID without a legacy operator ID', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const definitionFor = (name: string) =>
      mockCreate.mock.calls.find(([value]) => (value as { name: string }).name === name)?.[0] as
        | {
            createRule?: string | null;
            listRule?: string | null;
            fields: Array<Record<string, unknown>>;
          }
        | undefined;
    const commands = definitionFor('relay_privileged_commands');
    const pairingRequests = definitionFor('relay_privileged_pairing_requests');
    const uploadBatches = definitionFor('knowledge_upload_batches');
    const uploads = definitionFor('knowledge_uploads');

    for (const definition of [commands, pairingRequests, uploadBatches, uploads]) {
      expect(definition?.fields).toContainEqual(
        expect.objectContaining({ name: 'operatorId', required: false }),
      );
      expect(definition?.listRule ?? '').not.toContain('@request.auth.operatorId');
      expect(definition?.createRule ?? '').not.toContain('@request.auth.operatorId');
    }
    expect(commands?.createRule).toContain('accountId = @request.auth.id');
    expect(pairingRequests?.createRule).toContain('accountId = @request.auth.id');
  });

  it('keeps challenge secrets server-hidden and scopes one-time pairing requests to the account', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const challenges = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_pairing_challenges',
    )?.[0] as (Record<string, unknown> & { fields: Array<Record<string, unknown>> }) | undefined;
    const requests = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_pairing_requests',
    )?.[0] as (Record<string, unknown> & { fields: Array<Record<string, unknown>> }) | undefined;

    expect(challenges).toMatchObject({
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(challenges?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'attempts', type: 'number', required: false }),
      ]),
    );
    expect(requests?.listRule).toContain('accountId = @request.auth.id');
    expect(requests?.createRule).not.toContain('@request.auth.operatorId');
    expect(requests?.createRule).toContain('state = "pending"');
    expect(requests).toMatchObject({ updateRule: null, deleteRule: null });
    expect(requests?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'challengeId', required: true }),
        expect.objectContaining({ name: 'code', required: true, max: 8 }),
        expect.objectContaining({ name: 'publicKey', type: 'json', required: true }),
        expect.objectContaining({ name: 'result', type: 'json' }),
      ]),
    );
  });

  it('creates a protected server-owned knowledge document collection', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockImplementation(async (value: { name: string }) => ({
      id: `${value.name}-collection-id`,
      name: value.name,
    }));

    await ensureCollections(mockPb);

    const knowledgeCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'knowledge_documents',
    )?.[0] as
      | {
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;

    expect(knowledgeCall).toMatchObject({
      listRule: '@request.auth.id != "" && lifecycleState = "active"',
      viewRule: '@request.auth.id != "" && lifecycleState = "active"',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(knowledgeCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sourceKey', type: 'text', required: true, max: 512 }),
        expect.objectContaining({ name: 'category', type: 'text', required: true, max: 120 }),
        expect.objectContaining({ name: 'title', type: 'text', required: true, max: 240 }),
        expect.objectContaining({ name: 'displayTitle', type: 'text', required: false, max: 240 }),
        expect.objectContaining({
          name: 'lifecycleState',
          type: 'select',
          required: false,
          values: ['active', 'trashed'],
        }),
        expect.objectContaining({ name: 'revision', type: 'number', required: false }),
        expect.objectContaining({ name: 'publishedByOperatorId', type: 'text' }),
        expect.objectContaining({ name: 'trashedAt', type: 'date' }),
        expect.objectContaining({ name: 'outline', type: 'json' }),
        expect.objectContaining({
          name: 'outlineSource',
          type: 'select',
          values: ['native', 'inferred', 'none'],
          maxSelect: 1,
        }),
        expect.objectContaining({
          name: 'pdf',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 50 * 1024 * 1024,
          mimeTypes: ['application/pdf'],
          protected: true,
        }),
      ]),
    );
    expect(knowledgeCall?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_knowledge_documents_source_key ON knowledge_documents (sourceKey)',
    );
    expect(knowledgeCall?.indexes).toContain(
      'CREATE INDEX idx_knowledge_documents_lifecycle ON knowledge_documents (lifecycleState)',
    );

    const uploadsCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'knowledge_uploads',
    )?.[0] as
      | {
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;
    expect(uploadsCall).toMatchObject({
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(uploadsCall?.listRule).toContain(
      '@request.auth.collectionName = "relay_privileged_accounts"',
    );
    expect(uploadsCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'requestId', required: true }),
        expect.objectContaining({
          name: 'batchId',
          type: 'relation',
          collectionId: 'knowledge_upload_batches-collection-id',
          required: true,
        }),
        expect.objectContaining({
          name: 'pdf',
          type: 'file',
          required: false,
          protected: true,
          maxSize: 50 * 1024 * 1024,
        }),
        expect.objectContaining({ name: 'chunkSize', type: 'number', required: true }),
        expect.objectContaining({ name: 'chunkCount', type: 'number', required: true }),
        expect.objectContaining({ name: 'lastActivityAt', type: 'date', required: true }),
        expect.objectContaining({ name: 'readyAt', type: 'date' }),
        expect.objectContaining({ name: 'expiresAt', type: 'date', required: true }),
      ]),
    );
    expect(uploadsCall?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_knowledge_uploads_request_id ON knowledge_uploads (requestId)',
    );

    const batchCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'knowledge_upload_batches',
    )?.[0] as
      | {
          listRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;
    expect(batchCall).toMatchObject({ createRule: null, updateRule: null, deleteRule: null });
    expect(batchCall?.listRule).toContain('accountId = @request.auth.id');
    expect(batchCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'fileCount', type: 'number', required: true }),
        expect.objectContaining({ name: 'totalBytes', type: 'number', required: true }),
        expect.objectContaining({ name: 'lastActivityAt', type: 'date', required: true }),
        expect.objectContaining({ name: 'revision', type: 'number', required: false }),
      ]),
    );
    expect(batchCall?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_knowledge_upload_batches_active_account ON knowledge_upload_batches (accountId) WHERE state = "active"',
    );

    const chunkCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'knowledge_upload_chunks',
    )?.[0] as
      | {
          listRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<Record<string, unknown>>;
          indexes: string[];
        }
      | undefined;
    expect(chunkCall).toMatchObject({ updateRule: null, deleteRule: null });
    expect(chunkCall?.listRule).toContain('accountId = @request.auth.id');
    expect(chunkCall?.createRule).toContain('@collection.knowledge_uploads.accountId');
    expect(chunkCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'uploadId',
          type: 'relation',
          collectionId: 'knowledge_uploads-collection-id',
          required: true,
        }),
        expect.objectContaining({
          name: 'batchId',
          type: 'relation',
          collectionId: 'knowledge_upload_batches-collection-id',
          required: true,
        }),
        expect.objectContaining({
          name: 'chunk',
          type: 'file',
          required: true,
          protected: true,
          maxSize: 4 * 1024 * 1024,
        }),
        expect.objectContaining({ name: 'index', type: 'number', required: false }),
      ]),
    );
    expect(chunkCall?.fields.find((field) => field.name === 'chunk')).not.toHaveProperty(
      'mimeTypes',
    );
    expect(chunkCall?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_knowledge_upload_chunk ON knowledge_upload_chunks (uploadId, `index`)',
    );

    for (const call of mockCreate.mock.calls) {
      for (const field of (call[0] as { fields?: Array<Record<string, unknown>> }).fields ?? []) {
        if (field.type === 'relation') {
          expect(field.collectionId).toMatch(/-collection-id$/);
          expect(field.collectionId).not.toBe('knowledge_uploads');
          expect(field.collectionId).not.toBe('knowledge_upload_batches');
          expect(field).not.toHaveProperty('targetCollectionName');
        }
      }
    }

    for (const collection of ['knowledge_audit_events', 'knowledge_library_state']) {
      const call = mockCreate.mock.calls.find(
        (entry: unknown[]) => (entry[0] as { name: string }).name === collection,
      )?.[0] as { listRule: string | null; createRule: string | null } | undefined;
      expect(call).toMatchObject({ listRule: null, createRule: null });
    }
  });

  it('patches an older upload schema before creating collections whose rules depend on it', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'upload-col-id', name: 'knowledge_uploads' }]);
    mockGetOne.mockImplementation(async (id: string) => ({ id, fields: [], indexes: [] }));
    let uploadSchemaPatched = false;
    mockUpdate.mockImplementation(async (id: string) => {
      if (id === 'upload-col-id') uploadSchemaPatched = true;
      return {};
    });
    mockCreate.mockImplementation(async (value: { name: string }) => {
      if (value.name === 'knowledge_upload_chunks' && !uploadSchemaPatched) {
        throw new Error('chunk rules referenced the legacy upload schema');
      }
      return { id: `${value.name}-collection-id`, name: value.name };
    });

    await expect(ensureCollections(mockPb)).resolves.toEqual({ privilegedRuntimeReady: true });

    expect(uploadSchemaPatched).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'knowledge_upload_chunks' }),
    );
  });

  it('patches existing upload manifests non-destructively with resolved relations and resumable states', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'batch-col-id', name: 'knowledge_upload_batches' },
      { id: 'upload-col-id', name: 'knowledge_uploads' },
      { id: 'chunk-col-id', name: 'knowledge_upload_chunks' },
    ]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockImplementation(async (id: string) => {
      if (id !== 'upload-col-id') return { id, fields: [], indexes: [] };
      return {
        id,
        fields: [
          {
            id: 'pdf-field-id',
            name: 'pdf',
            type: 'file',
            required: true,
            maxSelect: 1,
            maxSize: 50 * 1024 * 1024,
            mimeTypes: ['application/pdf'],
            protected: true,
          },
          {
            id: 'state-field-id',
            name: 'state',
            type: 'select',
            required: true,
            values: [
              'queued',
              'uploading',
              'validating',
              'extracting',
              'ready',
              'failed',
              'published',
            ],
            maxSelect: 1,
          },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_knowledge_uploads_request_id ON knowledge_uploads (requestId)',
        ],
      };
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    const uploadPatch = mockUpdate.mock.calls.find(([id]) => id === 'upload-col-id')?.[1] as
      | { fields?: Array<Record<string, unknown>> }
      | undefined;
    expect(uploadPatch?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'pdf-field-id',
          name: 'pdf',
          required: false,
          protected: true,
        }),
        expect.objectContaining({
          id: 'state-field-id',
          name: 'state',
          values: [
            'queued',
            'uploading',
            'assembling',
            'extracting',
            'ready',
            'failed',
            'cancelled',
            'published',
          ],
        }),
        expect.objectContaining({
          name: 'batchId',
          type: 'relation',
          collectionId: 'batch-col-id',
        }),
      ]),
    );
    expect(uploadPatch?.fields?.find(({ name }) => name === 'pdf')).toHaveProperty(
      'id',
      'pdf-field-id',
    );
  });

  it('does not recreate the retired operator collection', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const operatorsCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'relay_operators',
    )?.[0] as
      | {
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<{
            name: string;
            type: string;
            required?: boolean;
            max?: number;
            onCreate?: boolean;
            onUpdate?: boolean;
          }>;
          indexes: string[];
        }
      | undefined;

    expect(operatorsCall).toBeUndefined();
    const privilegedAccountsCall = mockCreate.mock.calls.find(
      ([value]) => (value as { name: string }).name === 'relay_privileged_accounts',
    )?.[0] as { fields: Array<{ name: string }> } | undefined;
    expect(
      privilegedAccountsCall?.fields.filter(({ name }) => name === 'mustChangePassword'),
    ).toHaveLength(1);
  });

  it('seeds pending Ryan and Charles role accounts without an operator roster', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    expect(mockPbCollection).not.toHaveBeenCalledWith('relay_operators');
    expect(mockCollectionGetList).not.toHaveBeenCalled();
    expect(mockCollectionCreate.mock.calls.map(([record]) => record)).toEqual([]);
    expect(mockPrivilegedAccountCreate).toHaveBeenCalledTimes(2);
    for (const username of ['ryan', 'charles']) {
      expect(mockPrivilegedAccountCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          email: `${username}@relay.invalid`,
          username,
          storedRole: 'administrator',
          active: false,
          mustChangePassword: true,
          credentialVersion: 0,
          password: expect.any(String),
          passwordConfirm: expect.any(String),
        }),
      );
    }
    for (const [createdAccount] of mockPrivilegedAccountCreate.mock.calls) {
      const credential = createdAccount as { password: string; passwordConfirm: string };
      expect(credential.password).toBe(credential.passwordConfirm);
      expect(credential.password.length).toBeGreaterThanOrEqual(64);
    }
    expect(mockPrivilegedStateCreate).toHaveBeenCalledWith({
      key: 'primary',
      ownerAccountId: 'account-ryan',
      publisherAccountId: '',
      assignmentVersion: 1,
      identityMigrationVersion: 1,
      updatedByAccountId: '',
    });
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it('creates a read-only shared cloud status singleton collection', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const snapshotCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'cloud_status_snapshot',
    )?.[0] as
      | {
          listRule: string | null;
          viewRule: string | null;
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<{ name: string; type: string; required?: boolean }>;
          indexes: string[];
        }
      | undefined;

    expect(snapshotCall).toMatchObject({
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(snapshotCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'key', type: 'text', required: true }),
        expect.objectContaining({ name: 'providers', type: 'json', required: true }),
        expect.objectContaining({ name: 'errors', type: 'json', required: true }),
        expect.objectContaining({ name: 'lastUpdated', type: 'number', required: true }),
        expect.objectContaining({ name: 'contentHash', type: 'text', required: true }),
      ]),
    );
    expect(snapshotCall?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_cloud_status_snapshot_key ON cloud_status_snapshot (key)',
    );
  });

  it('creates server-owned Dynatrace problem records and append-only local notes', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const problemsCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'dynatrace_problems',
    )?.[0] as
      | {
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          listRule: string | null;
          fields: Array<{ name: string; type: string }>;
        }
      | undefined;
    const notesCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'dynatrace_problem_notes',
    )?.[0] as
      | {
          createRule: string | null;
          updateRule: string | null;
          deleteRule: string | null;
          fields: Array<{ name: string; type: string; required?: boolean }>;
        }
      | undefined;
    const statesCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'dynatrace_problem_states',
    )?.[0] as
      | {
          fields: Array<{ name: string; type: string; required?: boolean }>;
        }
      | undefined;
    const syncCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'dynatrace_problem_sync',
    )?.[0] as { fields: Array<{ name: string; type: string }> } | undefined;

    expect(problemsCall).toMatchObject({
      listRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(problemsCall?.fields.some((field) => field.name === 'problemId')).toBe(true);
    expect(problemsCall?.fields.some((field) => field.name === 'alertingProfiles')).toBe(true);
    expect(notesCall).toMatchObject({
      createRule: '@request.auth.id != ""',
      updateRule: null,
      deleteRule: null,
    });
    expect(notesCall?.fields).toContainEqual(
      expect.objectContaining({ name: 'operatorId', type: 'text', required: false }),
    );
    expect(notesCall?.fields).toContainEqual(
      expect.objectContaining({ name: 'author', type: 'text', required: false }),
    );
    expect(statesCall?.fields).toContainEqual(
      expect.objectContaining({ name: 'operatorId', type: 'text', required: false }),
    );
    expect(syncCall?.fields).toContainEqual(
      expect.objectContaining({ name: 'lastReconciledAt', type: 'date' }),
    );
  });

  it('makes legacy Dynatrace attribution fields optional without rebuilding records', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'states-col', name: 'dynatrace_problem_states' },
      { id: 'notes-col', name: 'dynatrace_problem_notes' },
    ]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockImplementation(async (id: string) => ({
      fields:
        id === 'states-col'
          ? [
              { type: 'text', name: 'problemId', required: true },
              { type: 'bool', name: 'addressed' },
              { type: 'date', name: 'addressedAt' },
              { type: 'text', name: 'addressedBy' },
            ]
          : [
              { type: 'text', name: 'problemId', required: true },
              { type: 'text', name: 'note', required: true },
              { type: 'text', name: 'author', required: true },
            ],
      indexes: [],
    }));
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    for (const collectionId of ['states-col', 'notes-col']) {
      const update = mockUpdate.mock.calls.find(([id]) => id === collectionId);
      expect(update).toBeDefined();
      expect((update?.[1] as { fields: Array<{ name: string }> }).fields).toContainEqual(
        expect.objectContaining({ name: 'operatorId' }),
      );
    }
    const notesUpdate = mockUpdate.mock.calls.find(([id]) => id === 'notes-col');
    expect(
      (notesUpdate?.[1] as { fields: Array<{ name: string; required?: boolean }> }).fields,
    ).toContainEqual(expect.objectContaining({ name: 'author', required: false }));
    expect(
      mockCreate.mock.calls.some(
        ([definition]) =>
          (definition as { name: string }).name === 'dynatrace_problem_states' ||
          (definition as { name: string }).name === 'dynatrace_problem_notes',
      ),
    ).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('creates alert_reminders with scheduling and status fields', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const reminderCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'alert_reminders',
    );
    expect(reminderCall).toBeDefined();
    const schema = (
      reminderCall![0] as {
        fields: Array<{
          name: string;
          type: string;
          required?: boolean;
          values?: string[];
          maxSelect?: number;
        }>;
      }
    ).fields;

    expect(schema.find((f) => f.name === 'title')).toMatchObject({
      type: 'text',
      required: true,
    });
    expect(schema.find((f) => f.name === 'dueAt')).toMatchObject({
      type: 'date',
      required: true,
    });
    expect(schema.find((f) => f.name === 'status')).toMatchObject({
      type: 'select',
      required: true,
      values: ['pending', 'done', 'dismissed'],
      maxSelect: 1,
    });
    expect(schema.find((f) => f.name === 'snoozeUntil')).toMatchObject({ type: 'date' });
    expect(schema.find((f) => f.name === 'severity')).toMatchObject({
      type: 'select',
      values: ['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED'],
      maxSelect: 1,
    });
    expect(schema.find((f) => f.name === 'alertBodyHtml')).toMatchObject({ type: 'text' });
    expect(schema.find((f) => f.name === 'operatorId')).toMatchObject({
      type: 'text',
      required: false,
    });
    expect(schema.find((f) => f.name === 'createdBy')).toMatchObject({
      type: 'text',
      required: false,
    });
    expect(schema.find((f) => f.name === 'alertSender')).toMatchObject({ type: 'text' });
  });

  it('patches alert reminder attribution fields onto an existing collection', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'reminders-col', name: 'alert_reminders' }]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'title', required: true },
        { type: 'text', name: 'createdBy', required: true },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      indexes: [],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    const update = mockUpdate.mock.calls.find(([id]) => id === 'reminders-col');
    expect(update).toBeDefined();
    expect((update?.[1] as { fields: Array<{ name: string; type: string }> }).fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'operatorId', type: 'text' }),
        expect.objectContaining({ name: 'createdBy', type: 'text', required: false }),
        expect.objectContaining({ name: 'alertSender', type: 'text' }),
      ]),
    );
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('includes teamId in the oncall collection schema', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const oncallCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'oncall',
    );
    expect(oncallCall).toBeDefined();
    const oncallSchema = (oncallCall![0] as { fields: Array<{ name: string; type: string }> })
      .fields;
    const teamIdField = oncallSchema.find((f) => f.name === 'teamId');
    expect(teamIdField).toBeDefined();
    expect(teamIdField!.type).toBe('text');
  });

  it('creates oncall_board_settings with correct schema', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const settingsCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'oncall_board_settings',
    );
    expect(settingsCall).toBeDefined();
    const schema = (settingsCall![0] as { fields: Array<{ name: string; type: string }> }).fields;
    const keyField = schema.find((f) => f.name === 'key');
    expect(keyField).toBeDefined();
    expect(keyField!.type).toBe('text');
    const teamOrderField = schema.find((f) => f.name === 'teamOrder');
    expect(teamOrderField).toBeDefined();
    expect(teamOrderField!.type).toBe('json');
    const lockedField = schema.find((f) => f.name === 'locked');
    expect(lockedField).toBeDefined();
    expect(lockedField!.type).toBe('bool');
    expect((settingsCall![0] as { indexes: string[] }).indexes).toContain(
      'CREATE UNIQUE INDEX idx_oncall_board_settings_key ON oncall_board_settings (key)',
    );
  });

  it('creates client_presence with client-only heartbeat fields', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSuccessfulCollectionCreation();

    await ensureCollections(mockPb);

    const presenceCall = mockCreate.mock.calls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === 'client_presence',
    );
    expect(presenceCall).toBeDefined();
    const schema = (
      presenceCall![0] as {
        fields: Array<{
          name: string;
          type: string;
          required?: boolean;
          values?: string[];
          maxSelect?: number;
        }>;
        indexes: string[];
      }
    ).fields;

    expect(schema.find((f) => f.name === 'sessionId')).toMatchObject({
      type: 'text',
      required: true,
    });
    expect(schema.find((f) => f.name === 'hostname')).toMatchObject({
      type: 'text',
      required: true,
    });
    expect(schema.find((f) => f.name === 'mode')).toMatchObject({
      type: 'select',
      required: true,
      values: ['client'],
      maxSelect: 1,
    });
    expect(schema.find((f) => f.name === 'lastSeen')).toMatchObject({
      type: 'date',
      required: true,
    });
    expect((presenceCall![0] as { indexes: string[] }).indexes).toContain(
      'CREATE UNIQUE INDEX idx_client_presence_session_id ON client_presence (sessionId)',
    );
  });

  it('repairs duplicate oncall board settings before patching the unique index', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'settings-col', name: 'oncall_board_settings' }]);
    mockCollectionGetFullList.mockResolvedValue([
      {
        id: 'older',
        key: 'primary',
        teamOrder: ['alpha', 'charlie'],
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      },
      {
        id: 'newer',
        key: 'primary',
        teamOrder: ['bravo', 'alpha'],
        created: '2024-01-02T00:00:00Z',
        updated: '2024-01-02T00:00:00Z',
      },
    ]);
    mockCollectionUpdate.mockResolvedValue({});
    mockCollectionDelete.mockResolvedValue(undefined);
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'key', required: true },
        { type: 'json', name: 'teamOrder' },
        { type: 'bool', name: 'locked' },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      indexes: [],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockCollectionUpdate).toHaveBeenCalledWith('newer', {
      teamOrder: ['bravo', 'alpha', 'charlie'],
    });
    expect(mockCollectionDelete).toHaveBeenCalledWith('older');
    expect(mockUpdate).toHaveBeenCalledWith('settings-col', {
      indexes: ['CREATE UNIQUE INDEX idx_oncall_board_settings_key ON oncall_board_settings (key)'],
    });
  });

  it('preserves duplicate oncall board settings when merged order cannot be saved', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'settings-col', name: 'oncall_board_settings' }]);
    mockCollectionGetFullList.mockResolvedValue([
      {
        id: 'older',
        key: 'primary',
        teamOrder: ['alpha'],
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      },
      {
        id: 'newer',
        key: 'primary',
        teamOrder: ['bravo'],
        created: '2024-01-02T00:00:00Z',
        updated: '2024-01-02T00:00:00Z',
      },
    ]);
    mockCollectionUpdate.mockRejectedValueOnce(new Error('merge failed'));
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'key', required: true },
        { type: 'json', name: 'teamOrder' },
        { type: 'bool', name: 'locked' },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      indexes: [],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockCollectionDelete).not.toHaveBeenCalled();
  });

  it('patches existing oncall collection to add missing teamId', async () => {
    // oncall exists but is missing teamId
    mockGetFullList.mockResolvedValue([{ id: 'oc-col', name: 'oncall' }]);
    mockSuccessfulCollectionCreation();
    mockDelete.mockResolvedValue(undefined);
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'team', required: true },
        { type: 'text', name: 'role' },
        { type: 'text', name: 'name' },
        { type: 'text', name: 'contact' },
        { type: 'text', name: 'timeWindow' },
        { type: 'number', name: 'sortOrder' },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    // Verify that update was called on the oncall collection to add teamId
    expect(mockUpdate).toHaveBeenCalled();
    const updateCall = mockUpdate.mock.calls.find((call: unknown[]) => call[0] === 'oc-col');
    expect(updateCall).toBeDefined();
    const updatedFields = (updateCall![1] as { fields: Array<{ name: string }> }).fields;
    const teamIdField = updatedFields.find((f) => f.name === 'teamId');
    expect(teamIdField).toBeDefined();
  });

  it('patches authenticated API rules on existing collections', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'contacts-col', name: 'contacts' }]);
    mockSuccessfulCollectionCreation();
    mockDelete.mockResolvedValue(undefined);
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'name', required: true },
        { type: 'text', name: 'email' },
        { type: 'text', name: 'phone' },
        { type: 'text', name: 'title' },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    const updateCall = mockUpdate.mock.calls.find((call: unknown[]) => call[0] === 'contacts-col');
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toMatchObject({
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
    });
  });

  it('rejects when required collections cannot be listed', async () => {
    mockGetFullList.mockRejectedValue(new Error('list unavailable'));

    await expect(ensureCollections(mockPb)).rejects.toThrow(
      'Failed to list PocketBase collections',
    );
  });

  it('rejects when a required missing collection cannot be created', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockRejectedValueOnce(new Error('create denied'));

    await expect(ensureCollections(mockPb)).rejects.toThrow(
      'Failed to create collection: contacts',
    );
  });

  it('rejects when an existing required collection cannot be patched', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'contacts-col', name: 'contacts' }]);
    mockSuccessfulCollectionCreation();
    mockGetOne.mockResolvedValue({
      fields: [{ type: 'text', name: 'name', required: true }],
    });
    mockUpdate.mockRejectedValueOnce(new Error('patch denied'));

    await expect(ensureCollections(mockPb)).rejects.toThrow('Failed to patch collection: contacts');
  });
});
