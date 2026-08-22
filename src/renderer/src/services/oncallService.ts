import { getPb, handleApiError, escapeFilter, isOnline } from './pocketbase';
import { createCrudService } from './crudServiceFactory';
import { getRelayRuntime } from '../runtime/relayRuntime';

export interface OnCallRecord {
  id: string;
  team: string;
  teamId: string;
  role: string;
  name: string;
  contact: string;
  timeWindow: string;
  sortOrder: number;
  created: string;
  updated: string;
}

export type OnCallInput = Omit<OnCallRecord, 'id' | 'created' | 'updated'>;

const crud = createCrudService<OnCallRecord>('oncall');

export const addOnCall = (data: OnCallInput): Promise<OnCallRecord> => crud.create(data);

export const updateOnCall = (id: string, data: Partial<OnCallInput>): Promise<OnCallRecord> =>
  crud.update(id, data);

export const deleteOnCall = (id: string): Promise<void> => crud.remove(id);

async function getCachedOnCallRecords(): Promise<OnCallRecord[]> {
  if (getRelayRuntime().kind === 'web') return [];
  return ((await globalThis.api?.cacheRead?.('oncall')) ?? []) as unknown as OnCallRecord[];
}

async function getTeamRecords(team: string): Promise<OnCallRecord[]> {
  if (!isOnline()) {
    if (getRelayRuntime().kind === 'web') {
      throw new Error('Web access requires an online connection before saving changes.');
    }
    return (await getCachedOnCallRecords()).filter((record) => record.team === team);
  }
  return getPb()
    .collection('oncall')
    .getFullList<OnCallRecord>({ filter: `team="${escapeFilter(team)}"` });
}

export async function deleteOnCallByTeam(team: string): Promise<void> {
  try {
    const records = await getTeamRecords(team);
    for (const record of records) {
      await deleteOnCall(record.id);
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function replaceTeamRecords(
  team: string,
  rows: (Omit<OnCallInput, 'team'> & { id?: string })[],
): Promise<OnCallRecord[]> {
  try {
    const existingRecords = await getTeamRecords(team);
    const existingIds = new Set(existingRecords.map((record) => record.id));
    const keptIds = new Set<string>();
    const results: OnCallRecord[] = [];

    for (const row of rows) {
      const { id, ...rowData } = row;
      const input = { ...rowData, team };
      if (id && existingIds.has(id)) {
        const updated = await updateOnCall(id, input);
        keptIds.add(id);
        results.push(updated);
      } else {
        const created = await addOnCall(input);
        keptIds.add(created.id);
        results.push(created);
      }
    }

    for (const record of existingRecords) {
      if (!keptIds.has(record.id)) {
        await deleteOnCall(record.id);
      }
    }

    return results;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

/** Canonical card identity for a team display name (board order, grouping, dedup). */
export const normalizeTeamId = (name: string): string => name.trim().toLowerCase();

export async function renameTeam(oldName: string, newName: string): Promise<void> {
  try {
    const records = await getTeamRecords(oldName);
    // teamId has to move with the name. Left on the old value it strands the
    // card: the old name still matches these rows, so it can never be added
    // back, while the new name has no identity of its own.
    const teamId = normalizeTeamId(newName);
    for (const record of records) {
      await updateOnCall(record.id, { team: newName, teamId });
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function reorderTeams(teamOrder: string[]): Promise<void> {
  try {
    const cachedRecords = isOnline() ? null : await getCachedOnCallRecords();
    for (let i = 0; i < teamOrder.length; i++) {
      const team = teamOrder[i]!;
      const records = cachedRecords
        ? cachedRecords.filter((record) => record.team === team)
        : await getTeamRecords(team);
      for (const record of records) {
        await updateOnCall(record.id, { sortOrder: i });
      }
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
