import { app, dialog } from 'electron';
import { loggers } from '../logger';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';

const REJECTION_WINDOW_MS = 60_000;
const REJECTION_THRESHOLD = 3;
const FATAL_RELAUNCH_DELAY_MS = 1_000;

type ErrorHandlerOptions = {
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
  nodeEnv?: string;
  relaunchDelayMs?: number;
};

function shouldAutoRelaunchFatalError(options: ErrorHandlerOptions): boolean {
  return (
    (options.platform ?? process.platform) === 'win32' &&
    (options.isPackaged ?? app.isPackaged) &&
    (options.nodeEnv ?? process.env.NODE_ENV) !== 'test' &&
    process.env.RELAY_DISABLE_FATAL_RELAUNCH !== '1'
  );
}

function scheduleFatalRelaunch(options: ErrorHandlerOptions): void {
  const relaunch = () => {
    app.relaunch();
    app.exit(1);
  };

  const delayMs = options.relaunchDelayMs ?? FATAL_RELAUNCH_DELAY_MS;
  if (delayMs <= 0) {
    relaunch();
    return;
  }

  const timer = setTimeout(relaunch, delayMs);
  timer.unref();
}

/** Install global process error handlers (uncaughtException, unhandledRejection). */
export function setupErrorHandlers(options: ErrorHandlerOptions = {}): void {
  let fatalRecoveryStarted = false;

  process.on('uncaughtException', (error) => {
    loggers.main.error('Uncaught Exception', { error: error.message, stack: error.stack });
    if (shouldAutoRelaunchFatalError(options)) {
      if (fatalRecoveryStarted) return;
      fatalRecoveryStarted = true;
      broadcastToAllWindows('app:error-notification', {
        title: 'Relay is restarting',
        message: 'Relay hit a critical background error and will restart automatically.',
      });
      scheduleFatalRelaunch(options);
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
