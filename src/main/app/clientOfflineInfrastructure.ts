import { join } from 'node:path';
import PocketBase from 'pocketbase';
import { OfflineCache } from '../cache/OfflineCache';
import { PendingChanges } from '../cache/PendingChanges';
import { SyncManager } from '../cache/SyncManager';
import { setOfflineCache, setPendingChanges, setSyncManager } from './appState';

const CLIENT_OFFLINE_AUTH_TIMEOUT_MS = 15_000;

export async function initializeClientOfflineInfrastructure(
  configDataDir: string,
  config: { serverUrl: string; secret: string },
): Promise<void> {
  const syncPb = new PocketBase(config.serverUrl);
  const controller = new AbortController();
  const authTimeout = setTimeout(() => controller.abort(), CLIENT_OFFLINE_AUTH_TIMEOUT_MS);

  try {
    await syncPb.collection('_pb_users_auth_').authWithPassword('relay@relay.app', config.secret, {
      signal: controller.signal,
      requestKey: null,
    });
  } finally {
    clearTimeout(authTimeout);
  }

  let offlineCache: OfflineCache | null = null;
  let pendingChanges: PendingChanges | null = null;

  try {
    offlineCache = new OfflineCache(join(configDataDir, 'cache.db'));
    pendingChanges = new PendingChanges(join(configDataDir, 'pending_changes.db'));
    const syncManager = new SyncManager(syncPb);

    setOfflineCache(offlineCache);
    setPendingChanges(pendingChanges);
    setSyncManager(syncManager);
  } catch (error) {
    offlineCache?.close();
    pendingChanges?.close();
    throw error;
  }
}
