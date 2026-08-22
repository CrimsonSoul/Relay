import { join } from 'node:path';
import { existsSync, renameSync } from 'node:fs';
import PocketBase from 'pocketbase';
import { OfflineCache } from '../cache/OfflineCache';
import { PendingChanges } from '../cache/PendingChanges';
import { SyncManager } from '../cache/SyncManager';
import { setOfflineCache, setPendingChanges, setSyncManager } from './appState';
import { loggers } from '../logger';
import { authenticateRelayAppUserShared } from '../pocketbase/RelayAppUserAuthCoordinator';
import { safePocketBaseAuthFailure } from './pbErrors';

const CLIENT_OFFLINE_AUTH_TIMEOUT_MS = 15_000;

export async function initializeClientOfflineInfrastructure(
  configDataDir: string,
  config: { serverUrl: string; secret: string },
  options: { deferAuthentication?: boolean } = {},
): Promise<void> {
  // Open the local-only stores FIRST — they must be available even when the
  // server is unreachable; serving cached data offline is their entire purpose.
  let offlineCache: OfflineCache | null = null;
  let pendingChanges: PendingChanges | null = null;
  try {
    const cachePath = join(configDataDir, 'cache.db');
    const legacyPendingPath = join(configDataDir, 'pending_changes.db');
    offlineCache = new OfflineCache(cachePath);
    pendingChanges = new PendingChanges(cachePath);
    if (existsSync(legacyPendingPath)) {
      const legacyPending = new PendingChanges(legacyPendingPath);
      try {
        for (const change of legacyPending.getAllStrict()) {
          pendingChanges.enqueueCoalesced(
            change.collection,
            change.action,
            change.data,
            change.baseUpdated,
          );
        }
      } finally {
        legacyPending.close();
      }
      const migratedBackup = `${legacyPendingPath}.migrated-${Date.now()}`;
      for (const suffix of ['', '-wal', '-shm']) {
        const source = legacyPendingPath + suffix;
        if (existsSync(source)) renameSync(source, migratedBackup + suffix);
      }
      loggers.sync.info('Legacy pending queue migrated and preserved as a backup', {
        migratedBackup,
      });
    }
    // Recover the optimistic cache after a process interruption between the
    // durable queue write and cache update. Replaying is idempotent by record ID.
    for (const change of pendingChanges.getAll()) {
      offlineCache.updateRecord(change.collection, change.action, change.data);
    }
  } catch (error) {
    offlineCache?.close();
    pendingChanges?.close();
    throw error;
  }

  const syncPb = new PocketBase(config.serverUrl);

  setOfflineCache(offlineCache);
  setPendingChanges(pendingChanges);
  setSyncManager(
    new SyncManager(syncPb, {
      relayAppUserServerUrl: config.serverUrl,
    }),
  );

  // Best-effort auth — if the server is unreachable now, the SYNC_PENDING
  // handler re-authenticates on demand before the next sync.
  const authenticate = async () => {
    const controller = new AbortController();
    const authTimeout = setTimeout(() => controller.abort(), CLIENT_OFFLINE_AUTH_TIMEOUT_MS);
    try {
      await authenticateRelayAppUserShared(syncPb, config.serverUrl, config.secret, {
        signal: controller.signal,
      });
    } catch (error) {
      loggers.pocketbase.warn('Offline infrastructure ready; server auth deferred', {
        authFailure: safePocketBaseAuthFailure(error),
      });
    } finally {
      clearTimeout(authTimeout);
    }
  };

  if (options.deferAuthentication) {
    // Startup already authenticates the renderer connection and optional Wiki
    // search client. Avoid spending a third request from PocketBase's
    // authoritative two-request auth window; SyncManager reauthenticates this
    // client on demand before replaying pending work.
    return;
  }
  await authenticate();
}
