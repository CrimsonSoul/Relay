import { app, dialog } from 'electron';
import { loggers } from '../logger';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import { requestAppRelaunch } from './relaunch';
import { IPC_CHANNELS } from '@shared/ipc';

const REJECTION_WINDOW_MS = 60_000;
const REJECTION_THRESHOLD = 3;

type ErrorHandlerOptions = {
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
  nodeEnv?: string;
};

function shouldAutoRelaunchFatalError(options: ErrorHandlerOptions): boolean {
  return (
    (options.platform ?? process.platform) === 'win32' &&
    (options.isPackaged ?? app.isPackaged) &&
    (options.nodeEnv ?? process.env.NODE_ENV) !== 'test' &&
    process.env.RELAY_DISABLE_FATAL_RELAUNCH !== '1'
  );
}

/** Install global process error handlers (uncaughtException, unhandledRejection). */
export function setupErrorHandlers(options: ErrorHandlerOptions = {}): void {
  let fatalRecoveryStarted = false;

  process.on('uncaughtException', (error) => {
    loggers.main.error('Uncaught Exception', { error: error.message, stack: error.stack });
    if (shouldAutoRelaunchFatalError(options)) {
      if (fatalRecoveryStarted) return;
      fatalRecoveryStarted = true;
      broadcastToAllWindows(IPC_CHANNELS.APP_ERROR_NOTIFICATION, {
        title: 'Relay is restarting',
        message: 'Relay hit a critical background error and will restart automatically.',
      });
      requestAppRelaunch('fatal-main-process-error', { exitCode: 1 });
      return;
    }

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

      broadcastToAllWindows(IPC_CHANNELS.APP_ERROR_NOTIFICATION, {
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
