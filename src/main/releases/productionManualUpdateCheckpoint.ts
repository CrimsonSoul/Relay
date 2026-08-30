import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app } from 'electron';
import { AppConfig } from '../config/AppConfig';
import { OfflineCache } from '../cache/OfflineCache';
import { PendingChanges } from '../cache/PendingChanges';
import { createWindowsPrivateDirectory } from '../pocketbase/WindowsPrivateDirectory';
import { runManualUpdateCheckpoint } from './ManualUpdateCheckpoint';
import { createRecoveryServerSnapshot } from './RecoverySnapshot';
import { completeRecoveryUpdateRequest, readRecoveryUpdateRequest } from './RecoveryUpdateRequest';

function checkpointClientDatabase(databasePath: string): boolean {
  const cache = new OfflineCache(databasePath);
  const pending = new PendingChanges(databasePath);
  try {
    pending.getAllStrict();
    return cache.checkpoint() && pending.checkpoint();
  } finally {
    cache.close();
    pending.close();
  }
}

export async function runProductionManualUpdateCheckpoint(transactionId: string): Promise<void> {
  const localAppData = process.env.LOCALAPPDATA;
  if (process.platform !== 'win32' || !app.isPackaged || !localAppData) {
    throw new Error('Manual update checkpoint is available only in packaged Windows Relay');
  }

  const relayRoot = join(localAppData, 'Relay');
  const userDataRoot = app.getPath('userData');
  const dataDirectory = join(userDataRoot, 'data');
  await runManualUpdateCheckpoint({
    transactionId,
    relayRoot,
    userDataRoot,
    readRequest: () => readRecoveryUpdateRequest(relayRoot),
    loadConfiguration: () => {
      const state = new AppConfig(dataDirectory).readState();
      return state.status === 'loaded'
        ? { status: 'loaded' as const, mode: state.config.mode }
        : state;
    },
    checkpointClient: checkpointClientDatabase,
    createServerSnapshot: (input) =>
      createRecoveryServerSnapshot({
        ...input,
        createPrivateDirectory: createWindowsPrivateDirectory,
        snapshotId: randomUUID(),
      }),
    completeRequest: (mode, snapshotId) =>
      completeRecoveryUpdateRequest(relayRoot, transactionId, mode, snapshotId),
  });
}
