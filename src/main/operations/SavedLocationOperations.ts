/**
 * SavedLocationOperations - Saved weather locations CRUD operations
 * Uses cross-process file locking for multi-instance synchronization.
 */

import { join } from 'path';
import type { SavedLocation } from '@shared/ipc';
import { isNodeError } from '@shared/types';
import { loggers } from '../logger';
import { modifyJsonWithLock, readWithLock } from '../fileLock';
import { generateId } from './idUtils';

const LOCATIONS_FILE = 'savedLocations.json';
const LOCATIONS_FILE_PATH = (rootDir: string) => join(rootDir, LOCATIONS_FILE);

export async function getSavedLocations(rootDir: string): Promise<SavedLocation[]> {
  const path = LOCATIONS_FILE_PATH(rootDir);
  try {
    const contents = await readWithLock(path);
    if (!contents) return [];

    try {
      const data = JSON.parse(contents);
      return Array.isArray(data) ? data : [];
    } catch (parseError) {
      loggers.fileManager.error('[SavedLocationOperations] JSON parse error:', {
        error: parseError,
        path,
      });
      return [];
    }
  } catch (e) {
    if (isNodeError(e) && e.code === 'ENOENT') return [];
    loggers.fileManager.error('[SavedLocationOperations] getSavedLocations error:', { error: e });
    throw e;
  }
}

export async function saveLocation(
  rootDir: string,
  location: Omit<SavedLocation, 'id'>,
): Promise<SavedLocation | null> {
  try {
    let result: SavedLocation | null = null;
    const path = LOCATIONS_FILE_PATH(rootDir);

    await modifyJsonWithLock<SavedLocation[]>(
      path,
      (locations) => {
        const newLocation: SavedLocation = {
          id: generateId('loc'),
          name: location.name,
          lat: location.lat,
          lon: location.lon,
          isDefault: location.isDefault,
        };

        // If this is set as default, unset others
        if (newLocation.isDefault) {
          locations.forEach((loc) => (loc.isDefault = false));
        }

        locations.push(newLocation);
        result = newLocation;
        loggers.fileManager.info(`[SavedLocationOperations] Saved location: ${newLocation.name}`);
        return locations;
      },
      [],
    );

    return result;
  } catch (e) {
    loggers.fileManager.error('[SavedLocationOperations] saveLocation error:', { error: e });
    return null;
  }
}

export async function deleteLocation(rootDir: string, id: string): Promise<boolean> {
  try {
    let deleted = false;
    const path = LOCATIONS_FILE_PATH(rootDir);

    await modifyJsonWithLock<SavedLocation[]>(
      path,
      (locations) => {
        const initialLength = locations.length;
        const filtered = locations.filter((l) => l.id !== id);
        if (filtered.length === initialLength) return locations;

        deleted = true;
        loggers.fileManager.info(`[SavedLocationOperations] Deleted location: ${id}`);
        return filtered;
      },
      [],
    );

    return deleted;
  } catch (e) {
    loggers.fileManager.error('[SavedLocationOperations] deleteLocation error:', { error: e });
    return false;
  }
}

export async function setDefaultLocation(rootDir: string, id: string): Promise<boolean> {
  try {
    let success = false;
    const path = LOCATIONS_FILE_PATH(rootDir);

    await modifyJsonWithLock<SavedLocation[]>(
      path,
      (locations) => {
        const target = locations.find((l) => l.id === id);
        if (!target) return locations;

        // Unset all defaults, then set the target
        locations.forEach((loc) => (loc.isDefault = loc.id === id));
        success = true;
        loggers.fileManager.info(`[SavedLocationOperations] Set default location: ${target.name}`);
        return locations;
      },
      [],
    );

    return success;
  } catch (e) {
    loggers.fileManager.error('[SavedLocationOperations] setDefaultLocation error:', { error: e });
    return false;
  }
}

export async function clearDefaultLocation(rootDir: string, id: string): Promise<boolean> {
  try {
    let success = false;
    const path = LOCATIONS_FILE_PATH(rootDir);

    await modifyJsonWithLock<SavedLocation[]>(
      path,
      (locations) => {
        const target = locations.find((l) => l.id === id);
        if (!target || !target.isDefault) return locations;

        target.isDefault = false;
        success = true;
        loggers.fileManager.info(
          `[SavedLocationOperations] Cleared default from location: ${target.name}`,
        );
        return locations;
      },
      [],
    );

    return success;
  } catch (e) {
    loggers.fileManager.error('[SavedLocationOperations] clearDefaultLocation error:', {
      error: e,
    });
    return false;
  }
}

export async function updateLocation(
  rootDir: string,
  id: string,
  updates: Partial<Omit<SavedLocation, 'id'>>,
): Promise<boolean> {
  try {
    let success = false;
    const path = LOCATIONS_FILE_PATH(rootDir);

    await modifyJsonWithLock<SavedLocation[]>(
      path,
      (locations) => {
        const target = locations.find((l) => l.id === id);
        if (!target) return locations;

        // Apply updates
        if (updates.name !== undefined) target.name = updates.name;
        if (updates.lat !== undefined) target.lat = updates.lat;
        if (updates.lon !== undefined) target.lon = updates.lon;
        if (updates.isDefault !== undefined) {
          if (updates.isDefault) {
            // If setting as default, unset others
            locations.forEach((loc) => (loc.isDefault = loc.id === id));
          } else {
            target.isDefault = false;
          }
        }

        success = true;
        loggers.fileManager.info(`[SavedLocationOperations] Updated location: ${target.name}`);
        return locations;
      },
      [],
    );

    return success;
  } catch (e) {
    loggers.fileManager.error('[SavedLocationOperations] updateLocation error:', { error: e });
    return false;
  }
}
