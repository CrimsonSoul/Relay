import { getPb, handleApiError, escapeFilter, requireOnline } from './pocketbase';

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

export async function addContact(data: ContactInput): Promise<ContactRecord> {
  requireOnline();
  try {
    return await getPb().collection('contacts').create<ContactRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateContact(
  id: string,
  data: Partial<ContactInput>,
): Promise<ContactRecord> {
  requireOnline();
  try {
    return await getPb().collection('contacts').update<ContactRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteContact(id: string): Promise<void> {
  requireOnline();
  try {
    await getPb().collection('contacts').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function findContactByEmail(email: string): Promise<ContactRecord | null> {
  try {
    const result = await getPb()
      .collection('contacts')
      .getFirstListItem<ContactRecord>(`email="${escapeFilter(email)}"`);
    return result;
  } catch (err: unknown) {
    if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) {
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
