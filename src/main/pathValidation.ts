import fs from 'fs';
import { join } from 'path';
import { loggers, ErrorCategory } from './logger';

export interface ValidationResult {
    success: boolean;
    error?: string;
}

/**
 * Validates that a data path is accessible and writable.
 * Performs checks asynchronously to avoid blocking the main thread.
 * 
 * @param path - The file system path to validate
 * @returns A promise resolving to validation result with success status and optional error message
 */
export async function validateDataPath(path: string): Promise<ValidationResult> {
    if (!path) {
        return { success: false, error: 'Path is empty.' };
    }

    try {
        // 1. Check if path exists, create if it doesn't
        try {
            await fs.promises.access(path);
        } catch (accessError) {
            // Path doesn't exist - check error type
            const isNodeError = (err: unknown): err is NodeJS.ErrnoException => {
                return typeof err === 'object' && err !== null && 'code' in err;
            };
            
            // Only try to create if it's a "not found" error
            if (isNodeError(accessError) && accessError.code === 'ENOENT') {
                await fs.promises.mkdir(path, { recursive: true });
            } else {
                // Re-throw other errors (e.g., permission denied on parent directory)
                throw accessError;
            }
        }

        // 2. Check for write permissions by attempting to write a test file
        const testFile = join(path, '.perm-check');
        await fs.promises.writeFile(testFile, 'test');
        await fs.promises.unlink(testFile);

        return { success: true };
    } catch (error: unknown) {
        // Type guard for Node.js error with code property
        const isNodeError = (err: unknown): err is NodeJS.ErrnoException => {
            return typeof err === 'object' && err !== null && 'code' in err;
        };

        const errorCode = isNodeError(error) ? error.code : undefined;
        const message = error instanceof Error ? error.message : String(error);

        loggers.fileManager.error('Path validation failed', {
            errorCode,
            category: ErrorCategory.FILE_SYSTEM,
        });

        if (errorCode === 'EACCES' || errorCode === 'EPERM') {
            return { success: false, error: 'Write permission denied. Please choose a different folder.' };
        }
        if (errorCode === 'EROFS') {
            return { success: false, error: 'The selected folder is on a read-only file system.' };
        }
        return { success: false, error: `Invalid folder: ${message}` };
    }
}
