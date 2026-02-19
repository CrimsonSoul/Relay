import { loggers } from '../logger';
import { FileManager } from '../FileManager';

interface GlobalWithGC {
  gc?: () => void;
}

/**
 * Sets up periodic maintenance tasks. Returns a cleanup function
 * that should be called on app shutdown to clear the interval.
 */
export function setupMaintenanceTasks(getFileManager: () => FileManager | null): () => void {
  // Periodic maintenance task (runs every 24 hours)
  const intervalId = setInterval(
    () => {
      loggers.main.info('Running periodic maintenance...');

      const memory = process.memoryUsage();
      loggers.main.info('Memory Stats:', {
        rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(memory.external / 1024 / 1024)}MB`,
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
        void fileManager.performBackup('periodic');
      }
    },
    24 * 60 * 60 * 1000,
  );

  // Initial maintenance check after 1 minute
  const timeoutId = setTimeout(() => {
    const memory = process.memoryUsage();
    loggers.main.info('Startup Memory Stats:', {
      rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
    });
  }, 60000);

  return () => {
    clearInterval(intervalId);
    clearTimeout(timeoutId);
  };
}
