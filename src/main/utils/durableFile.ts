import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Options for publishing a file through a temporary file. `exclusive` refuses an existing temporary
 * file, for callers that name it uniquely; a fixed temporary name must overwrite a crash leftover.
 * `syncDirectory` also flushes the target's directory entry after the rename on platforms that
 * support it (not Windows), for records whose replacement must itself survive a power loss.
 */
export type DurableReplaceOptions = { mode?: number; exclusive?: boolean; syncDirectory?: boolean };

const directoriesSync = process.platform !== 'win32';

/**
 * Publishes a file through a temporary file so readers see either the previous or the complete new
 * contents. The data is flushed before the rename because NTFS journals the rename but not file
 * data: after a power loss an unflushed file can keep its new size as zero bytes.
 */
export async function replaceFileDurably(
  temporaryPath: string,
  targetPath: string,
  contents: string | Uint8Array,
  { mode = 0o666, exclusive = false, syncDirectory = false }: DurableReplaceOptions = {},
): Promise<void> {
  try {
    const handle = await open(temporaryPath, exclusive ? 'wx' : 'w', mode);
    try {
      await handle.writeFile(contents, typeof contents === 'string' ? 'utf8' : undefined);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, targetPath);
    if (syncDirectory && directoriesSync) {
      const directory = await open(dirname(targetPath), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Synchronous {@link replaceFileDurably} for state that is saved on the main-process hot path. */
export function replaceFileDurablySync(
  temporaryPath: string,
  targetPath: string,
  contents: string | Uint8Array,
  { mode = 0o666, exclusive = false, syncDirectory = false }: DurableReplaceOptions = {},
): void {
  try {
    const descriptor = openSync(temporaryPath, exclusive ? 'wx' : 'w', mode);
    try {
      writeFileSync(descriptor, contents, typeof contents === 'string' ? 'utf8' : undefined);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, targetPath);
    if (syncDirectory && directoriesSync) {
      const directory = openSync(dirname(targetPath), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // The original failure is the useful one.
    }
    throw error;
  }
}

/** Flushes an existing file's data to disk. Windows requires write access to flush a file. */
export async function flushFile(path: string): Promise<void> {
  const handle = await open(path, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
