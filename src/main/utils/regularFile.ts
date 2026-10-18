import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';

// POSIX refuses symlinks and FIFOs at open time; Windows lacks these flags and relies on the
// identity check below.
const NOT_REGULAR_CODES = new Set(['ELOOP', 'EISDIR', 'EMLINK']);

export type RegularFileOptions = {
  /** Refuse a path that is itself a symbolic link (the lstat semantics of the old checks). */
  rejectSymlinks?: boolean;
};

export type OpenRegularFile = { handle: FileHandle; stats: BigIntStats };

/**
 * Opens a regular file and returns its handle with stats read from that handle, so later checks
 * and reads apply to the same file instead of whatever the path names by then. Returns null for a
 * directory, device, or (with `rejectSymlinks`) a symbolic link; other errors such as ENOENT
 * propagate. The caller must close the handle.
 */
export async function openRegularFile(
  path: string,
  { rejectSymlinks = true }: RegularFileOptions = {},
): Promise<OpenRegularFile | null> {
  let handle: FileHandle;
  try {
    // Read at call time: platform constants are absent on Windows (and in partial fs mocks).
    const flags = (constants?.O_RDONLY ?? 0) | (constants?.O_NONBLOCK ?? 0);
    const noFollow = rejectSymlinks ? (constants?.O_NOFOLLOW ?? 0) : 0;
    handle = await open(path, flags | noFollow);
  } catch (error) {
    if (NOT_REGULAR_CODES.has((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) {
      await handle.close();
      return null;
    }
    if (rejectSymlinks) {
      // The path must still name the opened file and must not be a link to it.
      const link = await lstat(path, { bigint: true });
      if (link.isSymbolicLink() || link.dev !== stats.dev || link.ino !== stats.ino) {
        await handle.close();
        return null;
      }
    }
    return { handle, stats };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export type ReadRegularFileOptions = RegularFileOptions & {
  maxBytes: number;
  minBytes?: number;
};

/**
 * Reads a regular file whose size is within bounds, or returns null when it is not a regular file,
 * is a refused symbolic link, or is outside the bounds. Errors such as ENOENT propagate.
 */
export async function readRegularFile(
  path: string,
  { maxBytes, minBytes = 0, rejectSymlinks = true }: ReadRegularFileOptions,
): Promise<Buffer | null> {
  const opened = await openRegularFile(path, { rejectSymlinks });
  if (!opened) return null;
  const { handle, stats } = opened;
  try {
    if (stats.size < BigInt(minBytes) || stats.size > BigInt(maxBytes)) return null;
    const data = await handle.readFile();
    return data.length >= minBytes && data.length <= maxBytes ? data : null;
  } finally {
    await handle.close();
  }
}
