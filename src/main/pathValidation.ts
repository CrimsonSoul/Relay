import fs from 'fs';
import { join } from 'path';
import { loggers } from './logger';
import { ErrorCategory } from '@shared/logging';
import { isNodeError } from '@shared/types';

export interface ValidationResult {
    success: boolean;
    error?: string;
}

export function validateDataPath(path: string): ValidationResult {
    if (!path) {
        return { success: false, error: 'Path is empty.' };
    }

    try {
        // 1. Check if we can access the path (exists or can be created)
        if (!fs.existsSync(path)) {
            // Try creating it to see if we have permissions
            fs.mkdirSync(path, { recursive: true });
        }

        // 2. Check for write permissions by attempting to write a test file
        const testFile = join(path, '.perm-check');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);

        return { success: true };
    } catch (error: unknown) {
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
