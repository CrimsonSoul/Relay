import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    }),
  }),
  handleApiError: vi.fn(),
  requireOnline: vi.fn(),
}));

import {
  addGroup,
  updateGroup,
  deleteGroup,
  type BridgeGroupRecord,
  type BridgeGroupInput,
} from './bridgeGroupService';
import { handleApiError, requireOnline } from './pocketbase';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);

const sampleGroup: BridgeGroupRecord = {
  id: 'bg1',
  name: 'NOC',
  contacts: ['c1', 'c2'],
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
};

const sampleInput: BridgeGroupInput = {
  name: 'NOC',
  contacts: ['c1', 'c2'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addGroup', () => {
  it('calls requireOnline and creates a bridge group', async () => {
    mockCreate.mockResolvedValueOnce(sampleGroup);
    const result = await addGroup(sampleInput);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(sampleInput);
    expect(result).toEqual(sampleGroup);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('create failed');
    mockCreate.mockRejectedValueOnce(err);
    await expect(addGroup(sampleInput)).rejects.toThrow('create failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('updateGroup', () => {
  it('calls requireOnline and updates a bridge group', async () => {
    mockUpdate.mockResolvedValueOnce(sampleGroup);
    const result = await updateGroup('bg1', { name: 'NOC-2' });
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('bg1', { name: 'NOC-2' });
    expect(result).toEqual(sampleGroup);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('update failed');
    mockUpdate.mockRejectedValueOnce(err);
    await expect(updateGroup('bg1', { name: 'NOC-2' })).rejects.toThrow('update failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('deleteGroup', () => {
  it('calls requireOnline and deletes a bridge group', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    await deleteGroup('bg1');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledWith('bg1');
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('delete failed');
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteGroup('bg1')).rejects.toThrow('delete failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});
