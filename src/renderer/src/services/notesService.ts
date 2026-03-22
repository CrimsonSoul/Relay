import { getPb, handleApiError } from './pocketbase';

export interface NoteRecord {
  id: string;
  entityType: 'contact' | 'server';
  entityKey: string;
  note: string;
  tags: string[];
  created: string;
  updated: string;
}

export type NoteInput = Omit<NoteRecord, 'id' | 'created' | 'updated'>;

export async function getNote(
  entityType: 'contact' | 'server',
  entityKey: string,
): Promise<NoteRecord | null> {
  try {
    const result = await getPb()
      .collection('notes')
      .getFirstListItem<NoteRecord>(`entityType="${entityType}" && entityKey="${entityKey}"`);
    return result;
  } catch (err: unknown) {
    if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) {
      return null;
    }
    handleApiError(err);
    throw err;
  }
}

export async function setNote(
  entityType: 'contact' | 'server',
  entityKey: string,
  note: string,
  tags: string[],
): Promise<NoteRecord> {
  try {
    const existing = await getNote(entityType, entityKey);
    if (existing) {
      return await getPb().collection('notes').update<NoteRecord>(existing.id, { note, tags });
    }
    return await getPb()
      .collection('notes')
      .create<NoteRecord>({ entityType, entityKey, note, tags });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
