/**
 * ContactJsonOperations - Contact CRUD operations using JSON storage
 * Follows the pattern established in PresetOperations.ts
 * Uses cross-process file locking for multi-instance synchronization.
 */

import type { ContactRecord } from '@shared/ipc';
import { loggers } from '../logger';
import { generateId } from './idUtils';
import {
  readAll,
  modifyItems,
  deleteById,
  updateById,
  bulkUpsert,
  type JsonCrudConfig,
} from './jsonCrudHelper';

const config: JsonCrudConfig = {
  fileName: 'contacts.json',
  logPrefix: '[ContactJsonOperations]',
};

/**
 * Read all contacts from contacts.json
 */
export async function getContacts(rootDir: string): Promise<ContactRecord[]> {
  return readAll<ContactRecord>(rootDir, config);
}

/**
 * Add a new contact
 */
export async function addContactRecord(
  rootDir: string,
  contact: Omit<ContactRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<ContactRecord | null> {
  let result: ContactRecord | null = null;

  return modifyItems<ContactRecord, ContactRecord | null>(
    rootDir,
    config,
    (contacts) => {
      // Check for duplicate email
      const existingIndex = contacts.findIndex(
        (c) => c.email.toLowerCase() === contact.email.toLowerCase(),
      );

      if (existingIndex === -1) {
        const now = Date.now();
        const newContact: ContactRecord = {
          id: generateId('contact'),
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          title: contact.title,
          createdAt: now,
          updatedAt: now,
        };
        contacts.push(newContact);
        result = newContact;
        loggers.fileManager.info(`[ContactJsonOperations] Added contact: ${newContact.email}`);
        return contacts;
      }

      // Update existing contact instead of adding duplicate
      const now = Date.now();
      contacts[existingIndex] = {
        ...contacts[existingIndex],
        ...contact,
        updatedAt: now,
      };
      result = contacts[existingIndex];
      loggers.fileManager.info(
        `[ContactJsonOperations] Updated existing contact: ${contact.email}`,
      );
      return contacts;
    },
    () => result,
    null,
    'addContact',
  );
}

/**
 * Update an existing contact by ID
 */
export async function updateContactRecord(
  rootDir: string,
  id: string,
  updates: Partial<Omit<ContactRecord, 'id' | 'createdAt'>>,
): Promise<boolean> {
  return updateById<ContactRecord>(
    rootDir,
    config,
    id,
    updates as Partial<ContactRecord>,
    (c) => c.email,
    'contact',
  );
}

/**
 * Delete a contact by ID
 */
export async function deleteContactRecord(rootDir: string, id: string): Promise<boolean> {
  return deleteById<ContactRecord>(rootDir, config, id, 'contact');
}

/**
 * Find a contact by email address
 */
export async function findContactByEmail(
  rootDir: string,
  email: string,
): Promise<ContactRecord | null> {
  try {
    const contacts = await getContacts(rootDir);
    return contacts.find((c) => c.email.toLowerCase() === email.toLowerCase()) || null;
  } catch (e) {
    loggers.fileManager.error('[ContactJsonOperations] findContactByEmail error:', { error: e });
    return null;
  }
}

/**
 * Bulk add/update contacts (for import operations)
 */
export async function bulkUpsertContacts(
  rootDir: string,
  newContacts: Omit<ContactRecord, 'id' | 'createdAt' | 'updatedAt'>[],
): Promise<{ imported: number; updated: number; errors: string[] }> {
  return bulkUpsert<ContactRecord>(
    rootDir,
    config,
    newContacts,
    'contact',
    (c) => c.email.toLowerCase(),
    (c) => c.email.toLowerCase(),
    (c) => `contact ${c.email}`,
  );
}
