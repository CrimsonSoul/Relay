import { app, dialog } from 'electron';
import { loggers } from '../logger';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';

const REJECTION_WINDOW_MS = 60_000;
const REJECTION_THRESHOLD = 3;

/** Install global process error handlers (uncaughtException, unhandledRejection). */
export function setupErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    loggers.main.error('Uncaught Exception', { error: error.message, stack: error.stack });
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Uncaught Exception',
      message: `Relay encountered a critical error:\n\n${error.message}`,
      buttons: ['Quit', 'Continue'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) {
      app.quit();
    } else {
      loggers.main.warn('User chose to continue after uncaught exception', {
        error: error.message,
      });
    }
  });

  const rejectionTimestamps: number[] = [];

  process.on('unhandledRejection', (reason: unknown) => {
    loggers.main.error('Unhandled Rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });

    const now = Date.now();
    rejectionTimestamps.push(now);

    // Prune timestamps outside the rolling window
    while (rejectionTimestamps.length > 0 && rejectionTimestamps[0] < now - REJECTION_WINDOW_MS) {
      rejectionTimestamps.shift();
    }

    if (rejectionTimestamps.length >= REJECTION_THRESHOLD) {
      // Reset counter to avoid spamming notifications
      rejectionTimestamps.length = 0;

      broadcastToAllWindows('app:error-notification', {
        title: 'Stability Warning',
        message:
          'Multiple background errors detected. The app may be unstable. Consider restarting.',
      });
      loggers.main.warn(
        `Unhandled rejection threshold exceeded (${REJECTION_THRESHOLD} in ${REJECTION_WINDOW_MS / 1000}s) — notified renderer`,
      );
    }
  });
}
