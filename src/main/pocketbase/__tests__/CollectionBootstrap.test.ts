import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetFullList = vi.fn();
const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockGetOne = vi.fn();
const mockUpdate = vi.fn();

const mockPb = {
  collections: {
    getFullList: mockGetFullList,
    create: mockCreate,
    delete: mockDelete,
    getOne: mockGetOne,
    update: mockUpdate,
  },
} as never;

import { ensureCollections } from '../CollectionBootstrap';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureCollections', () => {
  it('deletes collections not in the schema', async () => {
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

    expect(mockDelete).toHaveBeenCalledWith('col2');
    expect(mockDelete).toHaveBeenCalledTimes(1);
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

  it('creates missing collections including oncall_board_settings', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockCreate).toHaveBeenCalledTimes(11);
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
});
