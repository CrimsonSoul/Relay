import { app, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import {
  compareRelayVersions,
  RELAY_RELEASES_URL,
  type RelayUpdateCheck,
  type RelayUpdateSnapshot,
} from '@shared/releases';
import { loggers } from '../logger';
import { rateLimiters } from '../rateLimiter';
import { shouldSuppressDesktopSideEffects } from '../app/e2eSafety';
import { getAppConfig } from '../app/appState';
import { requestAppRelaunch } from '../app/relaunch';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import { assertTrustedIpcSender } from '../utils/trustedSender';
import type { RelayInstallableRelease } from '../releases/ReleaseUpdateService';
import type { PrepareRecoveryRestartResult } from '../releases/RecoveryRestartCoordinator';
import type { ReleaseNotesProvider } from './releaseNotesHandlers';

type ReleaseUpdateChecker = ReleaseNotesProvider & {
  check: () => Promise<RelayUpdateCheck>;
};

type InstallableReleaseResolver = {
  resolveLatestInstallable: () => Promise<RelayInstallableRelease>;
};

type ReleaseUpdateController = {
  snapshot: () => RelayUpdateSnapshot;
  readySnapshot: () => Promise<RelayUpdateSnapshot>;
  subscribe: (listener: (snapshot: RelayUpdateSnapshot) => void) => () => void;
  noteCheck: (check: RelayUpdateCheck) => Promise<RelayUpdateSnapshot>;
  download: () => Promise<RelayUpdateSnapshot>;
  cancelDownload: () => Promise<RelayUpdateSnapshot>;
  install: () => Promise<RelayUpdateSnapshot>;
  restart: () => Promise<boolean>;
};

type ReleaseUpdateHandlerOptions = {
  service?: ReleaseUpdateChecker;
  manager?: ReleaseUpdateController;
};

function isInstallableReleaseResolver(
  service: ReleaseUpdateChecker,
): service is ReleaseUpdateChecker & InstallableReleaseResolver {
  return (
    'resolveLatestInstallable' in service && typeof service.resolveLatestInstallable === 'function'
  );
}

function authoritativeCheck(
  check: RelayUpdateCheck,
  snapshot: RelayUpdateSnapshot,
): RelayUpdateCheck {
  if (!snapshot.latestVersion) return check;
  const versionsMatch = snapshot.latestVersion === check.latestVersion;
  const targetCommitish = versionsMatch ? check.targetCommitish : null;
  return {
    currentVersion: snapshot.currentVersion,
    latestVersion: snapshot.latestVersion,
    targetCommitish,
    updateAvailable: true,
    installable: snapshot.installable && versionsMatch,
    assetSizeBytes: snapshot.totalBytes,
    releaseNotes: versionsMatch ? check.releaseNotes : null,
  };
}

async function prepareProductionRecoveryRestart(
  transactionId: string,
): Promise<PrepareRecoveryRestartResult> {
  const recovery = await import('../releases/productionRecoveryRestart');
  return recovery.prepareProductionRecoveryRestart(transactionId);
}

export function setupReleaseUpdateHandlers(options: ReleaseUpdateHandlerOptions = {}): void {
  const warn = loggers.main.warn.bind(loggers.main);
  let servicePromise: Promise<ReleaseUpdateChecker> | null = options.service
    ? Promise.resolve(options.service)
    : null;
  const getService = () => {
    servicePromise ??= import('../releases/ReleaseUpdateService').then(
      ({ ReleaseUpdateService }) =>
        new ReleaseUpdateService({
          getCurrentVersion: () => app.getVersion(),
          cacheFilePath: join(app.getPath('userData'), 'release-notes.json'),
        }),
    );
    return servicePromise;
  };
  let managerPromise: Promise<ReleaseUpdateController> | null = options.manager
    ? Promise.resolve(options.manager)
    : null;
  let subscribedManager: ReleaseUpdateController | null = null;
  const subscribeManager = (manager: ReleaseUpdateController) => {
    if (subscribedManager === manager) return manager;
    manager.subscribe((snapshot) =>
      broadcastToAllWindows(IPC_CHANNELS.APP_UPDATE_STATE_CHANGED, snapshot),
    );
    subscribedManager = manager;
    return manager;
  };
  const getManager = () => {
    managerPromise ??= Promise.all([getService(), import('../releases/ReleaseUpdateManager')]).then(
      ([service, { ReleaseUpdateManager }]) => {
        if (!isInstallableReleaseResolver(service)) {
          throw new Error('Release update service cannot resolve installable releases');
        }
        return new ReleaseUpdateManager({
          service,
          getCurrentVersion: () => app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          isPackaged: app.isPackaged,
          localAppData: process.env.LOCALAPPDATA ?? '',
          execPath: process.execPath,
          getInstallationMode: () => getAppConfig()?.load()?.mode ?? 'unconfigured',
          prepareRecoveryRestart: prepareProductionRecoveryRestart,
          restartApp: (execPath) => requestAppRelaunch('release-update', { execPath }),
          onInstallDiagnostic: (diagnostic) => warn('Update', diagnostic),
        });
      },
    );
    return managerPromise.then(subscribeManager);
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
        const check = await service.check();
        const manager = await getManager();
        const snapshot = await manager.noteCheck(check);
        return { success: true, data: authoritativeCheck(check, snapshot) };
      } catch (error) {
        warn('GitHub release check unavailable', { error });
        return { success: false, error: 'unavailable' };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.APP_RELEASE_NOTES_GET_CACHED, async (event) =>
    (await import('./releaseNotesHandlers')).getCachedReleaseNotes(event, getService),
  );

  ipcMain.handle(IPC_CHANNELS.APP_RELEASE_NOTES_REFRESH, async (event) =>
    (await import('./releaseNotesHandlers')).refreshReleaseNotes(event, getService),
  );

  ipcMain.handle(
    IPC_CHANNELS.APP_UPDATE_GET_STATE,
    async (event): Promise<RelayUpdateSnapshot | null> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_UPDATE_GET_STATE)) return null;
      try {
        return (await getManager()).readySnapshot();
      } catch (error) {
        warn('Relay update state unavailable', { error });
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.APP_UPDATE_DOWNLOAD,
    async (event): Promise<IpcResult<RelayUpdateSnapshot>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_UPDATE_DOWNLOAD)) {
        return { success: false, error: 'untrusted-sender' };
      }
      if (!rateLimiters.network.tryConsume().allowed) {
        return { success: false, error: 'rate-limited' };
      }

      try {
        const manager = await getManager();
        if (shouldSuppressDesktopSideEffects()) {
          return { success: true, data: manager.snapshot() };
        }
        const snapshot = await manager.download();
        loggers.main.info('Relay update download completed', snapshot);
        return { success: true, data: snapshot };
      } catch (error) {
        warn('Relay update download unavailable', { error });
        return { success: false, error: 'unavailable' };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.APP_UPDATE_CANCEL_DOWNLOAD,
    async (event): Promise<IpcResult<RelayUpdateSnapshot>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_UPDATE_CANCEL_DOWNLOAD)) {
        return { success: false, error: 'untrusted-sender' };
      }
      try {
        const manager = await getManager();
        if (shouldSuppressDesktopSideEffects()) {
          return { success: true, data: manager.snapshot() };
        }
        return { success: true, data: await manager.cancelDownload() };
      } catch (error) {
        warn('Relay update cancellation unavailable', { error });
        return { success: false, error: 'unavailable' };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.APP_UPDATE_INSTALL,
    async (event): Promise<IpcResult<RelayUpdateSnapshot>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_UPDATE_INSTALL)) {
        return { success: false, error: 'untrusted-sender' };
      }
      if (!rateLimiters.fsOperations.tryConsume().allowed) {
        return { success: false, error: 'rate-limited' };
      }

      try {
        const manager = await getManager();
        if (shouldSuppressDesktopSideEffects()) {
          return { success: true, data: manager.snapshot() };
        }
        const snapshot = await manager.install();
        loggers.main.info('Relay update installation completed', snapshot);
        return { success: true, data: snapshot };
      } catch (error) {
        warn('Relay update installation unavailable', { error });
        return { success: false, error: 'unavailable' };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.APP_UPDATE_RESTART, async (event): Promise<IpcResult<boolean>> => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_UPDATE_RESTART)) {
      return { success: false, error: 'untrusted-sender' };
    }
    if (!rateLimiters.fsOperations.tryConsume().allowed) {
      return { success: false, error: 'rate-limited', rateLimited: true };
    }
    if (shouldSuppressDesktopSideEffects()) return { success: true, data: true };
    try {
      return { success: true, data: await (await getManager()).restart() };
    } catch (error) {
      warn('Relay update restart unavailable', { error });
      return { success: false, error: 'unavailable' };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.APP_OPEN_RELEASES,
    async (event, version?: unknown): Promise<boolean> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_OPEN_RELEASES)) return false;
      if (!rateLimiters.fsOperations.tryConsume().allowed) return false;
      let releaseUrl = RELAY_RELEASES_URL;
      if (version !== undefined) {
        if (typeof version !== 'string' || compareRelayVersions(version, version) === null) {
          return false;
        }
        releaseUrl = `${RELAY_RELEASES_URL}/tag/v${version}`;
      }
      if (shouldSuppressDesktopSideEffects()) return true;

      try {
        await shell.openExternal(releaseUrl);
        return true;
      } catch (error) {
        loggers.security.error('Could not open the Relay releases page', { error });
        return false;
      }
    },
  );
}
