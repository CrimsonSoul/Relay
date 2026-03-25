import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetFullList = vi.fn();
const mockCreate = vi.fn();
const mockDelete = vi.fn();

const mockPb = {
  collections: {
    getFullList: mockGetFullList,
    create: mockCreate,
    delete: mockDelete,
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

    await ensureCollections(mockPb);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('skips the users collection', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'u1', name: 'users' },
      { id: 'col1', name: 'contacts' },
    ]);
    mockCreate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('creates missing collections', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({});

    await ensureCollections(mockPb);

    expect(mockCreate).toHaveBeenCalledTimes(11);
  });
});
