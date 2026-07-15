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
const mockPrivilegedStateCreate = vi.fn();
const mockPrivilegedStateUpdate = vi.fn();
const mockPrivilegedAccountGetList = vi.fn();
const mockPrivilegedAccountCreate = vi.fn();
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
      create: mockPrivilegedStateCreate,
      update: mockPrivilegedStateUpdate,
    };
  }
  if (name === 'relay_privileged_accounts') {
    return {
      getList: mockPrivilegedAccountGetList,
      create: mockPrivilegedAccountCreate,
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
  mockPrivilegedStateCreate.mockReset();
  mockPrivilegedStateUpdate.mockReset();
  mockPrivilegedAccountGetList.mockReset();
  mockPrivilegedAccountCreate.mockReset();
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
        publisherOperatorId: null,
        assignmentVersion: 1,
        rosterMigrationVersion: 1,
      },
    ],
  });
  mockPrivilegedStateCreate.mockResolvedValue({});
  mockPrivilegedStateUpdate.mockResolvedValue({});
  mockPrivilegedAccountGetList.mockResolvedValue({
    totalItems: 1,
    items: [{ id: 'admin-account', operatorId: 'operator-ryan-bledsoe', role: 'admin' }],
  });
  mockPrivilegedAccountCreate.mockResolvedValue({});
  mockBatchSend.mockResolvedValue([]);
});

function beginRosterMigration(state: Array<Record<string, unknown>> = []): void {
  mockPrivilegedStateGetList.mockResolvedValue({ totalItems: state.length, items: state });
  mockPrivilegedAccountGetList.mockResolvedValue({ totalItems: 0, items: [] });
}

describe('ensureCollections', () => {
  it('leaves unknown collections untouched during startup bootstrap', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'col1', name: 'contacts' },
      { id: 'col2', name: 'oncall_layout' },
      { id: 'col3', name: 'servers' },
    ]);
    mockCreate.mockResolvedValue({});
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
    mockCreate.mockResolvedValue({});
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
    mockCreate.mockResolvedValue({});
    mockGetOne.mockResolvedValue({ fields: [] });
    mockUpdate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('creates missing collections including alert reminders, operators, and privileged access', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockCreate).toHaveBeenCalledTimes(24);
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
    ).toBe(true);
    for (const name of [
      'relay_privileged_accounts',
      'relay_privileged_state',
      'relay_privileged_devices',
      'relay_privileged_commands',
    ]) {
      expect(
        mockCreate.mock.calls.some(
          (call: unknown[]) => (call[0] as { name: string }).name === name,
        ),
      ).toBe(true);
    }
  });

  it('creates a server-hidden password auth collection keyed by stable operator ID', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

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
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      authRule: 'active = true',
      manageRule: null,
      passwordAuth: { enabled: true, identityFields: ['operatorId'] },
    });
    expect(definition?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'operatorId', type: 'text', required: true }),
        expect.objectContaining({
          name: 'role',
          type: 'select',
          values: ['admin', 'publisher'],
          maxSelect: 1,
        }),
        expect.objectContaining({ name: 'active', type: 'bool' }),
        expect.objectContaining({ name: 'mustChangePassword', type: 'bool' }),
        expect.objectContaining({ name: 'credentialVersion', type: 'number' }),
      ]),
    );
    expect(definition?.fields.some((field) => field.name === 'created')).toBe(false);
    expect(definition?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_relay_privileged_accounts_operator_id ON relay_privileged_accounts (operatorId)',
    );
  });

  it('creates public role state with server-only writes and a roster migration marker', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

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
        expect.objectContaining({ name: 'adminOperatorId', type: 'text', required: true }),
        expect.objectContaining({ name: 'publisherOperatorId', type: 'text' }),
        expect.objectContaining({ name: 'assignmentVersion', type: 'number', required: true }),
        expect.objectContaining({ name: 'rosterMigrationVersion', type: 'number', required: true }),
      ]),
    );
    expect(definition?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_relay_privileged_state_key ON relay_privileged_state (key)',
    );
  });

  it('keeps devices server-hidden and scopes command creation to its active privileged account', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

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
    expect(commands?.createRule).toContain('operatorId = @request.auth.operatorId');
    expect(commands?.createRule).toContain('deviceId != ""');
    expect(commands?.createRule).toContain('signature != ""');
    expect(commands).toMatchObject({ updateRule: null, deleteRule: null });
    expect(commands?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'requestId', type: 'text', required: true, max: 128 }),
        expect.objectContaining({ name: 'deviceId', type: 'text', required: false }),
        expect.objectContaining({ name: 'payload', type: 'json', required: true }),
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

  it('creates a protected server-owned knowledge document collection', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

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
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(knowledgeCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sourceKey', type: 'text', required: true, max: 512 }),
        expect.objectContaining({ name: 'category', type: 'text', required: true, max: 120 }),
        expect.objectContaining({ name: 'title', type: 'text', required: true, max: 240 }),
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
  });

  it('creates a server-owned operator collection with authenticated read and subscription access', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

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

    expect(operatorsCall).toMatchObject({
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    expect(operatorsCall?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'displayName',
          type: 'text',
          required: true,
          max: 120,
        }),
        expect.objectContaining({ name: 'active', type: 'bool' }),
        expect.objectContaining({
          name: 'created',
          type: 'autodate',
          onCreate: true,
          onUpdate: false,
        }),
        expect.objectContaining({
          name: 'updated',
          type: 'autodate',
          onCreate: true,
          onUpdate: true,
        }),
      ]),
    );
    expect(operatorsCall?.indexes).toContain(
      'CREATE UNIQUE INDEX idx_relay_operators_display_name_nocase ON relay_operators (displayName COLLATE NOCASE)',
    );
  });

  it('seeds the exact approved operator roster when the collection is empty', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    beginRosterMigration();
    mockCollectionGetList.mockResolvedValueOnce({ totalItems: 0, items: [] });

    await ensureCollections(mockPb);

    expect(mockPbCollection).toHaveBeenCalledWith('relay_operators');
    expect(mockCollectionGetList).toHaveBeenCalledWith(1, 500, { requestKey: null });
    expect(mockCollectionCreate.mock.calls.map(([record]) => record)).toEqual([
      { displayName: 'Charles Gibbs', active: true },
      { displayName: 'Connor McElroy', active: true },
      { displayName: 'Paris Carlson', active: true },
      { displayName: 'Ryan Bell', active: true },
      { displayName: 'Ryan Bledsoe', active: true },
      { displayName: 'Tristan Bowles', active: true },
      { displayName: 'Tristan Stillwell', active: true },
      { displayName: 'Vlad McCarty', active: true },
      { displayName: 'Weston Yokley', active: true },
    ]);
    expect(mockPrivilegedAccountCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: 'operator-ryan-bledsoe',
        role: 'admin',
        active: false,
        mustChangePassword: true,
        credentialVersion: 0,
        password: expect.any(String),
        passwordConfirm: expect.any(String),
      }),
    );
    const credential = mockPrivilegedAccountCreate.mock.calls[0]?.[0] as {
      password: string;
      passwordConfirm: string;
    };
    expect(credential.password).toBe(credential.passwordConfirm);
    expect(credential.password.length).toBeGreaterThanOrEqual(64);
    expect(mockPrivilegedStateCreate).toHaveBeenCalledWith({
      key: 'primary',
      adminOperatorId: 'operator-ryan-bledsoe',
      publisherOperatorId: '',
      assignmentVersion: 1,
      rosterMigrationVersion: 1,
      updatedByOperatorId: '',
      updatedAt: expect.any(String),
    });
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it('recovers only missing initial operators before the migration marker is committed', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    beginRosterMigration();
    mockCollectionGetList.mockResolvedValueOnce({
      totalItems: 3,
      items: [
        { id: 'charles', displayName: 'Charles Gibbs', active: true },
        { id: 'connor', displayName: 'Connor McElroy', active: true },
        { id: 'paris', displayName: 'Paris Carlson', active: true },
      ],
    });

    await ensureCollections(mockPb);

    expect(mockCollectionCreate.mock.calls.map(([record]) => record)).toEqual([
      { displayName: 'Ryan Bell', active: true },
      { displayName: 'Ryan Bledsoe', active: true },
      { displayName: 'Tristan Bowles', active: true },
      { displayName: 'Tristan Stillwell', active: true },
      { displayName: 'Vlad McCarty', active: true },
      { displayName: 'Weston Yokley', active: true },
    ]);
    expect(mockPrivilegedStateCreate).toHaveBeenCalledOnce();
  });

  it('adds only the two approved new profiles to an established seven-person roster', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    beginRosterMigration();
    mockCollectionGetList.mockResolvedValueOnce({
      totalItems: 7,
      items: [
        { id: 'ryan', displayName: 'Ryan Bell', active: true },
        { id: 'tristan', displayName: 'Tristan Stillwell', active: true },
        { id: 'vlad', displayName: 'Vlad McCarty', active: true },
        { id: 'paris', displayName: 'Paris Carlson', active: true },
        { id: 'connor', displayName: 'Connor McElroy', active: true },
        { id: 'weston', displayName: 'Weston Yokley', active: true },
        { id: 'charles', displayName: 'Charles Gibbs', active: true },
      ],
    });

    await ensureCollections(mockPb);

    expect(mockCollectionCreate.mock.calls.map(([record]) => record)).toEqual([
      { displayName: 'Ryan Bledsoe', active: true },
      { displayName: 'Tristan Bowles', active: true },
    ]);
  });

  it('adds the privileged profiles without changing a customized roster', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    beginRosterMigration();
    mockCollectionGetList.mockResolvedValueOnce({
      totalItems: 2,
      items: [
        { id: 'custom', displayName: 'Taylor Example', active: true },
        { id: 'ryan', displayName: 'Ryan B.', active: false },
      ],
    });

    await ensureCollections(mockPb);

    expect(mockCollectionCreate.mock.calls.map(([record]) => record)).toEqual([
      { displayName: 'Ryan Bledsoe', active: true },
      { displayName: 'Tristan Bowles', active: true },
    ]);
    expect(mockCollectionUpdate).not.toHaveBeenCalled();
  });

  it('does not recreate privileged profiles after the migration marker is committed', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    mockCollectionGetList.mockResolvedValueOnce({
      totalItems: 2,
      items: [
        { id: 'admin', displayName: 'Ryan B.', active: false },
        { id: 'publisher', displayName: 'Tristan B.', active: false },
      ],
    });

    await ensureCollections(mockPb);

    expect(mockCollectionCreate).not.toHaveBeenCalled();
    expect(mockCollectionGetList).not.toHaveBeenCalled();
  });

  it('leaves an incomplete operator roster page untouched and migration pending', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    beginRosterMigration();
    mockCollectionGetList.mockResolvedValueOnce({
      totalItems: 5,
      items: [
        { id: 'ryan', displayName: 'Ryan Bell', active: true },
        { id: 'tristan', displayName: 'Tristan Stillwell', active: true },
        { id: 'vlad', displayName: 'Vlad McCarty', active: true },
      ],
    });

    await ensureCollections(mockPb);

    expect(mockCollectionCreate).not.toHaveBeenCalled();
    expect(mockPrivilegedStateCreate).not.toHaveBeenCalled();
    expect(mockPrivilegedAccountCreate).not.toHaveBeenCalled();
  });

  it('creates a read-only shared cloud status singleton collection', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

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
    mockCreate.mockResolvedValue({});

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
      expect.objectContaining({ name: 'operatorId', type: 'text' }),
    );
    expect(statesCall?.fields).toContainEqual(
      expect.objectContaining({ name: 'operatorId', type: 'text' }),
    );
    expect(syncCall?.fields).toContainEqual(
      expect.objectContaining({ name: 'lastReconciledAt', type: 'date' }),
    );
  });

  it('patches operator attribution onto existing Dynatrace records without rebuilding them', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'states-col', name: 'dynatrace_problem_states' },
      { id: 'notes-col', name: 'dynatrace_problem_notes' },
    ]);
    mockCreate.mockResolvedValue({});
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
    mockCreate.mockResolvedValue({});

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
    expect(schema.find((f) => f.name === 'operatorId')).toMatchObject({ type: 'text' });
    expect(schema.find((f) => f.name === 'alertSender')).toMatchObject({ type: 'text' });
  });

  it('patches alert reminder attribution fields onto an existing collection', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'reminders-col', name: 'alert_reminders' }]);
    mockCreate.mockResolvedValue({});
    mockGetOne.mockResolvedValue({
      fields: [
        { type: 'text', name: 'title', required: true },
        { type: 'text', name: 'createdBy' },
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
        expect.objectContaining({ name: 'alertSender', type: 'text' }),
      ]),
    );
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('includes teamId in the oncall collection schema', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

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
    mockCreate.mockResolvedValue({});

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
    mockCreate.mockResolvedValue({});

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
    mockCreate.mockResolvedValue({});
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
    mockCreate.mockResolvedValue({});
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
    mockCreate.mockResolvedValue({});
    mockGetOne.mockResolvedValue({
      fields: [{ type: 'text', name: 'name', required: true }],
    });
    mockUpdate.mockRejectedValueOnce(new Error('patch denied'));

    await expect(ensureCollections(mockPb)).rejects.toThrow('Failed to patch collection: contacts');
  });
});
