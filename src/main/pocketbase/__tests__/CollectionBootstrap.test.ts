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
const mockBatchCreate = vi.fn();
const mockBatchSend = vi.fn();
const mockCreateBatch = vi.fn(() => ({
  collection: () => ({ create: mockBatchCreate }),
  send: mockBatchSend,
}));

const mockPbCollection = vi.fn(() => ({
  getFullList: mockCollectionGetFullList,
  getList: mockCollectionGetList,
  create: mockCollectionCreate,
  update: mockCollectionUpdate,
  delete: mockCollectionDelete,
}));

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
  mockCollectionGetList.mockResolvedValue({
    totalItems: 1,
    items: [{ id: 'custom', displayName: 'Custom Operator', active: true }],
  });
  mockCollectionCreate.mockResolvedValue({});
  mockBatchSend.mockResolvedValue([]);
});

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

  it('creates missing collections including alert_reminders, client presence, and operators', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockCreate).toHaveBeenCalledTimes(19);
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
    mockCollectionGetList.mockResolvedValueOnce({ totalItems: 0, items: [] });

    await ensureCollections(mockPb);

    expect(mockPbCollection).toHaveBeenCalledWith('relay_operators');
    expect(mockCollectionGetList).toHaveBeenCalledWith(1, 8, { requestKey: null });
    expect(mockCollectionCreate.mock.calls.map(([record]) => record)).toEqual([
      { displayName: 'Ryan Bell', active: true },
      { displayName: 'Tristan Stillwell', active: true },
      { displayName: 'Vlad McCarty', active: true },
      { displayName: 'Paris Carlson', active: true },
      { displayName: 'Connor McElroy', active: true },
      { displayName: 'Weston Yokley', active: true },
      { displayName: 'Charles Gibbs', active: true },
    ]);
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it('recovers only missing initial operators after an interrupted sequential seed', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    mockCollectionGetList
      .mockResolvedValueOnce({ totalItems: 0, items: [] })
      .mockResolvedValueOnce({
        totalItems: 3,
        items: [
          { id: 'ryan', displayName: 'Ryan Bell', active: true },
          { id: 'tristan', displayName: 'Tristan Stillwell', active: true },
          { id: 'vlad', displayName: 'Vlad McCarty', active: true },
        ],
      });
    mockCollectionCreate
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('create interrupted'));

    await expect(ensureCollections(mockPb)).rejects.toThrow('create interrupted');
    expect(mockCollectionCreate.mock.calls.map(([record]) => record)).toEqual([
      { displayName: 'Ryan Bell', active: true },
      { displayName: 'Tristan Stillwell', active: true },
      { displayName: 'Vlad McCarty', active: true },
      { displayName: 'Paris Carlson', active: true },
    ]);

    mockCollectionCreate.mockClear();
    await ensureCollections(mockPb);

    expect(mockCollectionCreate.mock.calls.map(([record]) => record)).toEqual([
      { displayName: 'Paris Carlson', active: true },
      { displayName: 'Connor McElroy', active: true },
      { displayName: 'Weston Yokley', active: true },
      { displayName: 'Charles Gibbs', active: true },
    ]);
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it('leaves a whitespace-modified initial operator subset untouched', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    mockCollectionGetList.mockResolvedValueOnce({
      totalItems: 2,
      items: [
        { id: 'ryan', displayName: ' Ryan   Bell ', active: true },
        { id: 'tristan', displayName: 'Tristan Stillwell', active: true },
      ],
    });

    await ensureCollections(mockPb);

    expect(mockCollectionCreate).not.toHaveBeenCalled();
  });

  it('leaves a renamed operator roster untouched', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    mockCollectionGetList.mockResolvedValueOnce({
      totalItems: 7,
      items: [
        { id: 'ryan', displayName: 'Ryan B.', active: true },
        { id: 'tristan', displayName: 'Tristan Stillwell', active: true },
        { id: 'vlad', displayName: 'Vlad McCarty', active: true },
        { id: 'paris', displayName: 'Paris Carlson', active: true },
        { id: 'connor', displayName: 'Connor McElroy', active: true },
        { id: 'weston', displayName: 'Weston Yokley', active: true },
        { id: 'charles', displayName: 'Charles Gibbs', active: true },
      ],
    });

    await ensureCollections(mockPb);

    expect(mockCollectionCreate).not.toHaveBeenCalled();
  });

  it('leaves an inactive initial operator roster untouched', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    mockCollectionGetList.mockResolvedValueOnce({
      totalItems: 2,
      items: [
        { id: 'ryan', displayName: 'Ryan Bell', active: false },
        { id: 'tristan', displayName: 'Tristan Stillwell', active: true },
      ],
    });

    await ensureCollections(mockPb);

    expect(mockCollectionCreate).not.toHaveBeenCalled();
  });

  it('leaves a custom operator roster untouched', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    mockCollectionGetList.mockResolvedValueOnce({
      totalItems: 1,
      items: [{ id: 'custom', displayName: 'Taylor Example', active: true }],
    });

    await ensureCollections(mockPb);

    expect(mockCollectionCreate).not.toHaveBeenCalled();
  });

  it('leaves an unexpectedly duplicated initial operator roster untouched', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    mockCollectionGetList.mockResolvedValueOnce({
      totalItems: 2,
      items: [
        { id: 'ryan-1', displayName: 'Ryan Bell', active: true },
        { id: 'ryan-2', displayName: ' Ryan   Bell ', active: true },
      ],
    });

    await ensureCollections(mockPb);

    expect(mockCollectionCreate).not.toHaveBeenCalled();
  });

  it('leaves the complete initial operator roster untouched', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
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

    expect(mockCollectionCreate).not.toHaveBeenCalled();
  });

  it('leaves an oversized operator roster untouched', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
    mockCollectionGetList.mockResolvedValueOnce({
      totalItems: 8,
      items: [
        { id: 'ryan', displayName: 'Ryan Bell', active: true },
        { id: 'tristan', displayName: 'Tristan Stillwell', active: true },
        { id: 'vlad', displayName: 'Vlad McCarty', active: true },
        { id: 'paris', displayName: 'Paris Carlson', active: true },
        { id: 'connor', displayName: 'Connor McElroy', active: true },
        { id: 'weston', displayName: 'Weston Yokley', active: true },
        { id: 'charles', displayName: 'Charles Gibbs', active: true },
        { id: 'custom', displayName: 'Taylor Example', active: true },
      ],
    });

    await ensureCollections(mockPb);

    expect(mockCollectionCreate).not.toHaveBeenCalled();
  });

  it('leaves an incomplete operator roster page untouched', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});
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
