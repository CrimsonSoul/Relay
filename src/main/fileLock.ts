/**
 * Simplified file operations without cross-process locking.
 * Replaces the complex locking mechanism to avoid save/revert issues.
 *
 * File Locking Strategy (as of v1.0.0):
 * This module intentionally omits cross-process file locking. The rationale:
 *
 * 1. Single Instance Lock: The app uses app.requestSingleInstanceLock() in index.ts,
 *    ensuring only one instance can run per machine.
 *
 * 2. Network Storage: For OneDrive/shared drives, we use atomic write-to-temp-and-rename
 *    with retry logic, which provides sufficient data integrity for standard operations.
 *
 * 3. Complexity vs. Benefit: The previous proper-lockfile dependency caused issues
 *    with Windows/OneDrive environments and added significant complexity.
 *
 * If multi-instance support is needed in the future, consider implementing an
 * advisory lock file mechanism (.lock file creation/deletion).
 *
 * Provides atomic file operations (write-to-temp-and-rename) to ensure data integrity,
 * but removes the 'proper-lockfile' dependency which was causing issues with some
 * environments and legacy file handling.
 */

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loggers } from './logger';

// Maximum file size for JSON reads (50 MB). Prevents OOM from unexpectedly large files.
const MAX_JSON_READ_BYTES = 50 * 1024 * 1024;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Helper to retry operations (kept for robustness against Windows transient errors)
async function retryOperation<T>(
  operation: () => Promise<T>,
  retries = 3,
  baseDelay = 100,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (e) {
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, baseDelay));
    }
  }
  throw lastError;
}

/**
 * Atomic write using temp file and rename.
 * Ensures data integrity by writing to a temp file first, then renaming it.
 */
export async function atomicWriteWithLock(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    // Write temp file with fsync to ensure data reaches disk before rename
    const fh = await fs.open(tempPath, 'w', 0o600);
    try {
      await fh.writeFile(content, 'utf-8');
      await fh.datasync();
    } finally {
      await fh.close();
    }

    // Atomic rename with robust retry for Windows/OneDrive latency
    await retryOperation(() => fs.rename(tempPath, filePath));
  } catch (error) {
    loggers.fileManager.error('Atomic write failed:', { error, filePath });
    // Try to clean up temp file if rename failed
    try {
      if (await fileExists(tempPath)) await fs.unlink(tempPath);
    } catch (error_) {
      loggers.fileManager.debug(`Temp file cleanup failed (likely already gone): ${tempPath}`, {
        error: error_,
      });
    }
    throw error;
  }
}

/**
 * Simple read without locking overhead.
 * Reads the file directly and catches ENOENT, avoiding a stat-then-read TOCTOU race.
 */
export async function readWithLock(filePath: string): Promise<string | null> {
  try {
    // Read the file as a Buffer first so we can check its byte length
    // before decoding. This avoids a stat-then-read TOCTOU race where the
    // file could change (or be deleted) between the stat and the read.
    const buf = await retryOperation(() => fs.readFile(filePath));
    if (buf.byteLength > MAX_JSON_READ_BYTES) {
      loggers.fileManager.error('File exceeds maximum read size limit', {
        filePath,
        size: buf.byteLength,
        maxSize: MAX_JSON_READ_BYTES,
      });
      throw new Error(
        `File too large (${buf.byteLength} bytes, max ${MAX_JSON_READ_BYTES}): ${filePath}`,
      );
    }
    return buf.toString('utf-8');
  } catch (error) {
    // ENOENT means file doesn't exist — return null (expected)
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null;
    }
    // All other read failures are real errors — throw to prevent data loss
    loggers.fileManager.error('Read failed:', { error, filePath });
    throw error;
  }
}

/**
 * Per-path async mutex to prevent concurrent read-modify-write races.
 * Each path gets a promise chain — callers queue behind the previous operation.
 */
const pathLocks = new Map<string, Promise<void>>();

function withPathLock(filePath: string, fn: () => Promise<void>): Promise<void> {
  const prev = pathLocks.get(filePath) ?? Promise.resolve();
  const next = prev.then(fn, fn); // Run fn after previous settles (even on error)
  pathLocks.set(filePath, next);
  // Clean up the map entry once idle to avoid unbounded growth
  void next.then(() => {
    if (pathLocks.get(filePath) === next) pathLocks.delete(filePath);
  });
  return next;
}

/**
 * JSON-specific read-modify-write with per-path async mutex.
 * Serializes concurrent modifications to the same file to prevent lost updates.
 */
export function modifyJsonWithLock<T>(
  filePath: string,
  modifier: (data: T) => Promise<T> | T,
  defaultValue: T,
): Promise<void> {
  return withPathLock(filePath, async () => {
    let data: T = defaultValue;

    const content = await readWithLock(filePath);
    if (content !== null) {
      try {
        data = JSON.parse(content);
      } catch (err) {
        // JSON parse error on an existing file — refuse to overwrite to prevent data loss
        loggers.fileManager.error(
          'JSON parse error, refusing to overwrite potentially corrupt file',
          {
            error: err,
            filePath,
          },
        );
        throw new Error(
          `Corrupt JSON in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const newData = await modifier(data);
    await atomicWriteWithLock(filePath, JSON.stringify(newData, null, 2));
  });
}
