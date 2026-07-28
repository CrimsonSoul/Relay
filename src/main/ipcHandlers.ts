import { ipcMain, type BrowserWindow } from 'electron';
import type PocketBase from 'pocketbase';
import { setupCloudStatusHandlers } from './handlers/cloudStatus';
import { setupWindowHandlers } from './handlers/windowHandlers';
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
import { KnowledgeIndexStatusService } from './knowledge/KnowledgeIndexStatusService';
import type { KnowledgePdfService } from './knowledge/KnowledgePdfService';
import type { KnowledgeCoverService } from './knowledge/KnowledgeCoverService';
import type { KnowledgeUploadService } from './knowledge/KnowledgeUploadService';
import type { KnowledgeSearchService } from './knowledge/KnowledgeSearchService';
import { loggers } from './logger';
import { getErrorMessage } from '@shared/types';
import { assertTrustedIpcSender } from './utils/trustedSender';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import { PrivilegedAccountManager } from './privileged/PrivilegedAccountManager';
import type { RelayWebServerManager } from './web/RelayWebServerManager';
import type { WebApprovalCodeStore } from './web/WebApprovalCodeStore';
import type { PrivilegedApprovalRequestView } from '@shared/ipc';

/**
 * Orchestrates all IPC handlers for the application.
 * Each handler group is wrapped in try/catch to prevent a single failure
 * from leaving all subsequent handlers unregistered.
 */
export function setupIpcHandlers(opts: {
  getMainWindow: () => BrowserWindow | null;
  getDataRoot: () => Promise<string>;
  getAppConfig?: () => AppConfig | null;
  getCache?: () => OfflineCache | null;
  getPendingChanges?: () => PendingChanges | null;
  getSyncManager?: () => SyncManager | null;
  getBackupManager?: () => BackupManager | null;
  getDynatraceWindowManager?: () => DynatraceWindowManager | null;
  getDynatraceProblemsManager?: () => DynatraceProblemsManager | null;
  getPbClient?: () => PocketBase | null;
  getKnowledgePdfService?: () => KnowledgePdfService | null;
  getKnowledgeCoverService?: () => KnowledgeCoverService | null;
  getKnowledgeUploadService?: () => KnowledgeUploadService | null;
  getKnowledgeSearchService?: () => KnowledgeSearchService | null;
  getPrivilegedRuntime?: () => PrivilegedAccessRuntime | null;
  getWebApprovalCodes?: () => WebApprovalCodeStore | null;
  getRelayWebServerManager?: () => RelayWebServerManager | null;
  subscribePrivilegedSessionChanged?: (
    listener: (view: PrivilegedSessionView) => void,
  ) => () => void;
  subscribeWebApprovalRequestsChanged?: (
    listener: (requests: PrivilegedApprovalRequestView[]) => void,
  ) => () => void;
  onPrivilegedCredentialChanged?: (accountId: string) => void;
  restartPb?: () => Promise<boolean>;
}) {
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
    getPrivilegedRuntime,
    getWebApprovalCodes,
    getRelayWebServerManager,
    subscribePrivilegedSessionChanged,
    subscribeWebApprovalRequestsChanged,
    onPrivilegedCredentialChanged,
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

  safeSetup('knowledge', () =>
    setupKnowledgeHandlers(
      getKnowledgePdfService ?? (() => null),
      () => knowledgeIndexStatusService,
      getKnowledgeUploadService ?? (() => null),
      getKnowledgeCoverService ?? (() => null),
      getKnowledgeSearchService ?? (() => null),
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
          onCredentialChanged: (accountId) => {
            onPrivilegedCredentialChanged?.(accountId);
            const runtime = getPrivilegedRuntime?.();
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

  // PocketBase Setup Handlers (always registered — uses getter for lazy access)
  safeSetup('setup', () =>
    setupSetupHandlers(
      getAppConfig ?? (() => null),
      getCache ?? (() => null),
      getPendingChanges ?? (() => null),
    ),
  );

  safeSetup('relayWebServer', () =>
    setupRelayWebServerHandlers({
      getAppConfig: getAppConfig ?? (() => null),
      getManager: getRelayWebServerManager ?? (() => null),
    }),
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
