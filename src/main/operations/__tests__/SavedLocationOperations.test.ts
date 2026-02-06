import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SavedLocation } from '@shared/ipc';

vi.mock('../../fileLock', () => ({
  readWithLock: vi.fn(),
  modifyJsonWithLock: vi.fn(),
}));

vi.mock('../../logger', () => ({
  loggers: {
    fileManager: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

vi.mock('../idUtils', () => ({
  generateId: vi.fn(() => 'test-loc-123'),
}));

import { readWithLock, modifyJsonWithLock } from '../../fileLock';
import {
  getSavedLocations,
  saveLocation,
  deleteLocation,
  setDefaultLocation,
  clearDefaultLocation,
  updateLocation,
} from '../SavedLocationOperations';

const mockRead = vi.mocked(readWithLock);
const mockModify = vi.mocked(modifyJsonWithLock);

const rootDir = '/tmp/relay-test';

const sampleLocations: SavedLocation[] = [
  { id: 'loc1', name: 'New York', lat: 40.7128, lon: -74.006, isDefault: true },
  { id: 'loc2', name: 'London', lat: 51.5074, lon: -0.1278, isDefault: false },
  { id: 'loc3', name: 'Tokyo', lat: 35.6762, lon: 139.6503, isDefault: false },
];

describe('SavedLocationOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSavedLocations', () => {
    it('reads and returns locations', async () => {
      mockRead.mockResolvedValue(JSON.stringify(sampleLocations));

      const result = await getSavedLocations(rootDir);
      expect(result).toEqual(sampleLocations);
      expect(mockRead).toHaveBeenCalledWith(expect.stringContaining('savedLocations.json'));
    });

    it('returns empty array for ENOENT', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockRead.mockRejectedValue(error);

      const result = await getSavedLocations(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array for null content', async () => {
      mockRead.mockResolvedValue(null as unknown as string);

      const result = await getSavedLocations(rootDir);
      expect(result).toEqual([]);
    });
  });

  describe('saveLocation', () => {
    it('adds new location with generated id', async () => {
      let capturedLocations: SavedLocation[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const existing: SavedLocation[] = [];
        const result = await callback(existing);
        capturedLocations = result as SavedLocation[];
      });

      const result = await saveLocation(rootDir, {
        name: 'Paris',
        lat: 48.8566,
        lon: 2.3522,
        isDefault: false,
      });

      expect(mockModify).toHaveBeenCalledOnce();
      expect(capturedLocations).toHaveLength(1);
      expect(capturedLocations[0]).toMatchObject({
        id: 'test-loc-123',
        name: 'Paris',
        lat: 48.8566,
        lon: 2.3522,
        isDefault: false,
      });
      expect(result).toMatchObject({ id: 'test-loc-123', name: 'Paris' });
    });

    it('unsets other defaults when saving a default location', async () => {
      let capturedLocations: SavedLocation[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const existing = structuredClone(sampleLocations);
        const result = await callback(existing);
        capturedLocations = result as SavedLocation[];
      });

      await saveLocation(rootDir, {
        name: 'Paris',
        lat: 48.8566,
        lon: 2.3522,
        isDefault: true,
      });

      // The previously-default New York should now be false
      const ny = capturedLocations.find((l) => l.id === 'loc1');
      expect(ny?.isDefault).toBe(false);
      // The new location should be default
      const paris = capturedLocations.find((l) => l.id === 'test-loc-123');
      expect(paris?.isDefault).toBe(true);
    });
  });

  describe('deleteLocation', () => {
    it('removes location by id', async () => {
      let capturedLocations: SavedLocation[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const existing = structuredClone(sampleLocations);
        const result = await callback(existing);
        capturedLocations = result as SavedLocation[];
      });

      const result = await deleteLocation(rootDir, 'loc2');

      expect(result).toBe(true);
      expect(capturedLocations).toHaveLength(2);
      expect(capturedLocations.find((l) => l.id === 'loc2')).toBeUndefined();
    });

    it('returns false if id not found', async () => {
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        await callback(structuredClone(sampleLocations));
      });

      const result = await deleteLocation(rootDir, 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('setDefaultLocation', () => {
    it('sets isDefault on target and clears others', async () => {
      let capturedLocations: SavedLocation[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const existing = structuredClone(sampleLocations);
        const result = await callback(existing);
        capturedLocations = result as SavedLocation[];
      });

      const result = await setDefaultLocation(rootDir, 'loc2');

      expect(result).toBe(true);
      // loc1 was previously default, should now be false
      expect(capturedLocations.find((l) => l.id === 'loc1')?.isDefault).toBe(false);
      // loc2 should now be default
      expect(capturedLocations.find((l) => l.id === 'loc2')?.isDefault).toBe(true);
      // loc3 should remain false
      expect(capturedLocations.find((l) => l.id === 'loc3')?.isDefault).toBe(false);
    });

    it('returns false if target not found', async () => {
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        await callback(structuredClone(sampleLocations));
      });

      const result = await setDefaultLocation(rootDir, 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('clearDefaultLocation', () => {
    it('unsets default on target location', async () => {
      let capturedLocations: SavedLocation[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const existing = structuredClone(sampleLocations);
        const result = await callback(existing);
        capturedLocations = result as SavedLocation[];
      });

      const result = await clearDefaultLocation(rootDir, 'loc1');

      expect(result).toBe(true);
      expect(capturedLocations.find((l) => l.id === 'loc1')?.isDefault).toBe(false);
    });

    it('returns false if target is not default', async () => {
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        await callback(structuredClone(sampleLocations));
      });

      // loc2 is not default
      const result = await clearDefaultLocation(rootDir, 'loc2');
      expect(result).toBe(false);
    });
  });

  describe('updateLocation', () => {
    it('updates fields by id', async () => {
      let capturedLocations: SavedLocation[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const existing = structuredClone(sampleLocations);
        const result = await callback(existing);
        capturedLocations = result as SavedLocation[];
      });

      const result = await updateLocation(rootDir, 'loc2', { name: 'London Updated', lat: 51.51 });

      expect(result).toBe(true);
      const updated = capturedLocations.find((l) => l.id === 'loc2');
      expect(updated?.name).toBe('London Updated');
      expect(updated?.lat).toBe(51.51);
      // lon should remain unchanged
      expect(updated?.lon).toBe(-0.1278);
    });

    it('returns false if id not found', async () => {
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        await callback(structuredClone(sampleLocations));
      });

      const result = await updateLocation(rootDir, 'nonexistent', { name: 'Nope' });
      expect(result).toBe(false);
    });

    it('setting isDefault=true on one clears others', async () => {
      let capturedLocations: SavedLocation[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const existing = structuredClone(sampleLocations);
        const result = await callback(existing);
        capturedLocations = result as SavedLocation[];
      });

      const result = await updateLocation(rootDir, 'loc3', { isDefault: true });

      expect(result).toBe(true);
      expect(capturedLocations.find((l) => l.id === 'loc1')?.isDefault).toBe(false);
      expect(capturedLocations.find((l) => l.id === 'loc3')?.isDefault).toBe(true);
    });
  });
});
