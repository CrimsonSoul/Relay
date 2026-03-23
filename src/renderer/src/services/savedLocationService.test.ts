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
  addLocation,
  updateLocation,
  deleteLocation,
  setDefaultLocation,
  type SavedLocationRecord,
  type SavedLocationInput,
} from './savedLocationService';
import { handleApiError, requireOnline } from './pocketbase';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);

const sampleLocation: SavedLocationRecord = {
  id: 'loc1',
  name: 'Home',
  lat: 37.7749,
  lon: -122.4194,
  isDefault: false,
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
};

const sampleInput: SavedLocationInput = {
  name: 'Home',
  lat: 37.7749,
  lon: -122.4194,
  isDefault: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addLocation', () => {
  it('calls requireOnline and creates a location', async () => {
    mockCreate.mockResolvedValueOnce(sampleLocation);
    const result = await addLocation(sampleInput);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(sampleInput);
    expect(result).toEqual(sampleLocation);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('create failed');
    mockCreate.mockRejectedValueOnce(err);
    await expect(addLocation(sampleInput)).rejects.toThrow('create failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('updateLocation', () => {
  it('calls requireOnline and updates a location', async () => {
    mockUpdate.mockResolvedValueOnce(sampleLocation);
    const result = await updateLocation('loc1', { name: 'Work' });
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('loc1', { name: 'Work' });
    expect(result).toEqual(sampleLocation);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('update failed');
    mockUpdate.mockRejectedValueOnce(err);
    await expect(updateLocation('loc1', { name: 'Work' })).rejects.toThrow('update failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('deleteLocation', () => {
  it('calls requireOnline and deletes a location', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    await deleteLocation('loc1');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledWith('loc1');
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('delete failed');
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteLocation('loc1')).rejects.toThrow('delete failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('setDefaultLocation', () => {
  it('clears existing defaults and sets new default', async () => {
    const existingDefault: SavedLocationRecord = {
      ...sampleLocation,
      id: 'loc0',
      isDefault: true,
    };
    // getFullList for finding current defaults
    mockGetFullList.mockResolvedValueOnce([existingDefault]);
    // update to clear loc0, then update to set loc1 as default
    mockUpdate.mockResolvedValueOnce({ ...existingDefault, isDefault: false });
    mockUpdate.mockResolvedValueOnce({ ...sampleLocation, isDefault: true });

    const result = await setDefaultLocation('loc1');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockGetFullList).toHaveBeenCalledWith({ filter: 'isDefault=true' });
    expect(mockUpdate).toHaveBeenCalledWith('loc0', { isDefault: false });
    expect(mockUpdate).toHaveBeenCalledWith('loc1', { isDefault: true });
    expect(result).toEqual({ ...sampleLocation, isDefault: true });
  });

  it('does not clear the target location if it is already the default', async () => {
    // loc1 is already default — should not be in the "clear" list
    const alreadyDefault: SavedLocationRecord = { ...sampleLocation, id: 'loc1', isDefault: true };
    mockGetFullList.mockResolvedValueOnce([alreadyDefault]);
    mockUpdate.mockResolvedValueOnce({ ...alreadyDefault, isDefault: true });

    await setDefaultLocation('loc1');
    // Only one update: the final set-default call (the clear loop skips loc1)
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith('loc1', { isDefault: true });
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('fetch failed');
    mockGetFullList.mockRejectedValueOnce(err);
    await expect(setDefaultLocation('loc1')).rejects.toThrow('fetch failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});
