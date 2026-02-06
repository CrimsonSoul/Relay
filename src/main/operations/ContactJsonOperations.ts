/**
 * ContactJsonOperations - Contact CRUD operations using JSON storage
 * Follows the pattern established in PresetOperations.ts
 * Uses cross-process file locking for multi-instance synchronization.
 */

import { join } from "path";
import { randomUUID } from "crypto";
import type { ContactRecord } from "@shared/ipc";
import { loggers } from "../logger";
import { modifyJsonWithLock, readWithLock } from "../fileLock";

const CONTACTS_FILE = "contacts.json";
const CONTACTS_FILE_PATH = (rootDir: string) => join(rootDir, CONTACTS_FILE);

function generateId(): string {
  return `contact_${Date.now()}_${randomUUID()}`;
}

/**
 * Read all contacts from contacts.json
 */

// ...

export async function getContacts(rootDir: string): Promise<ContactRecord[]> {
  const path = CONTACTS_FILE_PATH(rootDir);
  try {
    const contents = await readWithLock(path);
    if (!contents) return [];
    
    try {
      const data = JSON.parse(contents);
      return Array.isArray(data) ? data : [];
    } catch (parseError) {
      loggers.fileManager.error("[ContactJsonOperations] JSON parse error:", { error: parseError, path });
      return [];
    }
  } catch (e) {
    if (e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT") return [];
    loggers.fileManager.error("[ContactJsonOperations] getContacts error:", { error: e });
    throw e;
  }
}

/**
 * Add a new contact
 */
export async function addContactRecord(
  rootDir: string,
  contact: Omit<ContactRecord, "id" | "createdAt" | "updatedAt">
): Promise<ContactRecord | null> {
  try {
    let result: ContactRecord | null = null;
    const path = CONTACTS_FILE_PATH(rootDir);

    await modifyJsonWithLock<ContactRecord[]>(path, (contacts) => {
      // Check for duplicate email
      const existingIndex = contacts.findIndex(
        (c) => c.email.toLowerCase() === contact.email.toLowerCase()
      );

      if (existingIndex !== -1) {
        // Update existing contact instead of adding duplicate
        const now = Date.now();
        contacts[existingIndex] = {
          ...contacts[existingIndex],
          ...contact,
          updatedAt: now,
        };
        result = contacts[existingIndex];
        loggers.fileManager.info(`[ContactJsonOperations] Updated existing contact: ${contact.email}`);
      } else {
        const now = Date.now();
        const newContact: ContactRecord = {
          id: generateId(),
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
      }
      return contacts;
    }, []);

    return result;
  } catch (e) {
    loggers.fileManager.error("[ContactJsonOperations] addContact error:", { error: e });
    return null;
  }
}

/**
 * Update an existing contact by ID
 */
export async function updateContactRecord(
  rootDir: string,
  id: string,
  updates: Partial<Omit<ContactRecord, "id" | "createdAt">>
): Promise<boolean> {
  try {
    let found = false;
    const path = CONTACTS_FILE_PATH(rootDir);

    await modifyJsonWithLock<ContactRecord[]>(path, (contacts) => {
      const index = contacts.findIndex((c) => c.id === id);
      if (index === -1) return contacts;

      contacts[index] = {
        ...contacts[index],
        ...updates,
        updatedAt: Date.now(),
      };
      found = true;
      loggers.fileManager.info(`[ContactJsonOperations] Updated contact: ${contacts[index].email}`);
      return contacts;
    }, []);

    return found;
  } catch (e) {
    loggers.fileManager.error("[ContactJsonOperations] updateContact error:", { error: e });
    return false;
  }
}

/**
 * Delete a contact by ID
 */
export async function deleteContactRecord(rootDir: string, id: string): Promise<boolean> {
  try {
    let deleted = false;
    const path = CONTACTS_FILE_PATH(rootDir);

    await modifyJsonWithLock<ContactRecord[]>(path, (contacts) => {
      const initialLength = contacts.length;
      const filtered = contacts.filter((c) => c.id !== id);
      if (filtered.length === initialLength) return contacts;

      deleted = true;
      loggers.fileManager.info(`[ContactJsonOperations] Deleted contact: ${id}`);
      return filtered;
    }, []);

    return deleted;
  } catch (e) {
    loggers.fileManager.error("[ContactJsonOperations] deleteContact error:", { error: e });
    return false;
  }
}


/**
 * Find a contact by email address
 */
export async function findContactByEmail(
  rootDir: string,
  email: string
): Promise<ContactRecord | null> {
  try {
    const contacts = await getContacts(rootDir);
    return contacts.find((c) => c.email.toLowerCase() === email.toLowerCase()) || null;
  } catch (e) {
    loggers.fileManager.error("[ContactJsonOperations] findContactByEmail error:", { error: e });
    return null;
  }
}

/**
 * Bulk add/update contacts (for import operations)
 */
export async function bulkUpsertContacts(
  rootDir: string,
  newContacts: Omit<ContactRecord, "id" | "createdAt" | "updatedAt">[]
): Promise<{ imported: number; updated: number; errors: string[] }> {
  const result = { imported: 0, updated: 0, errors: [] as string[] };
  const path = CONTACTS_FILE_PATH(rootDir);

  try {
    await modifyJsonWithLock<ContactRecord[]>(path, (contacts) => {
      const emailMap = new Map(contacts.map((c) => [c.email.toLowerCase(), c]));
      const now = Date.now();

      for (const newContact of newContacts) {
        try {
          const emailKey = newContact.email.toLowerCase();
          const existing = emailMap.get(emailKey);

          if (existing) {
            // Update existing
            const updated: ContactRecord = {
              ...existing,
              ...newContact,
              updatedAt: now,
            };
            emailMap.set(emailKey, updated);
            result.updated++;
          } else {
            // Add new
            const record: ContactRecord = {
              id: generateId(),
              ...newContact,
              createdAt: now,
              updatedAt: now,
            };
            emailMap.set(emailKey, record);
            result.imported++;
          }
        } catch (e) {
          result.errors.push(`Failed to process contact ${newContact.email}: ${e}`);
        }
      }

      loggers.fileManager.info(
        `[ContactJsonOperations] Bulk upsert: ${result.imported} imported, ${result.updated} updated`
      );
      return Array.from(emailMap.values());
    }, []);
  } catch (e) {
    result.errors.push(`Bulk upsert failed: ${e}`);
    loggers.fileManager.error("[ContactJsonOperations] bulkUpsertContacts error:", { error: e });
  }

  return result;
}

