import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetFullList = vi.fn();
const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockGetOne = vi.fn();
const mockUpdate = vi.fn();
const mockCollectionGetFullList = vi.fn();
const mockCollectionUpdate = vi.fn();
const mockCollectionDelete = vi.fn();

const mockPb = {
  collections: {
    getFullList: mockGetFullList,
    create: mockCreate,
    delete: mockDelete,
    getOne: mockGetOne,
    update: mockUpdate,
  },
  collection: () => ({
    getFullList: mockCollectionGetFullList,
    update: mockCollectionUpdate,
    delete: mockCollectionDelete,
  }),
} as never;

import { ensureCollections } from '../CollectionBootstrap';

beforeEach(() => {
  vi.clearAllMocks();
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

  it('creates missing collections including alert_reminders', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockCreate).toHaveBeenCalledTimes(12);
    expect(
      mockCreate.mock.calls.some(
        (call: unknown[]) => (call[0] as { name: string }).name === 'alert_reminders',
      ),
    ).toBe(true);
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
