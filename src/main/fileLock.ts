/**
 * Cross-process file locking utility using proper-lockfile
 * 
 * Provides production-ready file locking for multi-instance synchronization.
 * Uses OS-level locks to ensure only one process can write to a file at a time.
 */

import lockfile from "proper-lockfile";
import { existsSync } from "fs";
import fs from "fs/promises";
import { loggers } from "./logger";

// Lock options for production use
const LOCK_OPTIONS = {
  stale: 10000,      // Consider lock stale after 10 seconds (in case of crash)
  retries: {
    retries: 15,     // Retry up to 15 times for heavy contention
    minTimeout: 50,  // Start with 50ms delay
    maxTimeout: 2000, // Max 2 seconds between retries
    factor: 1.5,     // Gentler exponential backoff
  },
  realpath: false,   // Don't resolve symlinks (faster)
};

/**
 * Execute a callback while holding an exclusive lock on a file.
 * The lock is automatically released when the callback completes (or throws).
 * 
 * @param filePath - Path to the file to lock
 * @param callback - Async function to execute while holding the lock
 * @returns The result of the callback
 */
export async function withFileLock<T>(
  filePath: string,
  callback: () => Promise<T>
): Promise<T> {
  // Use a separate lock file to avoid EPERM on Windows when renaming the data file
  // This decouples the lock from the actual file being written/renamed
  const lockTarget = `${filePath}.lock`;

  // Ensure lock target exists before locking (proper-lockfile requires this)
  if (!existsSync(lockTarget)) {
    try {
      await fs.writeFile(lockTarget, "", "utf-8");
    } catch {
      // File may have been created by another process, continue
    }
  }

  let release: (() => Promise<void>) | null = null;

  try {
    // Acquire lock on the sidecar file
    release = await lockfile.lock(lockTarget, LOCK_OPTIONS);
    loggers.fileManager.debug(`[FileLock] Acquired lock: ${lockTarget} for ${filePath}`);

    // Execute callback
    const result = await callback();

    return result;
  } catch (error) {
    // Check if it's a lock contention error
    if (error instanceof Error && error.message.includes("ELOCKED")) {
      loggers.fileManager.warn(`[FileLock] Lock contention on ${lockTarget}, retrying...`);
    } else {
      loggers.fileManager.error(`[FileLock] Error during locked operation:`, { error, filePath });
    }
    throw error;
  } finally {
    // Always release lock
    if (release) {
      try {
        await release();
        loggers.fileManager.debug(`[FileLock] Released lock: ${lockTarget}`);
      } catch (releaseError) {
        loggers.fileManager.error(`[FileLock] Error releasing lock:`, { error: releaseError, filePath });
      }
    }
  }
}

/**
 * Check if a file is currently locked by another process
 * 
 * @param filePath - Path to check
 * @returns true if locked, false otherwise
 */
export async function isFileLocked(filePath: string): Promise<boolean> {
  const lockTarget = `${filePath}.lock`;
  if (!existsSync(lockTarget)) {
    return false;
  }

  try {
    const locked = await lockfile.check(lockTarget, { realpath: false });
    return locked;
  } catch {
    return false;
  }
}

/**
 * Atomic write with cross-process locking
 * 
 * This is the primary function for writing data files safely.
 * It acquires a lock, writes to a temp file, then renames atomically.
 * 
 * @param filePath - Path to the file to write
 * @param content - Content to write
 */
export async function atomicWriteWithLock(
  filePath: string,
  content: string
): Promise<void> {
  await withFileLock(filePath, async () => {
    const tempPath = `${filePath}.tmp`;
    
    // Write to temp file
    await fs.writeFile(tempPath, content, "utf-8");
    
    // Atomic rename
    try {
      await fs.rename(tempPath, filePath);
    } catch (e: any) {
      if (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'ENOENT') {
        // Retry logic for Windows file system locking issues
        // ENOENT might happen if the file was deleted externally while we were writing
        if (e.code === 'ENOENT' && !existsSync(tempPath)) {
           // If temp path is gone, nothing we can do, abort
           return;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
        try {
          await fs.rename(tempPath, filePath);
          return;
        } catch (retryError) {
          // Fallback: Try copy and delete if rename fails repeatedly
          try {
            await fs.copyFile(tempPath, filePath);
            await fs.unlink(tempPath);
          } catch (fallbackError: any) {
            // Ignore if files are gone (e.g. during app shutdown or test cleanup)
            if (fallbackError.code !== 'ENOENT') {
              loggers.fileManager.error(`[FileLock] Atomic write fallback failed:`, { error: fallbackError });
              throw fallbackError;
            }
          }
          return;
        }
      }
      throw e;
    }
  });
}

/**
 * Read file with lock to ensure consistent reads during concurrent writes
 * 
 * @param filePath - Path to read
 * @returns File contents, or null if file doesn't exist
 */
export async function readWithLock(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  return withFileLock(filePath, async () => {
    return fs.readFile(filePath, "utf-8").catch(async (err: any) => {
      // Retry read on EPERM/EACCES (common on Windows during rapid writes)
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        await new Promise(resolve => setTimeout(resolve, 50));
        return fs.readFile(filePath, "utf-8");
      }
      throw err;
    });
  });
}

/**
 * Read-modify-write pattern with locking
 * 
 * Safely reads a file, applies a transformation, and writes back.
 * The entire operation is atomic with respect to other processes.
 * 
 * @param filePath - Path to the file
 * @param modifier - Function that transforms the content
 */
export async function modifyWithLock(
  filePath: string,
  modifier: (content: string) => Promise<string> | string
): Promise<void> {
  await withFileLock(filePath, async () => {
    let content = "";
    
    if (existsSync(filePath)) {
      content = await fs.readFile(filePath, "utf-8");
    }
    
    const newContent = await modifier(content);
    const tempPath = `${filePath}.tmp`;
    
    await fs.writeFile(tempPath, newContent, "utf-8");
    
    // Atomic rename with retry
    try {
      await fs.rename(tempPath, filePath);
    } catch (e: any) {
      if (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'ENOENT') {
        // Retry logic for Windows file system locking issues
        if (e.code === 'ENOENT' && !existsSync(tempPath)) return;

        await new Promise(resolve => setTimeout(resolve, 100));
        try {
          await fs.rename(tempPath, filePath);
          return;
        } catch (retryError) {
          try {
            await fs.copyFile(tempPath, filePath);
            await fs.unlink(tempPath);
          } catch (fallbackError: any) {
             if (fallbackError.code !== 'ENOENT') {
               loggers.fileManager.error(`[FileLock] Atomic write fallback failed:`, { error: fallbackError });
               throw fallbackError;
             }
          }
          return;
        }
      }
      throw e;
    }
  });
}

/**
 * JSON-specific read-modify-write with locking
 * 
 * @param filePath - Path to the JSON file
 * @param modifier - Function that transforms the parsed JSON
 * @param defaultValue - Default value if file doesn't exist
 */
export async function modifyJsonWithLock<T>(
  filePath: string,
  modifier: (data: T) => Promise<T> | T,
  defaultValue: T
): Promise<void> {
  await withFileLock(filePath, async () => {
    let data: T = defaultValue;
    
    if (existsSync(filePath)) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        data = JSON.parse(content);
      } catch {
        data = defaultValue;
      }
    }
    
    const newData = await modifier(data);
    const tempPath = `${filePath}.tmp`;
    
    await fs.writeFile(tempPath, JSON.stringify(newData, null, 2), "utf-8");
    
    // Atomic rename with retry
    try {
      await fs.rename(tempPath, filePath);
    } catch (e: any) {
      if (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'ENOENT') {
        // Retry logic for Windows file system locking issues
        if (e.code === 'ENOENT' && !existsSync(tempPath)) return;

        await new Promise(resolve => setTimeout(resolve, 100));
        try {
          await fs.rename(tempPath, filePath);
          return;
        } catch (retryError) {
          try {
            await fs.copyFile(tempPath, filePath);
            await fs.unlink(tempPath);
          } catch (fallbackError: any) {
             if (fallbackError.code !== 'ENOENT') {
               loggers.fileManager.error(`[FileLock] Atomic write fallback failed:`, { error: fallbackError });
               throw fallbackError;
             }
          }
          return;
        }
      }
      throw e;
    }
  });
}
