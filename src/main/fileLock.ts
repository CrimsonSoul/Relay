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

import { existsSync } from "fs";
import fs from "fs/promises";
import { loggers } from "./logger";

// Helper to retry operations (kept for robustness against Windows transient errors)
async function retryOperation<T>(
  operation: () => Promise<T>,
  retries = 3,
  baseDelay = 100
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (e) {
      lastError = e;
      await new Promise(resolve => setTimeout(resolve, baseDelay));
    }
  }
  throw lastError;
}

/**
 * No-op lock wrapper. 
 * Formerly provided cross-process locking, now just executes the callback.
 * Kept for API compatibility with existing operation modules.
 */
export async function withFileLock<T>(
  filePath: string,
  callback: () => Promise<T>
): Promise<T> {
  // No locking, just run the callback
  return callback();
}

/**
 * Always returns false as we are not using locks.
 */
export async function isFileLocked(_filePath: string): Promise<boolean> {
  return false;
}

/**
 * Atomic write using temp file and rename.
 * Ensures data integrity by writing to a temp file first, then renaming it.
 */
export async function atomicWriteWithLock(
  filePath: string,
  content: string
): Promise<void> {
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2)}.tmp`;
  try {
    // Write temp file
    await fs.writeFile(tempPath, content, "utf-8");
    
    // Atomic rename with robust retry for Windows/OneDrive latency
    await retryOperation(() => fs.rename(tempPath, filePath));
  } catch (error) {
    loggers.fileManager.error(`[FileLock] Atomic write failed:`, { error, filePath });
    // Try to clean up temp file if rename failed
    try { if (existsSync(tempPath)) await fs.unlink(tempPath); } catch (_e) {
      loggers.fileManager.debug(`[FileLock] Temp file cleanup failed (likely already gone): ${tempPath}`);
    }
    throw error;
  }
}

/**
 * Simple read without locking overhead.
 */
export async function readWithLock(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return await retryOperation(() => fs.readFile(filePath, "utf-8"));
  } catch (error) {
    loggers.fileManager.error(`[FileLock] Read failed:`, { error, filePath });
    return null;
  }
}

/**
 * Read-modify-write pattern without locking.
 */
export async function modifyWithLock(
  filePath: string,
  modifier: (content: string) => Promise<string> | string
): Promise<void> {
  let content = "";
  if (existsSync(filePath)) {
    content = await readWithLock(filePath) || "";
  }
  
  const newContent = await modifier(content);
  await atomicWriteWithLock(filePath, newContent);
}

/**
 * JSON-specific read-modify-write without locking.
 */
export async function modifyJsonWithLock<T>(
  filePath: string,
  modifier: (data: T) => Promise<T> | T,
  defaultValue: T
): Promise<void> {
  let data: T = defaultValue;
  
  if (existsSync(filePath)) {
    try {
      const content = await readWithLock(filePath);
      if (content) {
        data = JSON.parse(content);
      }
    } catch (err) {
      loggers.fileManager.error(`[FileLock] JSON parse error, starting fresh`, { error: err, filePath });
      data = defaultValue; 
    }
  }
  
  const newData = await modifier(data);
  await atomicWriteWithLock(filePath, JSON.stringify(newData, null, 2));
}
