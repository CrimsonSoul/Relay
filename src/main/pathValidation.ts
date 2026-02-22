import fsPromises from 'node:fs/promises';
import { join, normalize, resolve, relative, isAbsolute } from 'node:path';
import { app } from 'electron';
import { loggers } from './logger';
import { ErrorCategory } from '@shared/logging';
import { isNodeError } from '@shared/types';

export interface ValidationResult {
  success: boolean;
  error?: string;
}

function isWithinDirectory(parentDir: string, targetPath: string): boolean {
  const relativePath = relative(resolve(parentDir), resolve(targetPath));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function handleVerificationError(error: unknown): ValidationResult {
  const errorCode = isNodeError(error) ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);

  loggers.fileManager.error('Path validation failed', {
    errorCode,
    category: ErrorCategory.FILE_SYSTEM,
  });

  if (errorCode === 'EACCES' || errorCode === 'EPERM') {
    return {
      success: false,
      error: 'Write permission denied. Please choose a different folder.',
    };
  }
  if (errorCode === 'EROFS') {
    return { success: false, error: 'The selected folder is on a read-only file system.' };
  }
  return { success: false, error: `Invalid folder: ${message}` };
}

async function verifyFileSystemAccess(resolvedPath: string): Promise<ValidationResult> {
  try {
    // 1. Check if we can access the path (exists or can be created)
    try {
      await fsPromises.access(resolvedPath);
    } catch {
      // Path doesn't exist, try creating it to see if we have permissions
      await fsPromises.mkdir(resolvedPath, { recursive: true });
    }

    // 2. Check for write permissions by attempting to write a test file
    const testFile = join(resolvedPath, '.perm-check');
    await fsPromises.writeFile(testFile, 'test');
    try {
      await fsPromises.unlink(testFile);
    } catch {
      // Best-effort cleanup
    }

    return { success: true };
  } catch (error: unknown) {
    return handleVerificationError(error);
  }
}

export async function validateDataPath(path: string): Promise<ValidationResult> {
  if (!path) {
    return { success: false, error: 'Path is empty.' };
  }

  // Reject path traversal attempts
  const normalized = normalize(path);
  if (normalized.includes('..')) {
    return { success: false, error: 'Path traversal is not allowed.' };
  }

  // Ensure path is absolute
  if (!isAbsolute(normalized)) {
    return { success: false, error: 'Path must be absolute.' };
  }

  // Ensure path is within a reasonable parent (user home or app data)
  const userDataDir = app.getPath('userData');
  const homeDir = app.getPath('home');
  const resolvedPath = resolve(normalized);
  if (!isWithinDirectory(homeDir, resolvedPath) && !isWithinDirectory(userDataDir, resolvedPath)) {
    return { success: false, error: 'Path must be within user home directory.' };
  }

  return verifyFileSystemAccess(resolvedPath);
}
