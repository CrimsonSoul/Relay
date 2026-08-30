import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  getAppConfig,
  getCloudStatusManager,
  getDynatraceProblemsManager,
  getKnowledgeUploadService,
  getOfflineCache,
  getPbProcess,
  getPendingChanges,
  getRadarManager,
  getRetentionManager,
  getRelayWebServerManager,
  setKnowledgeUploadService,
  setOfflineCache,
  setPbProcess,
  setPendingChanges,
  setRelayWebServerManager,
  setRetentionManager,
  setSyncManager,
} from '../app/appState';
import type { RecoveryBuildRecord } from './RecoveryCatalog';
import { stopPrivilegedRuntime } from '../app/privilegedRuntimeLifecycle';
import { stopKnowledgeSearchRuntime } from '../knowledge/knowledgeSearchRuntime';
import { stopAdvertising } from '../discovery/RelayDiscovery';
import { createWindowsPrivateDirectory } from '../pocketbase/WindowsPrivateDirectory';
import { createRecoveryServerSnapshot } from './RecoverySnapshot';
function currentMode(): 'server' | 'client' | 'unconfigured' {
  return getAppConfig()?.load()?.mode ?? 'unconfigured';
}

async function stopServerForRecovery(): Promise<void> {
  await getRelayWebServerManager()?.stop();
  setRelayWebServerManager(null);
  getDynatraceProblemsManager()?.stop();
  getCloudStatusManager()?.stop();
  getRadarManager()?.stop();
  getKnowledgeUploadService()?.handleSessionChanged({
    state: 'signed-out',
    accountId: null,
    username: null,
    displayName: null,
    role: null,
    capabilities: [],
    deviceId: null,
    expiresAt: null,
  });
  await getKnowledgeUploadService()?.dispose();
  setKnowledgeUploadService(null);
  await stopKnowledgeSearchRuntime();
  await stopPrivilegedRuntime();
  stopAdvertising();
  getRetentionManager()?.stop();
  setRetentionManager(null);
  const pocketBase = getPbProcess();
  await pocketBase?.stop();
  if (getPbProcess() === pocketBase) setPbProcess(null);
}

export async function prepareProductionManualRollback(input: {
  transactionId: string;
  sourceBuild: RecoveryBuildRecord;
  mode: 'server' | 'client';
  userDataRoot: string;
}): Promise<{ success: boolean; sourceSnapshotId: string | null }> {
  if (currentMode() !== input.mode) return { success: false, sourceSnapshotId: null };
  try {
    if (input.mode === 'server') {
      await stopServerForRecovery();
      const snapshot = await createRecoveryServerSnapshot({
        userDataRoot: input.userDataRoot,
        dataDirectory: join(input.userDataRoot, 'data'),
        transactionId: input.transactionId,
        sourceBuildId: input.sourceBuild.buildId,
        dataEpoch: input.sourceBuild.serverDataEpoch,
        createPrivateDirectory: createWindowsPrivateDirectory,
        snapshotId: randomUUID(),
      });
      return { success: true, sourceSnapshotId: snapshot.snapshotId };
    }
    if (!(await checkpointClientForRecovery())) {
      return { success: false, sourceSnapshotId: null };
    }
    return { success: true, sourceSnapshotId: null };
  } catch {
    return { success: false, sourceSnapshotId: null };
  }
}

async function checkpointClientForRecovery(): Promise<boolean> {
  await stopPrivilegedRuntime();
  await getKnowledgeUploadService()?.dispose();
  setKnowledgeUploadService(null);
  await stopKnowledgeSearchRuntime();
  getRadarManager()?.stop();

  const cache = getOfflineCache();
  const pending = getPendingChanges();
  if (!cache || !pending) return false;
  pending.getAllStrict();
  if (!cache.checkpoint() || !pending.checkpoint()) return false;
  cache.close();
  pending.close();
  if (getOfflineCache() === cache) setOfflineCache(null);
  if (getPendingChanges() === pending) setPendingChanges(null);
  setSyncManager(null);
  return true;
}
