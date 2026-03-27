import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetFullList = vi.fn();
const mockGetOne = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDeleteFn = vi.fn();

vi.mock('../pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      getFullList: mockGetFullList,
      getOne: mockGetOne,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDeleteFn,
    }),
  }),
  handleApiError: vi.fn(),
  requireOnline: vi.fn(),
}));

vi.mock('../pbErrors', () => ({
  isPbNotFoundError: vi.fn(
    (err: unknown) =>
      err instanceof Error && 'status' in err && (err as { status: number }).status === 404,
  ),
}));

import { createCrudService } from '../crudServiceFactory';
import { handleApiError, requireOnline } from '../pocketbase';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);

interface TestRecord {
  id: string;
  name: string;
}

describe('crudServiceFactory', () => {
  const service = createCrudService<TestRecord>('test_collection');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getAll
  // -------------------------------------------------------------------------
  describe('getAll', () => {
    it('returns all records from the collection', async () => {
      const records = [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
      ];
      mockGetFullList.mockResolvedValue(records);

      const result = await service.getAll();

      expect(result).toEqual(records);
      expect(mockGetFullList).toHaveBeenCalled();
    });

    it('passes options through to getFullList', async () => {
      mockGetFullList.mockResolvedValue([]);

      await service.getAll({ sort: '-created' });

      expect(mockGetFullList).toHaveBeenCalledWith({ sort: '-created' });
    });

    it('calls handleApiError and re-throws on failure', async () => {
      const error = new Error('network fail');
      mockGetFullList.mockRejectedValue(error);

      await expect(service.getAll()).rejects.toThrow('network fail');
      expect(mockHandleApiError).toHaveBeenCalledWith(error);
    });
  });

  // -------------------------------------------------------------------------
  // getOne
  // -------------------------------------------------------------------------
  describe('getOne', () => {
    it('returns a record by ID', async () => {
      const record = { id: '1', name: 'A' };
      mockGetOne.mockResolvedValue(record);

      const result = await service.getOne('1');

      expect(result).toEqual(record);
    });

    it('returns null for 404 (not found) errors', async () => {
      const err = Object.assign(new Error('Not found'), { status: 404 });
      mockGetOne.mockRejectedValue(err);

      const result = await service.getOne('missing');

      expect(result).toBeNull();
    });

    it('calls handleApiError and re-throws for non-404 errors', async () => {
      const err = new Error('server error');
      mockGetOne.mockRejectedValue(err);

      await expect(service.getOne('1')).rejects.toThrow('server error');
      expect(mockHandleApiError).toHaveBeenCalledWith(err);
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    it('calls requireOnline before creating', async () => {
      mockCreate.mockResolvedValue({ id: 'new', name: 'C' });

      await service.create({ name: 'C' });

      expect(mockRequireOnline).toHaveBeenCalled();
    });

    it('creates and returns the new record', async () => {
      const newRecord = { id: 'new', name: 'C' };
      mockCreate.mockResolvedValue(newRecord);

      const result = await service.create({ name: 'C' });

      expect(result).toEqual(newRecord);
      expect(mockCreate).toHaveBeenCalledWith({ name: 'C' });
    });

    it('throws when offline (requireOnline throws)', async () => {
      mockRequireOnline.mockImplementation(() => {
        throw new Error('You are offline');
      });

      await expect(service.create({ name: 'C' })).rejects.toThrow('You are offline');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('calls handleApiError and re-throws on create failure', async () => {
      mockRequireOnline.mockImplementation(() => {});
      const error = new Error('create failed');
      mockCreate.mockRejectedValue(error);

      await expect(service.create({ name: 'C' })).rejects.toThrow('create failed');
      expect(mockHandleApiError).toHaveBeenCalledWith(error);
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  describe('update', () => {
    it('calls requireOnline before updating', async () => {
      mockUpdate.mockResolvedValue({ id: '1', name: 'Updated' });

      await service.update('1', { name: 'Updated' });

      expect(mockRequireOnline).toHaveBeenCalled();
    });

    it('updates and returns the record', async () => {
      const updated = { id: '1', name: 'Updated' };
      mockUpdate.mockResolvedValue(updated);

      const result = await service.update('1', { name: 'Updated' });

      expect(result).toEqual(updated);
      expect(mockUpdate).toHaveBeenCalledWith('1', { name: 'Updated' });
    });

    it('throws when offline', async () => {
      mockRequireOnline.mockImplementation(() => {
        throw new Error('You are offline');
      });

      await expect(service.update('1', { name: 'X' })).rejects.toThrow('You are offline');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('calls handleApiError and re-throws on update failure', async () => {
      mockRequireOnline.mockImplementation(() => {});
      const error = new Error('update failed');
      mockUpdate.mockRejectedValue(error);

      await expect(service.update('1', { name: 'X' })).rejects.toThrow('update failed');
      expect(mockHandleApiError).toHaveBeenCalledWith(error);
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------
  describe('remove', () => {
    it('calls requireOnline before deleting', async () => {
      mockDeleteFn.mockResolvedValue(undefined);

      await service.remove('1');

      expect(mockRequireOnline).toHaveBeenCalled();
    });

    it('deletes the record', async () => {
      mockDeleteFn.mockResolvedValue(undefined);

      await service.remove('1');

      expect(mockDeleteFn).toHaveBeenCalledWith('1');
    });

    it('throws when offline', async () => {
      mockRequireOnline.mockImplementation(() => {
        throw new Error('You are offline');
      });

      await expect(service.remove('1')).rejects.toThrow('You are offline');
      expect(mockDeleteFn).not.toHaveBeenCalled();
    });

    it('calls handleApiError and re-throws on delete failure', async () => {
      mockRequireOnline.mockImplementation(() => {});
      const error = new Error('delete failed');
      mockDeleteFn.mockRejectedValue(error);

      await expect(service.remove('1')).rejects.toThrow('delete failed');
      expect(mockHandleApiError).toHaveBeenCalledWith(error);
    });
  });
});
