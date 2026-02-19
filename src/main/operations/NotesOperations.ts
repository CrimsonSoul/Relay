/**
 * NotesOperations - Notes and tags overlay for contacts and servers
 * Stored as JSON to allow flexible nested data
 * Uses cross-process file locking for multi-instance synchronization.
 */

import { join } from 'path';
import type { NotesData } from '@shared/ipc';
import { isNodeError } from '@shared/types';
import { loggers } from '../logger';
import { modifyJsonWithLock, readWithLock } from '../fileLock';

const NOTES_FILE = 'notes.json';
const NOTES_FILE_PATH = (rootDir: string) => join(rootDir, NOTES_FILE);

const emptyNotes: NotesData = {
  contacts: {},
  servers: {},
};

export async function getNotes(rootDir: string): Promise<NotesData> {
  const path = NOTES_FILE_PATH(rootDir);
  try {
    const contents = await readWithLock(path);
    if (!contents) return emptyNotes;

    try {
      const data = JSON.parse(contents);
      return {
        contacts: data.contacts || {},
        servers: data.servers || {},
      };
    } catch (parseError) {
      loggers.fileManager.error('[NotesOperations] JSON parse error:', { error: parseError, path });
      return emptyNotes;
    }
  } catch (e) {
    if (isNodeError(e) && e.code === 'ENOENT') return emptyNotes;
    loggers.fileManager.error('[NotesOperations] getNotes error:', { error: e });
    throw e;
  }
}

/**
 * Internal helper for setting a note on either a contact or server.
 */
async function setNote(
  rootDir: string,
  category: 'contacts' | 'servers',
  identifier: string,
  note: string,
  tags: string[],
): Promise<boolean> {
  try {
    const key = identifier.toLowerCase();
    const path = NOTES_FILE_PATH(rootDir);

    await modifyJsonWithLock<NotesData>(
      path,
      (notes) => {
        // Ensure structure is correct
        if (!notes.contacts) notes.contacts = {};
        if (!notes.servers) notes.servers = {};

        if (!note && tags.length === 0) {
          // Remove the entry if both note and tags are empty
          delete notes[category][key];
        } else {
          notes[category][key] = {
            note,
            tags,
            updatedAt: Date.now(),
          };
        }
        return notes;
      },
      emptyNotes,
    );

    loggers.fileManager.info(`[NotesOperations] Set ${category} note for: ${identifier}`);
    return true;
  } catch (e) {
    loggers.fileManager.error(`[NotesOperations] set${category}Note error:`, { error: e });
    return false;
  }
}

export async function setContactNote(
  rootDir: string,
  email: string,
  note: string,
  tags: string[],
): Promise<boolean> {
  return setNote(rootDir, 'contacts', email, note, tags);
}

export async function setServerNote(
  rootDir: string,
  name: string,
  note: string,
  tags: string[],
): Promise<boolean> {
  return setNote(rootDir, 'servers', name, note, tags);
}
