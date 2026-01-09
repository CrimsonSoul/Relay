import { loggers } from '../logger';
import { FileManager } from '../FileManager';

export function setupMaintenanceTasks(getFileManager: () => FileManager | null) {
  // Periodic maintenance task (runs every 24 hours)
  setInterval(() => {
    loggers.main.info('Running periodic maintenance...');
    
    const memory = process.memoryUsage();
    loggers.main.info('Memory Stats:', {
      rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(memory.external / 1024 / 1024)}MB`
    });

    if ((global as any).gc) {
      try {
        (global as any).gc();
        loggers.main.info('Triggered manual garbage collection');
      } catch (e) {
        loggers.main.warn('Failed to trigger manual GC', { error: e });
      }
    }

    const fileManager = getFileManager();
    if (fileManager) {
      fileManager.performBackup('periodic maintenance');
    }
  }, 24 * 60 * 60 * 1000);

  // Initial maintenance check after 1 minute
  setTimeout(() => {
    const memory = process.memoryUsage();
    loggers.main.info('Startup Memory Stats:', {
      rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`
    });
  }, 60000);
}
