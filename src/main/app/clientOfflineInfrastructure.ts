import { join } from 'node:path';
import PocketBase from 'pocketbase';
import { OfflineCache } from '../cache/OfflineCache';
import { PendingChanges } from '../cache/PendingChanges';
import { SyncManager } from '../cache/SyncManager';
import { setOfflineCache, setPendingChanges, setSyncManager } from './appState';
import { loggers } from '../logger';
import { RELAY_APP_USER_EMAIL } from '@shared/ipc';

const CLIENT_OFFLINE_AUTH_TIMEOUT_MS = 15_000;

export async function initializeClientOfflineInfrastructure(
  configDataDir: string,
  config: { serverUrl: string; secret: string },
): Promise<void> {
  // Open the local-only stores FIRST — they must be available even when the
  // server is unreachable; serving cached data offline is their entire purpose.
  let offlineCache: OfflineCache | null = null;
  let pendingChanges: PendingChanges | null = null;
  try {
    offlineCache = new OfflineCache(join(configDataDir, 'cache.db'));
    pendingChanges = new PendingChanges(join(configDataDir, 'pending_changes.db'));
  } catch (error) {
    offlineCache?.close();
    pendingChanges?.close();
    throw error;
  }

  const syncPb = new PocketBase(config.serverUrl);

  setOfflineCache(offlineCache);
  setPendingChanges(pendingChanges);
  setSyncManager(new SyncManager(syncPb));

  // Best-effort auth — if the server is unreachable now, the SYNC_PENDING
  // handler re-authenticates on demand before the next sync.
  const controller = new AbortController();
  const authTimeout = setTimeout(() => controller.abort(), CLIENT_OFFLINE_AUTH_TIMEOUT_MS);
  try {
    await syncPb
      .collection('_pb_users_auth_')
      .authWithPassword(RELAY_APP_USER_EMAIL, config.secret, {
        signal: controller.signal,
        requestKey: null,
      });
  } catch (error) {
    loggers.pocketbase.warn('Offline infrastructure ready; server auth deferred', { error });
  } finally {
    clearTimeout(authTimeout);
  }
}
