import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockGetFullList = vi.fn();

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
      delete: mockDelete,
      getFullList: mockGetFullList,
    }),
  }),
  handleApiError: vi.fn(),
  requireOnline: vi.fn(),
}));

import {
  addBridgeHistory,
  deleteBridgeHistory,
  clearBridgeHistory,
  type BridgeHistoryRecord,
  type BridgeHistoryInput,
} from './bridgeHistoryService';
import { handleApiError, requireOnline } from './pocketbase';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);

const sampleRecord: BridgeHistoryRecord = {
  id: 'bh1',
  note: 'Bridge note',
  groups: ['g1'],
  contacts: ['c1'],
  recipientCount: 5,
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
};

const sampleInput: BridgeHistoryInput = {
  note: 'Bridge note',
  groups: ['g1'],
  contacts: ['c1'],
  recipientCount: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addBridgeHistory', () => {
  it('calls requireOnline and creates a bridge history record', async () => {
    mockCreate.mockResolvedValueOnce(sampleRecord);
    const result = await addBridgeHistory(sampleInput);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(sampleInput);
    expect(result).toEqual(sampleRecord);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('create failed');
    mockCreate.mockRejectedValueOnce(err);
    await expect(addBridgeHistory(sampleInput)).rejects.toThrow('create failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('deleteBridgeHistory', () => {
  it('calls requireOnline and deletes a bridge history record', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    await deleteBridgeHistory('bh1');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledWith('bh1');
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('delete failed');
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteBridgeHistory('bh1')).rejects.toThrow('delete failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('clearBridgeHistory', () => {
  it('fetches all records and deletes each one', async () => {
    const record2: BridgeHistoryRecord = { ...sampleRecord, id: 'bh2' };
    mockGetFullList.mockResolvedValueOnce([sampleRecord, record2]);
    mockDelete.mockResolvedValue(undefined);
    await clearBridgeHistory();
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenCalledWith('bh1');
    expect(mockDelete).toHaveBeenCalledWith('bh2');
  });

  it('does nothing when there are no records', async () => {
    mockGetFullList.mockResolvedValueOnce([]);
    await clearBridgeHistory();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('fetch failed');
    mockGetFullList.mockRejectedValueOnce(err);
    await expect(clearBridgeHistory()).rejects.toThrow('fetch failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});
