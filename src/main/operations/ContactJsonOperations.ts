/**
 * ContactJsonOperations - Contact CRUD operations using JSON storage
 * Follows the pattern established in PresetOperations.ts
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { ContactRecord } from "@shared/ipc";
import { loggers } from "../logger";

const CONTACTS_FILE = "contacts.json";

function generateId(): string {
  return `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Read all contacts from contacts.json
 */
export async function getContacts(rootDir: string): Promise<ContactRecord[]> {
  const path = join(rootDir, CONTACTS_FILE);
  try {
    if (!existsSync(path)) return [];
    const contents = await fs.readFile(path, "utf-8");
    const data = JSON.parse(contents);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    loggers.fileManager.error("[ContactJsonOperations] getContacts error:", { error: e });
    return [];
  }
}

/**
 * Write contacts to contacts.json using atomic write
 */
async function writeContacts(rootDir: string, contacts: ContactRecord[]): Promise<void> {
  const path = join(rootDir, CONTACTS_FILE);
  const content = JSON.stringify(contacts, null, 2);
  await fs.writeFile(`${path}.tmp`, content, "utf-8");
  await fs.rename(`${path}.tmp`, path);
}

/**
 * Add a new contact
 */
export async function addContactRecord(
  rootDir: string,
  contact: Omit<ContactRecord, "id" | "createdAt" | "updatedAt">
): Promise<ContactRecord | null> {
  try {
    const contacts = await getContacts(rootDir);

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
      await writeContacts(rootDir, contacts);
      loggers.fileManager.info(`[ContactJsonOperations] Updated existing contact: ${contact.email}`);
      return contacts[existingIndex];
    }

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
    await writeContacts(rootDir, contacts);
    loggers.fileManager.info(`[ContactJsonOperations] Added contact: ${newContact.email}`);
    return newContact;
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
    const contacts = await getContacts(rootDir);
    const index = contacts.findIndex((c) => c.id === id);
    if (index === -1) return false;

    contacts[index] = {
      ...contacts[index],
      ...updates,
      updatedAt: Date.now(),
    };
    await writeContacts(rootDir, contacts);
    loggers.fileManager.info(`[ContactJsonOperations] Updated contact: ${contacts[index].email}`);
    return true;
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
    const contacts = await getContacts(rootDir);
    const filtered = contacts.filter((c) => c.id !== id);
    if (filtered.length === contacts.length) return false;
    await writeContacts(rootDir, filtered);
    loggers.fileManager.info(`[ContactJsonOperations] Deleted contact: ${id}`);
    return true;
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

  try {
    const contacts = await getContacts(rootDir);
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

    await writeContacts(rootDir, Array.from(emailMap.values()));
    loggers.fileManager.info(
      `[ContactJsonOperations] Bulk upsert: ${result.imported} imported, ${result.updated} updated`
    );
  } catch (e) {
    result.errors.push(`Bulk upsert failed: ${e}`);
    loggers.fileManager.error("[ContactJsonOperations] bulkUpsertContacts error:", { error: e });
  }

  return result;
}
