import { getPb, handleApiError } from './pocketbase';

export interface OnCallRecord {
  id: string;
  team: string;
  role: string;
  name: string;
  contact: string;
  timeWindow: string;
  sortOrder: number;
  created: string;
  updated: string;
}

export type OnCallInput = Omit<OnCallRecord, 'id' | 'created' | 'updated'>;

export async function addOnCall(data: OnCallInput): Promise<OnCallRecord> {
  try {
    return await getPb().collection('oncall').create<OnCallRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateOnCall(id: string, data: Partial<OnCallInput>): Promise<OnCallRecord> {
  try {
    return await getPb().collection('oncall').update<OnCallRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteOnCall(id: string): Promise<void> {
  try {
    await getPb().collection('oncall').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteOnCallByTeam(team: string): Promise<void> {
  try {
    const records = await getPb()
      .collection('oncall')
      .getFullList<OnCallRecord>({ filter: `team="${team}"` });
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
  try {
    const records = await getPb()
      .collection('oncall')
      .getFullList<OnCallRecord>({ filter: `team="${oldName}"` });
    for (const record of records) {
      await getPb().collection('oncall').update(record.id, { team: newName });
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function reorderTeams(teamOrder: string[]): Promise<void> {
  try {
    for (let i = 0; i < teamOrder.length; i++) {
      const team = teamOrder[i];
      const records = await getPb()
        .collection('oncall')
        .getFullList<OnCallRecord>({ filter: `team="${team}"` });
      for (const record of records) {
        await getPb().collection('oncall').update(record.id, { sortOrder: i });
      }
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
