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
  escapeFilter: (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
  requireOnline: vi.fn(),
}));

import {
  addOnCall,
  updateOnCall,
  deleteOnCall,
  deleteOnCallByTeam,
  replaceTeamRecords,
  renameTeam,
  reorderTeams,
  type OnCallRecord,
  type OnCallInput,
} from './oncallService';
import { handleApiError, requireOnline } from './pocketbase';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);

const sampleRecord: OnCallRecord = {
  id: 'oc1',
  team: 'TeamA',
  teamId: 'team-a',
  role: 'Primary',
  name: 'Alice',
  contact: 'alice@example.com',
  timeWindow: '9-5',
  sortOrder: 0,
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
};

const sampleInput: OnCallInput = {
  team: 'TeamA',
  teamId: 'team-a',
  role: 'Primary',
  name: 'Alice',
  contact: 'alice@example.com',
  timeWindow: '9-5',
  sortOrder: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addOnCall', () => {
  it('calls requireOnline and creates an oncall record', async () => {
    mockCreate.mockResolvedValueOnce(sampleRecord);
    const result = await addOnCall(sampleInput);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(sampleInput);
    expect(result).toEqual(sampleRecord);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('create failed');
    mockCreate.mockRejectedValueOnce(err);
    await expect(addOnCall(sampleInput)).rejects.toThrow('create failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('updateOnCall', () => {
  it('calls requireOnline and updates an oncall record', async () => {
    mockUpdate.mockResolvedValueOnce(sampleRecord);
    const result = await updateOnCall('oc1', { name: 'Bob' });
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('oc1', { name: 'Bob' });
    expect(result).toEqual(sampleRecord);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('update failed');
    mockUpdate.mockRejectedValueOnce(err);
    await expect(updateOnCall('oc1', { name: 'Bob' })).rejects.toThrow('update failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('deleteOnCall', () => {
  it('calls requireOnline and deletes an oncall record', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    await deleteOnCall('oc1');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledWith('oc1');
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('delete failed');
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteOnCall('oc1')).rejects.toThrow('delete failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('deleteOnCallByTeam', () => {
  it('fetches team records and deletes each one', async () => {
    const record2: OnCallRecord = { ...sampleRecord, id: 'oc2' };
    mockGetFullList.mockResolvedValueOnce([sampleRecord, record2]);
    mockDelete.mockResolvedValue(undefined);
    await deleteOnCallByTeam('TeamA');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockGetFullList).toHaveBeenCalledWith({ filter: 'team="TeamA"' });
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenCalledWith('oc1');
    expect(mockDelete).toHaveBeenCalledWith('oc2');
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('fetch failed');
    mockGetFullList.mockRejectedValueOnce(err);
    await expect(deleteOnCallByTeam('TeamA')).rejects.toThrow('fetch failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('replaceTeamRecords', () => {
  it('deletes existing team records then creates new ones', async () => {
    // deleteOnCallByTeam path
    mockGetFullList.mockResolvedValueOnce([sampleRecord]);
    mockDelete.mockResolvedValueOnce(undefined);
    // addOnCall path
    const newRecord: OnCallRecord = { ...sampleRecord, id: 'oc3', role: 'Secondary' };
    mockCreate.mockResolvedValueOnce(newRecord);

    const rows: Omit<OnCallInput, 'team'>[] = [
      {
        role: 'Secondary',
        name: 'Bob',
        contact: 'bob@example.com',
        timeWindow: '9-5',
        sortOrder: 0,
        teamId: 'team-a',
      },
    ];
    const results = await replaceTeamRecords('TeamA', rows);
    expect(results).toEqual([newRecord]);
    expect(mockCreate).toHaveBeenCalledWith({
      team: 'TeamA',
      role: 'Secondary',
      name: 'Bob',
      contact: 'bob@example.com',
      timeWindow: '9-5',
      sortOrder: 0,
      teamId: 'team-a',
    });
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('replace failed');
    mockGetFullList.mockRejectedValueOnce(err);
    await expect(replaceTeamRecords('TeamA', [])).rejects.toThrow('replace failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('renameTeam', () => {
  it('updates the team name on all matching records', async () => {
    const record2: OnCallRecord = { ...sampleRecord, id: 'oc2' };
    mockGetFullList.mockResolvedValueOnce([sampleRecord, record2]);
    mockUpdate.mockResolvedValue(undefined);
    await renameTeam('TeamA', 'TeamB');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith('oc1', { team: 'TeamB' });
    expect(mockUpdate).toHaveBeenCalledWith('oc2', { team: 'TeamB' });
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('rename failed');
    mockGetFullList.mockRejectedValueOnce(err);
    await expect(renameTeam('TeamA', 'TeamB')).rejects.toThrow('rename failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('reorderTeams', () => {
  it('updates sortOrder for each team', async () => {
    const teamARecord: OnCallRecord = { ...sampleRecord, id: 'oc1', team: 'TeamA' };
    const teamBRecord: OnCallRecord = { ...sampleRecord, id: 'oc2', team: 'TeamB' };
    mockGetFullList
      .mockResolvedValueOnce([teamARecord]) // TeamA at index 0
      .mockResolvedValueOnce([teamBRecord]); // TeamB at index 1
    mockUpdate.mockResolvedValue(undefined);
    await reorderTeams(['TeamA', 'TeamB']);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('oc1', { sortOrder: 0 });
    expect(mockUpdate).toHaveBeenCalledWith('oc2', { sortOrder: 1 });
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('reorder failed');
    mockGetFullList.mockRejectedValueOnce(err);
    await expect(reorderTeams(['TeamA'])).rejects.toThrow('reorder failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});
