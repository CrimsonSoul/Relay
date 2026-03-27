import { getPb, handleApiError, requireOnline } from './pocketbase';

export interface SavedLocationRecord {
  id: string;
  name: string;
  lat: number;
  lon: number;
  isDefault: boolean;
  created: string;
  updated: string;
}

export type SavedLocationInput = Omit<SavedLocationRecord, 'id' | 'created' | 'updated'>;

export async function addLocation(data: SavedLocationInput): Promise<SavedLocationRecord> {
  requireOnline();
  try {
    return await getPb().collection('saved_locations').create<SavedLocationRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateLocation(
  id: string,
  data: Partial<SavedLocationInput>,
): Promise<SavedLocationRecord> {
  requireOnline();
  try {
    return await getPb().collection('saved_locations').update<SavedLocationRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteLocation(id: string): Promise<void> {
  requireOnline();
  try {
    await getPb().collection('saved_locations').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function setDefaultLocation(id: string): Promise<SavedLocationRecord> {
  requireOnline();
  try {
    // Clear all existing defaults first
    const allLocations = await getPb()
      .collection('saved_locations')
      .getFullList<SavedLocationRecord>({ filter: 'isDefault=true' });
    for (const loc of allLocations) {
      if (loc.id !== id) {
        await getPb().collection('saved_locations').update(loc.id, { isDefault: false });
      }
    }
    // Set the new default
    return await getPb()
      .collection('saved_locations')
      .update<SavedLocationRecord>(id, { isDefault: true });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
