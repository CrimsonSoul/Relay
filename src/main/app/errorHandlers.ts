import { app, dialog } from 'electron';
import { loggers } from '../logger';

/** Install global process error handlers (uncaughtException, unhandledRejection). */
export function setupErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    loggers.main.error('Uncaught Exception', { error: error.message, stack: error.stack });
    dialog.showErrorBox('Startup Error', `Relay encountered a critical error:\n\n${error.message}`);
    app.quit();
  });

  process.on('unhandledRejection', (reason: unknown) => {
    loggers.main.error('Unhandled Rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
}
