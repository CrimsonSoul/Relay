import { getConnectionState, getPb, handleApiError, escapeFilter } from './pocketbase';
import { isPbNotFoundError } from './pbErrors';
import { mutateCollection } from './mutationGateway';

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
      .getFirstListItem<NoteRecord>(
        `entityType="${escapeFilter(entityType)}" && entityKey="${escapeFilter(entityKey)}"`,
      );
    return result;
  } catch (err: unknown) {
    if (isPbNotFoundError(err)) {
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
    const existing =
      getConnectionState() === 'online'
        ? await getNote(entityType, entityKey)
        : (((await globalThis.api?.cacheRead?.('notes')) ?? []).find(
            (record) => record.entityType === entityType && record.entityKey === entityKey,
          ) as NoteRecord | undefined);
    if (existing) {
      return (await mutateCollection<NoteRecord>('notes', 'update', existing.id, {
        note,
        tags,
      })) as NoteRecord;
    }
    return (await mutateCollection<NoteRecord>('notes', 'create', undefined, {
      entityType,
      entityKey,
      note,
      tags,
    })) as NoteRecord;
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
