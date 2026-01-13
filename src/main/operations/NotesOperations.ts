/**
 * NotesOperations - Notes and tags overlay for contacts and servers
 * Stored as JSON to allow flexible nested data
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { NotesData } from "@shared/ipc";
import { loggers } from "../logger";

const NOTES_FILE = "notes.json";

const emptyNotes: NotesData = {
  contacts: {},
  servers: {},
};

// Simple mutex to prevent concurrent writes to notes file
let writeInProgress: Promise<void> | null = null;

export async function getNotes(rootDir: string): Promise<NotesData> {
  const path = join(rootDir, NOTES_FILE);
  try {
    if (!existsSync(path)) return emptyNotes;
    const contents = await fs.readFile(path, "utf-8");
    const data = JSON.parse(contents);
    return {
      contacts: data.contacts || {},
      servers: data.servers || {},
    };
  } catch (e) {
    loggers.fileManager.error("[NotesOperations] getNotes error:", { error: e });
    return emptyNotes;
  }
}

async function writeNotes(rootDir: string, notes: NotesData): Promise<void> {
  const path = join(rootDir, NOTES_FILE);
  const content = JSON.stringify(notes, null, 2);
  await fs.writeFile(`${path}.tmp`, content, "utf-8");
  await fs.rename(`${path}.tmp`, path);
}

/**
 * Execute a notes update with mutex protection to prevent race conditions.
 * Waits for any in-progress write to complete before reading and writing.
 */
async function withNotesMutex<T>(
  rootDir: string,
  operation: (notes: NotesData) => NotesData | Promise<NotesData>
): Promise<T extends void ? boolean : T> {
  // Wait for any in-progress write to complete
  if (writeInProgress) {
    await writeInProgress;
  }

  let resolve: () => void;
  writeInProgress = new Promise<void>((r) => { resolve = r; });

  try {
    const notes = await getNotes(rootDir);
    const updatedNotes = await operation(notes);
    await writeNotes(rootDir, updatedNotes);
    return true as T extends void ? boolean : T;
  } finally {
    resolve!();
    writeInProgress = null;
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

    await withNotesMutex(rootDir, (notes) => {
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
    });

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

    await withNotesMutex(rootDir, (notes) => {
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
    });

    loggers.fileManager.info(`[NotesOperations] Set server note for: ${name}`);
    return true;
  } catch (e) {
    loggers.fileManager.error("[NotesOperations] setServerNote error:", { error: e });
    return false;
  }
}
