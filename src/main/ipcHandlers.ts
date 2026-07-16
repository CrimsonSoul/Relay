import { BrowserWindow, ipcMain } from 'electron';
import type PocketBase from 'pocketbase';
import { setupCloudStatusHandlers } from './handlers/cloudStatus';
import { setupWindowHandlers } from './handlers/windowHandlers';
import { setupSetupHandlers } from './handlers/setupHandlers';
import { setupCacheHandlers } from './handlers/cacheHandlers';
import { setupOfflineMutationHandlers } from './handlers/offlineMutationHandlers';
import { setupBackupHandlers } from './handlers/backupHandlers';
import { setupDynatraceHandlers } from './handlers/dynatraceHandlers';
import { setupDynatraceProblemsHandlers } from './handlers/dynatraceProblemsHandlers';
import { setupRelayOperatorHandlers } from './handlers/relayOperatorHandlers';
import { setupKnowledgeHandlers } from './handlers/knowledgeHandlers';
import {
  setupPrivilegedAccessHandlers,
  type PrivilegedAccessRuntime,
} from './handlers/privilegedAccessHandlers';
import type { AppConfig } from './config/AppConfig';
import type { OfflineCache } from './cache/OfflineCache';
import type { PendingChanges } from './cache/PendingChanges';
import type { SyncManager } from './cache/SyncManager';
import type { BackupManager } from './pocketbase/BackupManager';
import type { DynatraceWindowManager } from './dynatrace/DynatraceWindowManager';
import type { DynatraceProblemsManager } from './dynatrace/DynatraceProblemsManager';
import { KnowledgeIndexStatusService } from './knowledge/KnowledgeIndexStatusService';
import type { KnowledgePdfService } from './knowledge/KnowledgePdfService';
import { KnowledgeUploadService } from './knowledge/KnowledgeUploadService';
import { loggers } from './logger';
import { getErrorMessage } from '@shared/types';
import { assertTrustedIpcSender } from './utils/trustedSender';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import { PrivilegedAccountManager } from './privileged/PrivilegedAccountManager';
import { IPC_CHANNELS } from '@shared/ipc';

/**
 * Orchestrates all IPC handlers for the application.
 * Each handler group is wrapped in try/catch to prevent a single failure
 * from leaving all subsequent handlers unregistered.
 */
export function setupIpcHandlers(opts: {
  getMainWindow: () => BrowserWindow | null;
  getDataRoot: () => Promise<string>;
  createAuxWindow?: (route: string) => void;
  getAppConfig?: () => AppConfig | null;
  getCache?: () => OfflineCache | null;
  getPendingChanges?: () => PendingChanges | null;
  getSyncManager?: () => SyncManager | null;
  getBackupManager?: () => BackupManager | null;
  getDynatraceWindowManager?: () => DynatraceWindowManager | null;
  getDynatraceProblemsManager?: () => DynatraceProblemsManager | null;
  getPbClient?: () => PocketBase | null;
  getKnowledgePdfService?: () => KnowledgePdfService | null;
  getPrivilegedRuntime?: () => PrivilegedAccessRuntime | null;
  subscribePrivilegedSessionChanged?: (
    listener: (view: PrivilegedSessionView) => void,
  ) => () => void;
  restartPb?: () => Promise<boolean>;
}) {
  const {
    getMainWindow,
    getDataRoot,
    createAuxWindow,
    getAppConfig,
    getCache,
    getPendingChanges,
    getSyncManager,
    getBackupManager,
    getDynatraceWindowManager,
    getDynatraceProblemsManager,
    getPbClient,
    getKnowledgePdfService,
    getPrivilegedRuntime,
    subscribePrivilegedSessionChanged,
    restartPb,
  } = opts;
  const knowledgeIndexStatusService = new KnowledgeIndexStatusService(getPbClient ?? (() => null));
  const safeSetup = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      loggers.main.error(`Failed to setup ${name} handlers`, {
        error: getErrorMessage(err),
      });
    }
  };

  safeSetup('cloudStatus', () => setupCloudStatusHandlers());

  safeSetup('dynatrace', () => setupDynatraceHandlers(getDynatraceWindowManager?.() ?? null));

  safeSetup('dynatraceProblems', () =>
    setupDynatraceProblemsHandlers(
      getDynatraceProblemsManager ?? (() => null),
      getAppConfig ?? (() => null),
    ),
  );

  safeSetup('relayOperators', () =>
    setupRelayOperatorHandlers({
      ipcMain,
      isServer: () => getAppConfig?.()?.load()?.mode === 'server',
      getPbClient: getPbClient ?? (() => null),
      assertTrustedIpcSender,
    }),
  );

  safeSetup('knowledge', () =>
    setupKnowledgeHandlers(
      getKnowledgePdfService ?? (() => null),
      () => knowledgeIndexStatusService,
      () =>
        new KnowledgeUploadService({
          getRuntime: () => (getPrivilegedRuntime?.() as never) ?? null,
          emitProgress: (progress) => {
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed()) {
                window.webContents.send(IPC_CHANNELS.KNOWLEDGE_UPLOAD_PROGRESS, progress);
              }
            }
          },
        }),
    ),
  );

  safeSetup('privilegedAccess', () =>
    setupPrivilegedAccessHandlers({
      ipcMain,
      getRuntime: getPrivilegedRuntime ?? (() => null),
      isServer: () => getAppConfig?.()?.load()?.mode === 'server',
      getAccountManager: () => {
        const pb = getPbClient?.();
        if (!pb?.authStore.isValid || pb.authStore.record?.collectionName !== '_superusers') {
          return null;
        }
        return new PrivilegedAccountManager({
          pb,
          onCredentialChanged: (operatorId) => {
            const runtime = getPrivilegedRuntime?.();
            if (runtime?.getView().operatorId === operatorId) runtime.lock();
          },
        });
      },
      assertTrustedIpcSender,
      subscribeSessionChanged: subscribePrivilegedSessionChanged,
    }),
  );

  // Window Management
  safeSetup('window', () => setupWindowHandlers(getMainWindow, createAuxWindow, getDataRoot));

  // PocketBase Setup Handlers (always registered — uses getter for lazy access)
  safeSetup('setup', () =>
    setupSetupHandlers(
      getAppConfig ?? (() => null),
      getCache ?? (() => null),
      getPendingChanges ?? (() => null),
    ),
  );

  // Offline Cache Handlers (always registered — getters return null when not in client mode)
  safeSetup('cache', () =>
    setupCacheHandlers(
      getCache ?? (() => null),
      getPendingChanges ?? (() => null),
      getSyncManager ?? (() => null),
      getAppConfig ?? (() => null),
    ),
  );

  safeSetup('offlineMutations', () =>
    setupOfflineMutationHandlers(
      getCache ?? (() => null),
      getPendingChanges ?? (() => null),
      getAppConfig ?? (() => null),
    ),
  );

  // Backup Management
  safeSetup('backup', () =>
    setupBackupHandlers(
      getBackupManager ?? (() => null),
      restartPb ?? (() => Promise.resolve(false)),
      getCache ?? (() => null),
    ),
  );
}
