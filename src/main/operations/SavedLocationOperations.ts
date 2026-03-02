/**
 * SavedLocationOperations - Saved weather locations CRUD operations
 * Uses cross-process file locking for multi-instance synchronization.
 */

import type { SavedLocation } from '@shared/ipc';
import { loggers } from '../logger';
import { generateId } from './idUtils';
import { readAll, modifyItems, deleteById, type JsonCrudConfig } from './jsonCrudHelper';

const config: JsonCrudConfig = {
  fileName: 'savedLocations.json',
  logPrefix: '[SavedLocationOperations]',
};

export async function getSavedLocations(rootDir: string): Promise<SavedLocation[]> {
  return readAll<SavedLocation>(rootDir, config);
}

export async function saveLocation(
  rootDir: string,
  location: Omit<SavedLocation, 'id'>,
): Promise<SavedLocation | null> {
  let result: SavedLocation | null = null;

  return modifyItems<SavedLocation, SavedLocation | null>(
    rootDir,
    config,
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
      return [...locations];
    },
    () => result,
    null,
    'saveLocation',
  );
}

export async function deleteLocation(rootDir: string, id: string): Promise<boolean> {
  return deleteById<SavedLocation>(rootDir, config, id, 'location');
}

export async function setDefaultLocation(rootDir: string, id: string): Promise<boolean> {
  let success = false;

  return modifyItems<SavedLocation, boolean>(
    rootDir,
    config,
    (locations) => {
      const target = locations.find((l) => l.id === id);
      if (!target) return locations;

      // Unset all defaults, then set the target
      locations.forEach((loc) => (loc.isDefault = loc.id === id));
      success = true;
      loggers.fileManager.info(`[SavedLocationOperations] Set default location: ${target.name}`);
      return [...locations];
    },
    () => success,
    false,
    'setDefaultLocation',
  );
}

export async function clearDefaultLocation(rootDir: string, id: string): Promise<boolean> {
  let success = false;
  let locationName = id;

  return modifyItems<SavedLocation, boolean>(
    rootDir,
    config,
    (locations) => {
      const target = locations.find((location) => location.id === id);
      if (!target?.isDefault) {
        return locations;
      }

      target.isDefault = false;
      locationName = target.name;
      success = true;
      loggers.fileManager.info(
        `[SavedLocationOperations] Cleared default from location: ${target.name}`,
      );
      return [...locations];
    },
    () => {
      if (!success) {
        loggers.fileManager.debug(
          `[SavedLocationOperations] No default location cleared for id: ${locationName}`,
        );
      }
      return success;
    },
    false,
    'clearDefaultLocation',
  );
}

export async function updateLocation(
  rootDir: string,
  id: string,
  updates: Partial<Omit<SavedLocation, 'id'>>,
): Promise<boolean> {
  let success = false;

  return modifyItems<SavedLocation, boolean>(
    rootDir,
    config,
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
      return [...locations];
    },
    () => success,
    false,
    'updateLocation',
  );
}
