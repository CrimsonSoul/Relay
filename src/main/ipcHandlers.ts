import { ipcMain, type BrowserWindow } from 'electron';
import type PocketBase from 'pocketbase';
import { setupCloudStatusHandlers } from './handlers/cloudStatus';
import { setupRadarHandlers } from './handlers/radar';
import { setupWindowHandlers } from './handlers/windowHandlers';
import { setupSdpAccountHandlers } from './handlers/sdpAccountHandlers';
import { setupReleaseUpdateHandlers } from './handlers/releaseUpdateHandlers';
import { setupSetupHandlers } from './handlers/setupHandlers';
import { setupRelayWebServerHandlers } from './handlers/webServerHandlers';
import { setupCacheHandlers } from './handlers/cacheHandlers';
import { setupOfflineMutationHandlers } from './handlers/offlineMutationHandlers';
import { setupBackupHandlers } from './handlers/backupHandlers';
import { setupDynatraceHandlers } from './handlers/dynatraceHandlers';
import { setupDynatraceProblemsHandlers } from './handlers/dynatraceProblemsHandlers';
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
import type { KnowledgeIndexStatusService } from './knowledge/KnowledgeIndexStatusService';
import type { KnowledgePdfService } from './knowledge/KnowledgePdfService';
import type { KnowledgeCoverService } from './knowledge/KnowledgeCoverService';
import type { KnowledgeUploadService } from './knowledge/KnowledgeUploadService';
import type { KnowledgeSearchService } from './knowledge/KnowledgeSearchService';
import { loggers } from './logger';
import { getErrorMessage } from '@shared/types';
import { assertTrustedIpcSender } from './utils/trustedSender';
import { broadcastToAllWindows } from './utils/broadcastToAllWindows';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import { PrivilegedAccountManager } from './privileged/PrivilegedAccountManager';
import type { RelayWebServerManager } from './web/RelayWebServerManager';
import type { WebApprovalCodeStore } from './web/WebApprovalCodeStore';
import { IPC_CHANNELS, type PrivilegedApprovalRequestView } from '@shared/ipc';
import { setupWorkstationAwakeHandlers } from './handlers/workstationAwakeHandlers';
import type { WorkstationAwakeService } from './power/WorkstationAwakeService';

/**
 * Orchestrates all IPC handlers for the application.
 * Each handler group is wrapped in try/catch to prevent a single failure
 * from leaving all subsequent handlers unregistered.
 */
export async function setupIpcHandlers(opts: {
  getMainWindow: () => BrowserWindow | null;
  getDataRoot: () => Promise<string>;
  getAppConfig: () => AppConfig | null;
  getCache: () => OfflineCache | null;
  getPendingChanges: () => PendingChanges | null;
  getSyncManager: () => SyncManager | null;
  getBackupManager: () => BackupManager | null;
  getDynatraceWindowManager: () => DynatraceWindowManager | null;
  getDynatraceProblemsManager: () => DynatraceProblemsManager | null;
  getPbClient: () => PocketBase | null;
  getKnowledgePdfService: () => KnowledgePdfService | null;
  getKnowledgeCoverService: () => KnowledgeCoverService | null;
  getKnowledgeUploadService: () => KnowledgeUploadService | null;
  getKnowledgeSearchService: () => KnowledgeSearchService | null;
  /** Shared with Relay Web gateways; this push listens for the app's lifetime. */
  knowledgeIndexStatusService: KnowledgeIndexStatusService;
  getPrivilegedRuntime: () => PrivilegedAccessRuntime | null;
  getWebApprovalCodes: () => WebApprovalCodeStore | null;
  getRelayWebServerManager: () => RelayWebServerManager | null;
  getWorkstationAwakeService: () => WorkstationAwakeService | null;
  subscribePrivilegedSessionChanged: (
    listener: (view: PrivilegedSessionView) => void,
  ) => () => void;
  subscribeWebApprovalRequestsChanged: (
    listener: (requests: PrivilegedApprovalRequestView[]) => void,
  ) => () => void;
  onPrivilegedCredentialChanged: (accountId: string) => void;
  restartPb?: (replaceData: () => void) => Promise<boolean>;
}): Promise<void> {
  const {
    getMainWindow,
    getDataRoot,
    getAppConfig,
    getCache,
    getPendingChanges,
    getSyncManager,
    getBackupManager,
    getDynatraceWindowManager,
    getDynatraceProblemsManager,
    getPbClient,
    getKnowledgePdfService,
    getKnowledgeCoverService,
    getKnowledgeUploadService,
    getKnowledgeSearchService,
    knowledgeIndexStatusService,
    getPrivilegedRuntime,
    getWebApprovalCodes,
    getRelayWebServerManager,
    getWorkstationAwakeService,
    subscribePrivilegedSessionChanged,
    subscribeWebApprovalRequestsChanged,
    onPrivilegedCredentialChanged,
    restartPb,
  } = opts;
  // App-lifetime subscription, like the radar and release-update pushes.
  knowledgeIndexStatusService.onChange((status) =>
    broadcastToAllWindows(IPC_CHANNELS.KNOWLEDGE_INDEX_STATUS_CHANGED, status),
  );
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
  safeSetup('radar', () => setupRadarHandlers());
  safeSetup('releaseUpdates', () => setupReleaseUpdateHandlers());
  safeSetup('workstationAwake', () => setupWorkstationAwakeHandlers(getWorkstationAwakeService));

  safeSetup('dynatrace', () => setupDynatraceHandlers(getDynatraceWindowManager()));

  safeSetup('dynatraceProblems', () =>
    setupDynatraceProblemsHandlers(getDynatraceProblemsManager, getAppConfig),
  );

  safeSetup('knowledge', () =>
    setupKnowledgeHandlers(
      getKnowledgePdfService,
      () => knowledgeIndexStatusService,
      getKnowledgeUploadService,
      getKnowledgeCoverService,
      getKnowledgeSearchService,
    ),
  );

  safeSetup('privilegedAccess', () =>
    setupPrivilegedAccessHandlers({
      ipcMain,
      getRuntime: getPrivilegedRuntime,
      isServer: () => getAppConfig()?.load()?.mode === 'server',
      getAccountManager: () => {
        const pb = getPbClient();
        if (!pb?.authStore.isValid || pb.authStore.record?.collectionName !== '_superusers') {
          return null;
        }
        return new PrivilegedAccountManager({
          pb,
          onCredentialChanged: (accountId) => {
            onPrivilegedCredentialChanged(accountId);
            const runtime = getPrivilegedRuntime();
            if (runtime?.getView().accountId === accountId) void runtime.logout();
          },
        });
      },
      assertTrustedIpcSender,
      subscribeSessionChanged: subscribePrivilegedSessionChanged,
      getApprovalCodes: getWebApprovalCodes,
      subscribeApprovalRequestsChanged: subscribeWebApprovalRequestsChanged,
    }),
  );

  // Window Management
  safeSetup('window', () => setupWindowHandlers(getMainWindow, getDataRoot));
  safeSetup('sdpAccount', () => setupSdpAccountHandlers(getMainWindow, getPrivilegedRuntime));

  // PocketBase Setup Handlers (always registered — uses getter for lazy access)
  safeSetup('setup', () => setupSetupHandlers(getAppConfig, getCache, getPendingChanges));

  safeSetup('relayWebServer', () =>
    setupRelayWebServerHandlers({ getAppConfig, getManager: getRelayWebServerManager }),
  );

  // Offline Cache Handlers (always registered — getters return null when not in client mode)
  safeSetup('cache', () =>
    setupCacheHandlers(getCache, getPendingChanges, getSyncManager, getAppConfig),
  );

  safeSetup('offlineMutations', () =>
    setupOfflineMutationHandlers(getCache, getPendingChanges, getAppConfig),
  );

  // Backup Management
  safeSetup('backup', () =>
    setupBackupHandlers(getBackupManager, restartPb ?? (() => Promise.resolve(false)), getCache),
  );

  try {
    const { setupRecoveryHandlers } = await import('./handlers/recoveryHandlers');
    safeSetup('recovery', () =>
      setupRecoveryHandlers({
        getRuntime: getPrivilegedRuntime,
        getMode: () => getAppConfig()?.load()?.mode ?? 'unconfigured',
      }),
    );
  } catch (err) {
    loggers.main.error('Failed to load recovery handlers', {
      error: getErrorMessage(err),
    });
  }
}
