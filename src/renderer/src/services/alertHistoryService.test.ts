import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockGetFullList = vi.fn();

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
      getFullList: mockGetFullList,
    }),
  }),
  handleApiError: vi.fn(),
  requireOnline: vi.fn(),
}));

import {
  addAlertHistory,
  deleteAlertHistory,
  clearAlertHistory,
  pinAlertHistory,
  updateAlertLabel,
  type AlertHistoryRecord,
  type AlertHistoryInput,
} from './alertHistoryService';
import { handleApiError, requireOnline } from './pocketbase';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);

const sampleRecord: AlertHistoryRecord = {
  id: 'ah1',
  severity: 'ISSUE',
  subject: 'Outage',
  bodyHtml: '<p>Outage details</p>',
  sender: 'monitor@example.com',
  recipient: 'ops@example.com',
  pinned: false,
  label: '',
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
};

const sampleInput: AlertHistoryInput = {
  severity: 'ISSUE',
  subject: 'Outage',
  bodyHtml: '<p>Outage details</p>',
  sender: 'monitor@example.com',
  recipient: 'ops@example.com',
  pinned: false,
  label: '',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addAlertHistory', () => {
  it('calls requireOnline and creates an alert history record', async () => {
    mockCreate.mockResolvedValueOnce(sampleRecord);
    const result = await addAlertHistory(sampleInput);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(sampleInput);
    expect(result).toEqual(sampleRecord);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('create failed');
    mockCreate.mockRejectedValueOnce(err);
    await expect(addAlertHistory(sampleInput)).rejects.toThrow('create failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('deleteAlertHistory', () => {
  it('calls requireOnline and deletes an alert history record', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    await deleteAlertHistory('ah1');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledWith('ah1');
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('delete failed');
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteAlertHistory('ah1')).rejects.toThrow('delete failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('clearAlertHistory', () => {
  it('fetches all records and deletes each one', async () => {
    const record2: AlertHistoryRecord = { ...sampleRecord, id: 'ah2' };
    mockGetFullList.mockResolvedValueOnce([sampleRecord, record2]);
    mockDelete.mockResolvedValue(undefined);
    await clearAlertHistory();
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenCalledWith('ah1');
    expect(mockDelete).toHaveBeenCalledWith('ah2');
  });

  it('does nothing when there are no records', async () => {
    mockGetFullList.mockResolvedValueOnce([]);
    await clearAlertHistory();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('fetch failed');
    mockGetFullList.mockRejectedValueOnce(err);
    await expect(clearAlertHistory()).rejects.toThrow('fetch failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('pinAlertHistory', () => {
  it('calls requireOnline and updates the pinned field', async () => {
    const pinned = { ...sampleRecord, pinned: true };
    mockUpdate.mockResolvedValueOnce(pinned);
    const result = await pinAlertHistory('ah1', true);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('ah1', { pinned: true });
    expect(result).toEqual(pinned);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('pin failed');
    mockUpdate.mockRejectedValueOnce(err);
    await expect(pinAlertHistory('ah1', true)).rejects.toThrow('pin failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('updateAlertLabel', () => {
  it('calls requireOnline and updates the label field', async () => {
    const labeled = { ...sampleRecord, label: 'P1' };
    mockUpdate.mockResolvedValueOnce(labeled);
    const result = await updateAlertLabel('ah1', 'P1');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('ah1', { label: 'P1' });
    expect(result).toEqual(labeled);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('label failed');
    mockUpdate.mockRejectedValueOnce(err);
    await expect(updateAlertLabel('ah1', 'P1')).rejects.toThrow('label failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});
