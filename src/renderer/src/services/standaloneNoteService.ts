import { getPb, handleApiError, requireOnline } from './pocketbase';
import { createCrudService } from './crudServiceFactory';

export interface StandaloneNoteRecord {
  id: string;
  title: string;
  content: string;
  color: string;
  tags: string[];
  sortOrder: number;
  created: string;
  updated: string;
}

export type StandaloneNoteInput = Omit<StandaloneNoteRecord, 'id' | 'created' | 'updated'>;

const crud = createCrudService<StandaloneNoteRecord>('standalone_notes');

export const addStandaloneNote = (data: StandaloneNoteInput): Promise<StandaloneNoteRecord> =>
  crud.create(data);

export const updateStandaloneNote = (
  id: string,
  data: Partial<StandaloneNoteInput>,
): Promise<StandaloneNoteRecord> => crud.update(id, data);

export const deleteStandaloneNote = (id: string): Promise<void> => crud.remove(id);

export async function clearStandaloneNotes(): Promise<void> {
  requireOnline();
  try {
    const records = await getPb()
      .collection('standalone_notes')
      .getFullList<StandaloneNoteRecord>();
    for (const record of records) {
      await getPb().collection('standalone_notes').delete(record.id);
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

/** Batch-update sortOrder for multiple notes in a single call sequence. */
export async function reorderStandaloneNotes(
  orderedIds: { id: string; sortOrder: number }[],
): Promise<void> {
  requireOnline();
  try {
    for (const { id, sortOrder } of orderedIds) {
      await getPb().collection('standalone_notes').update(id, { sortOrder });
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
