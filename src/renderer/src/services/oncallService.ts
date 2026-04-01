import { getPb, handleApiError, escapeFilter, requireOnline } from './pocketbase';
import { createCrudService } from './crudServiceFactory';

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

export async function deleteOnCallByTeam(team: string): Promise<void> {
  requireOnline();
  try {
    const records = await getPb()
      .collection('oncall')
      .getFullList<OnCallRecord>({ filter: `team="${escapeFilter(team)}"` });
    for (const record of records) {
      await getPb().collection('oncall').delete(record.id);
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function replaceTeamRecords(
  team: string,
  rows: Omit<OnCallInput, 'team'>[],
): Promise<OnCallRecord[]> {
  try {
    await deleteOnCallByTeam(team);
    const results: OnCallRecord[] = [];
    for (const row of rows) {
      const created = await addOnCall({ ...row, team });
      results.push(created);
    }
    return results;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function renameTeam(oldName: string, newName: string): Promise<void> {
  requireOnline();
  try {
    const records = await getPb()
      .collection('oncall')
      .getFullList<OnCallRecord>({ filter: `team="${escapeFilter(oldName)}"` });
    for (const record of records) {
      await getPb().collection('oncall').update(record.id, { team: newName });
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function reorderTeams(teamOrder: string[]): Promise<void> {
  requireOnline();
  try {
    for (let i = 0; i < teamOrder.length; i++) {
      const team = teamOrder[i]!;
      const records = await getPb()
        .collection('oncall')
        .getFullList<OnCallRecord>({ filter: `team="${escapeFilter(team)}"` });
      for (const record of records) {
        await getPb().collection('oncall').update(record.id, { sortOrder: i });
      }
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
