import { loggers } from '../logger';
import { FileManager } from '../FileManager';

// Constants for maintenance intervals
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const INITIAL_MEMORY_CHECK_DELAY_MS = 60000; // 1 minute
const MB_DIVISOR = 1024 * 1024; // Bytes to MB conversion

interface GlobalWithGC {
  gc?: () => void;
}

/**
 * Sets up periodic maintenance tasks for the application.
 * Includes memory monitoring, garbage collection, and backup operations.
 * 
 * @param getFileManager - Function to retrieve the current FileManager instance
 */
export function setupMaintenanceTasks(getFileManager: () => FileManager | null) {
  // Periodic maintenance task (runs every 24 hours)
  setInterval(() => {
    loggers.main.info('Running periodic maintenance...');

    const memory = process.memoryUsage();
    loggers.main.info('Memory Stats:', {
      rss: `${Math.round(memory.rss / MB_DIVISOR)}MB`,
      heapTotal: `${Math.round(memory.heapTotal / MB_DIVISOR)}MB`,
      heapUsed: `${Math.round(memory.heapUsed / MB_DIVISOR)}MB`,
      external: `${Math.round(memory.external / MB_DIVISOR)}MB`
    });

    if ((global as GlobalWithGC).gc) {
      try {
        (global as GlobalWithGC).gc();
        loggers.main.info('Triggered manual garbage collection');
      } catch (e) {
        loggers.main.warn('Failed to trigger manual GC', { error: e });
      }
    }

    const fileManager = getFileManager();
    if (fileManager) {
      ((fileManager as unknown as Record<string, unknown>).performBackup as unknown)();
    }
  }, MAINTENANCE_INTERVAL_MS);

  // Initial maintenance check after 1 minute
  setTimeout(() => {
    const memory = process.memoryUsage();
    loggers.main.info('Startup Memory Stats:', {
      rss: `${Math.round(memory.rss / MB_DIVISOR)}MB`,
      heapUsed: `${Math.round(memory.heapUsed / MB_DIVISOR)}MB`
    });
  }, INITIAL_MEMORY_CHECK_DELAY_MS);
}
