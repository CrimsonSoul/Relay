import { getConnectionState, getPb, handleApiError, escapeFilter } from './pocketbase';
import { isPbNotFoundError } from './pbErrors';
import { mutateCollection } from './mutationGateway';
import { getRelayRuntime } from '../runtime/relayRuntime';

export interface NoteRecord {
  id: string;
  entityType: 'contact' | 'server';
  entityKey: string;
  note: string;
  tags: string[];
  created: string;
  updated: string;
}

/**
 * PocketBase filter for the note attached to an entity. Entity keys are matched case-insensitively
 * (emails and server names are case-insensitive, and the notes hook keys them lower-cased); when
 * historical duplicates exist, callers sort by `-updated` so the newest note is the one edited.
 */
export function noteIdentityFilter(entityType: string, entityKey: string): string {
  return `entityType="${escapeFilter(entityType)}" && entityKey:lower="${escapeFilter(entityKey.toLowerCase())}"`;
}

async function findExistingNote(
  entityType: 'contact' | 'server',
  entityKey: string,
): Promise<NoteRecord | null | undefined> {
  if (getConnectionState() === 'online') return getNote(entityType, entityKey);
  if (getRelayRuntime().kind === 'web') return undefined;
  const key = entityKey.toLowerCase();
  const matches = ((await globalThis.api?.cacheRead?.('notes')) ?? []).filter(
    (record) =>
      record.entityType === entityType &&
      typeof record.entityKey === 'string' &&
      record.entityKey.toLowerCase() === key,
  ) as unknown as NoteRecord[];
  return matches.reduce<NoteRecord | undefined>(
    (newest, record) => (!newest || record.updated > newest.updated ? record : newest),
    undefined,
  );
}

export async function getNote(
  entityType: 'contact' | 'server',
  entityKey: string,
): Promise<NoteRecord | null> {
  try {
    const result = await getPb()
      .collection('notes')
      .getFirstListItem<NoteRecord>(noteIdentityFilter(entityType, entityKey), {
        sort: '-updated',
      });
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
    const existing = await findExistingNote(entityType, entityKey);
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
