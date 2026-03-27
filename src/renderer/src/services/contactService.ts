import { getPb, handleApiError, escapeFilter, requireOnline } from './pocketbase';
import { isPbNotFoundError } from './pbErrors';
import { createCrudService } from './crudServiceFactory';

export interface ContactRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  created: string;
  updated: string;
}

export type ContactInput = Omit<ContactRecord, 'id' | 'created' | 'updated'>;

const crud = createCrudService<ContactRecord>('contacts');

export const addContact = (data: ContactInput): Promise<ContactRecord> => crud.create(data);

export const updateContact = (id: string, data: Partial<ContactInput>): Promise<ContactRecord> =>
  crud.update(id, data);

export const deleteContact = (id: string): Promise<void> => crud.remove(id);

export async function findContactByEmail(email: string): Promise<ContactRecord | null> {
  try {
    const result = await getPb()
      .collection('contacts')
      .getFirstListItem<ContactRecord>(`email="${escapeFilter(email)}"`);
    return result;
  } catch (err: unknown) {
    if (isPbNotFoundError(err)) {
      return null;
    }
    handleApiError(err);
    throw err;
  }
}

export async function bulkUpsertContacts(contacts: ContactInput[]): Promise<ContactRecord[]> {
  requireOnline();
  const results: ContactRecord[] = [];
  for (const contact of contacts) {
    try {
      const existing = await findContactByEmail(contact.email);
      if (existing) {
        const updated = await updateContact(existing.id, contact);
        results.push(updated);
      } else {
        const created = await addContact(contact);
        results.push(created);
      }
    } catch (err) {
      handleApiError(err);
      throw err;
    }
  }
  return results;
}
