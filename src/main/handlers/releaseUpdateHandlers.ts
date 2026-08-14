import { app, ipcMain, shell } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import { RELAY_RELEASES_URL, type RelayUpdateCheck } from '@shared/releases';
import { loggers } from '../logger';
import { rateLimiters } from '../rateLimiter';
import { shouldSuppressDesktopSideEffects } from '../app/e2eSafety';
import { assertTrustedIpcSender } from '../utils/trustedSender';

type ReleaseUpdateChecker = {
  check: () => Promise<RelayUpdateCheck>;
};

type ReleaseUpdateHandlerOptions = {
  service?: ReleaseUpdateChecker;
};

export function setupReleaseUpdateHandlers(options: ReleaseUpdateHandlerOptions = {}): void {
  let servicePromise: Promise<ReleaseUpdateChecker> | null = options.service
    ? Promise.resolve(options.service)
    : null;
  const getService = () => {
    servicePromise ??= import('../releases/ReleaseUpdateService').then(
      ({ ReleaseUpdateService }) =>
        new ReleaseUpdateService({ getCurrentVersion: () => app.getVersion() }),
    );
    return servicePromise;
  };

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, async (event): Promise<string | null> => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_GET_VERSION)) return null;
    return app.getVersion();
  });

  ipcMain.handle(
    IPC_CHANNELS.APP_CHECK_FOR_UPDATES,
    async (event): Promise<IpcResult<RelayUpdateCheck>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_CHECK_FOR_UPDATES)) {
        return { success: false, error: 'untrusted-sender' };
      }
      if (!rateLimiters.network.tryConsume().allowed) {
        return { success: false, error: 'rate-limited' };
      }

      try {
        const service = await getService();
        return { success: true, data: await service.check() };
      } catch (error) {
        loggers.main.warn('GitHub release check unavailable', { error });
        return { success: false, error: 'unavailable' };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_RELEASES, async (event): Promise<boolean> => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_OPEN_RELEASES)) return false;
    if (!rateLimiters.fsOperations.tryConsume().allowed) return false;
    if (shouldSuppressDesktopSideEffects()) return true;

    try {
      await shell.openExternal(RELAY_RELEASES_URL);
      return true;
    } catch (error) {
      loggers.security.error('Could not open the Relay releases page', { error });
      return false;
    }
  });
}
