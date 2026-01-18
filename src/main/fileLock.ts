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
  stale: 30000,      // Consider lock stale after 30 seconds
  retries: {
    retries: 20,     // Retry up to 20 times for high contention/CI environments
    minTimeout: 100, // Start with 100ms delay
    maxTimeout: 3000, // Max 3 seconds between retries
    factor: 1.1,     // Gentler exponential backoff
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
 * Helper to retry an async operation with backoff for OneDrive/Network latency
 */
async function retryOperation<T>(
  operation: () => Promise<T>,
  retries = 10,
  baseDelay = 100
): Promise<T> {
  let lastError: unknown;
  
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (e) {
      lastError = e;
      const isLockError = e instanceof Error && ['EACCES', 'EPERM', 'EBUSY', 'ENOENT'].includes((e as NodeJS.ErrnoException).code || '');
      
      if (!isLockError) throw e;
      
      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(1.5, i) + Math.random() * 50;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Atomic write with cross-process locking
 */
export async function atomicWriteWithLock(
  filePath: string,
  content: string
): Promise<void> {
  await withFileLock(filePath, async () => {
    const tempPath = `${filePath}.tmp`;
    
    // Write temp file
    await retryOperation(async () => await fs.writeFile(tempPath, content, "utf-8"));
    
    // Atomic rename with robust retry
    try {
      await retryOperation(async () => await fs.rename(tempPath, filePath));
    } catch (_e) {
      // Last resort fallback
      try {
        await fs.copyFile(tempPath, filePath);
        await fs.unlink(tempPath);
      } catch (fallbackError) {
         if (!(fallbackError instanceof Error) || (fallbackError as NodeJS.ErrnoException).code !== 'ENOENT') {
           loggers.fileManager.error(`[FileLock] Atomic write fallback failed:`, { error: fallbackError });
           throw fallbackError;
         }
      }
    }
  });
}

/**
 * Read file with lock to ensure consistent reads during concurrent writes
 */
export async function readWithLock(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  return withFileLock(filePath, async () => {
    return retryOperation(async () => {
      return await fs.readFile(filePath, "utf-8");
    });
  });
}

/**
 * Read-modify-write pattern with locking
 */
export async function modifyWithLock(
  filePath: string,
  modifier: (content: string) => Promise<string> | string
): Promise<void> {
  await withFileLock(filePath, async () => {
    // Robust read with retry
    let content = "";
    if (existsSync(filePath)) {
      try {
        content = await retryOperation(async () => await fs.readFile(filePath, "utf-8"));
      } catch (err) {
        loggers.fileManager.error(`[FileLock] Read failed after retries: ${filePath}`, { error: err });
        throw err;
      }
    }
    
    const newContent = await modifier(content);
    const tempPath = `${filePath}.tmp`;
    
    // Write temp file (usually safe, but good to retry)
    await retryOperation(async () => await fs.writeFile(tempPath, newContent, "utf-8"));
    
    // Atomic rename with robust retry
    try {
      await retryOperation(async () => await fs.rename(tempPath, filePath));
    } catch (_e) {
      // Last resort fallback
      try {
        await fs.copyFile(tempPath, filePath);
        await fs.unlink(tempPath);
      } catch (fallbackError) {
         if (!(fallbackError instanceof Error) || (fallbackError as NodeJS.ErrnoException).code !== 'ENOENT') {
           loggers.fileManager.error(`[FileLock] Atomic write fallback failed:`, { error: fallbackError });
           throw fallbackError;
         }
      }
    }
  });
}

/**
 * JSON-specific read-modify-write with locking
 */
export async function modifyJsonWithLock<T>(
  filePath: string,
  modifier: (data: T) => Promise<T> | T,
  defaultValue: T
): Promise<void> {
  await withFileLock(filePath, async () => {
    let data: T = defaultValue;
    let fileExisted = existsSync(filePath);
    
    if (fileExisted) {
      try {
        const content = await retryOperation(async () => await fs.readFile(filePath, "utf-8"));
        data = JSON.parse(content);
      } catch (err) {
        if (err instanceof SyntaxError) {
           loggers.fileManager.error(`[FileLock] JSON syntax error, starting fresh`, { error: err });
           data = defaultValue; 
        } else {
           loggers.fileManager.error(`[FileLock] Failed to read existing JSON after retries:`, { error: err });
           throw err; // Abort
        }
      }
    }
    
    const newData = await modifier(data);
    const tempPath = `${filePath}.tmp`;
    
    await retryOperation(async () => await fs.writeFile(tempPath, JSON.stringify(newData, null, 2), "utf-8"));
    
    // Atomic rename with robust retry
    try {
      await retryOperation(async () => await fs.rename(tempPath, filePath));
    } catch (_e) {
      // Last resort fallback
      try {
        await fs.copyFile(tempPath, filePath);
        await fs.unlink(tempPath);
      } catch (fallbackError) {
         if (!(fallbackError instanceof Error) || (fallbackError as NodeJS.ErrnoException).code !== 'ENOENT') {
           loggers.fileManager.error(`[FileLock] Atomic write fallback failed:`, { error: fallbackError });
           throw fallbackError;
         }
      }
    }
  });
}
