/**
 * SavedLocationOperations - Saved weather locations CRUD operations
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { SavedLocation } from "@shared/ipc";
import { loggers } from "../logger";

const LOCATIONS_FILE = "savedLocations.json";

function generateId(): string {
  return `loc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function getSavedLocations(rootDir: string): Promise<SavedLocation[]> {
  const path = join(rootDir, LOCATIONS_FILE);
  try {
    if (!existsSync(path)) return [];
    const contents = await fs.readFile(path, "utf-8");
    const data = JSON.parse(contents);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    loggers.fileManager.error("[SavedLocationOperations] getSavedLocations error:", { error: e });
    return [];
  }
}

async function writeLocations(rootDir: string, locations: SavedLocation[]): Promise<void> {
  const path = join(rootDir, LOCATIONS_FILE);
  const content = JSON.stringify(locations, null, 2);
  await fs.writeFile(`${path}.tmp`, content, "utf-8");
  await fs.rename(`${path}.tmp`, path);
}

export async function saveLocation(
  rootDir: string,
  location: Omit<SavedLocation, "id">
): Promise<SavedLocation | null> {
  try {
    const locations = await getSavedLocations(rootDir);
    const newLocation: SavedLocation = {
      id: generateId(),
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
    await writeLocations(rootDir, locations);
    loggers.fileManager.info(`[SavedLocationOperations] Saved location: ${newLocation.name}`);
    return newLocation;
  } catch (e) {
    loggers.fileManager.error("[SavedLocationOperations] saveLocation error:", { error: e });
    return null;
  }
}

export async function deleteLocation(rootDir: string, id: string): Promise<boolean> {
  try {
    const locations = await getSavedLocations(rootDir);
    const filtered = locations.filter((l) => l.id !== id);
    if (filtered.length === locations.length) return false;
    await writeLocations(rootDir, filtered);
    loggers.fileManager.info(`[SavedLocationOperations] Deleted location: ${id}`);
    return true;
  } catch (e) {
    loggers.fileManager.error("[SavedLocationOperations] deleteLocation error:", { error: e });
    return false;
  }
}

export async function setDefaultLocation(rootDir: string, id: string): Promise<boolean> {
  try {
    const locations = await getSavedLocations(rootDir);
    const target = locations.find((l) => l.id === id);
    if (!target) return false;

    // Unset all defaults, then set the target
    locations.forEach((loc) => (loc.isDefault = loc.id === id));
    await writeLocations(rootDir, locations);
    loggers.fileManager.info(`[SavedLocationOperations] Set default location: ${target.name}`);
    return true;
  } catch (e) {
    loggers.fileManager.error("[SavedLocationOperations] setDefaultLocation error:", { error: e });
    return false;
  }
}

export async function clearDefaultLocation(rootDir: string, id: string): Promise<boolean> {
  try {
    const locations = await getSavedLocations(rootDir);
    const target = locations.find((l) => l.id === id);
    if (!target || !target.isDefault) return false;

    target.isDefault = false;
    await writeLocations(rootDir, locations);
    loggers.fileManager.info(`[SavedLocationOperations] Cleared default from location: ${target.name}`);
    return true;
  } catch (e) {
    loggers.fileManager.error("[SavedLocationOperations] clearDefaultLocation error:", { error: e });
    return false;
  }
}

export async function updateLocation(
  rootDir: string,
  id: string,
  updates: Partial<Omit<SavedLocation, "id">>
): Promise<boolean> {
  try {
    const locations = await getSavedLocations(rootDir);
    const target = locations.find((l) => l.id === id);
    if (!target) return false;

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

    await writeLocations(rootDir, locations);
    loggers.fileManager.info(`[SavedLocationOperations] Updated location: ${target.name}`);
    return true;
  } catch (e) {
    loggers.fileManager.error("[SavedLocationOperations] updateLocation error:", { error: e });
    return false;
  }
}
