/**
 * NotesOperations - Notes and tags overlay for contacts and servers
 * Stored as JSON to allow flexible nested data
 * Uses cross-process file locking for multi-instance synchronization.
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { NotesData } from "@shared/ipc";
import { loggers } from "../logger";
import { modifyJsonWithLock } from "../fileLock";

const NOTES_FILE = "notes.json";
const NOTES_FILE_PATH = (rootDir: string) => join(rootDir, NOTES_FILE);

const emptyNotes: NotesData = {
  contacts: {},
  servers: {},
};

export async function getNotes(rootDir: string): Promise<NotesData> {
  const path = NOTES_FILE_PATH(rootDir);
  try {
    if (!existsSync(path)) return emptyNotes;
    const contents = await fs.readFile(path, "utf-8");
    const data = JSON.parse(contents);
    return {
      contacts: data.contacts || {},
      servers: data.servers || {},
    };
  } catch (e) {
    if ((e as any)?.code === "ENOENT") return emptyNotes;
    loggers.fileManager.error("[NotesOperations] getNotes error:", { error: e });
    throw e;
  }
}

export async function setContactNote(
  rootDir: string,
  email: string,
  note: string,
  tags: string[]
): Promise<boolean> {
  try {
    const key = email.toLowerCase();
    const path = NOTES_FILE_PATH(rootDir);

    await modifyJsonWithLock<NotesData>(path, (notes) => {
      // Ensure structure is correct
      if (!notes.contacts) notes.contacts = {};
      if (!notes.servers) notes.servers = {};

      if (!note && tags.length === 0) {
        // Remove the entry if both note and tags are empty
        delete notes.contacts[key];
      } else {
        notes.contacts[key] = {
          note,
          tags,
          updatedAt: Date.now(),
        };
      }
      return notes;
    }, emptyNotes);

    loggers.fileManager.info(`[NotesOperations] Set contact note for: ${email}`);
    return true;
  } catch (e) {
    loggers.fileManager.error("[NotesOperations] setContactNote error:", { error: e });
    return false;
  }
}

export async function setServerNote(
  rootDir: string,
  name: string,
  note: string,
  tags: string[]
): Promise<boolean> {
  try {
    const key = name.toLowerCase();
    const path = NOTES_FILE_PATH(rootDir);

    await modifyJsonWithLock<NotesData>(path, (notes) => {
      // Ensure structure is correct
      if (!notes.contacts) notes.contacts = {};
      if (!notes.servers) notes.servers = {};

      if (!note && tags.length === 0) {
        // Remove the entry if both note and tags are empty
        delete notes.servers[key];
      } else {
        notes.servers[key] = {
          note,
          tags,
          updatedAt: Date.now(),
        };
      }
      return notes;
    }, emptyNotes);

    loggers.fileManager.info(`[NotesOperations] Set server note for: ${name}`);
    return true;
  } catch (e) {
    loggers.fileManager.error("[NotesOperations] setServerNote error:", { error: e });
    return false;
  }
}

