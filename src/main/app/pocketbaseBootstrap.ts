import { app } from 'electron';
import { join } from 'node:path';
import { loggers } from '../logger';
import type { ServerConfig } from '../config/AppConfig';
import { PocketBaseProcess } from '../pocketbase/PocketBaseProcess';
import { BackupManager } from '../pocketbase/BackupManager';
import { RetentionManager } from '../pocketbase/RetentionManager';
import { ensureCollections } from '../pocketbase/CollectionBootstrap';
import {
  getPbProcess,
  setPbProcess,
  getRetentionManager,
  setRetentionManager,
  setBackupManager,
  setPbClient,
} from './appState';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';

/**
 * Ensure superuser and app user exist with the correct passphrase.
 *
 * 1. Use PB CLI to upsert superuser BEFORE PB starts (always works, no auth needed)
 * 2. After PB starts, use superuser to create/recreate app user
 */
function ensureSuperuserSync(binaryPath: string, pbDataDir: string, secret: string): void {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');

    // Use execFileSync with args array to bypass cmd.exe shell quoting on Windows.
    // execSync passes through cmd.exe which mangles paths with spaces and special chars.
    execFileSync(
      binaryPath,
      ['superuser', 'upsert', 'admin@relay.app', secret, `--dir=${pbDataDir}`],
      {
        timeout: 10000,
        stdio: 'pipe',
      },
    );
    loggers.pocketbase.info('Superuser upserted via CLI');
  } catch (err) {
    loggers.pocketbase.error('Failed to upsert superuser via CLI — auth will not work', {
      error: err,
      binaryPath,
      pbDataDir,
    });
  }
}

/**
 * Ensure the app user (relay@relay.app) exists with the current passphrase.
 * Clients need this because _superusers may not be accessible remotely.
 */
async function ensureAppUser(localUrl: string, secret: string): Promise<void> {
  try {
    const PocketBase = (await import('pocketbase')).default;
    const pb = new PocketBase(localUrl);

    // If app user already works with current password, nothing to do
    try {
      await pb.collection('_pb_users_auth_').authWithPassword('relay@relay.app', secret);
      loggers.pocketbase.info('App user auth OK');
      return;
    } catch {
      // Need to create or recreate
    }

    // Auth as superuser to manage users
    await pb.collection('_superusers').authWithPassword('admin@relay.app', secret);

    // Delete the existing app user if present (recreate with correct password)
    try {
      const existing = await pb
        .collection('_pb_users_auth_')
        .getFirstListItem('email="relay@relay.app"');
      await pb.collection('_pb_users_auth_').delete(existing.id);
    } catch {
      // User doesn't exist yet
    }

    // Create with current passphrase
    await pb
      .collection('_pb_users_auth_')
      .create({ email: 'relay@relay.app', password: secret, passwordConfirm: secret });
    loggers.pocketbase.info('App user created');
  } catch (err) {
    loggers.pocketbase.error('Failed to ensure app user', { error: err });
  }
}

// Guard against concurrent invocations (e.g. rapid reconfigure clicks).
let pbStartPromise: Promise<boolean> | null = null;

/**
 * Start (or restart) PocketBase in server mode.
 * Deduplicates concurrent calls — only one start runs at a time.
 */
export const startPocketBase = (
  serverConfig: ServerConfig,
  configDataDir: string,
): Promise<boolean> => {
  if (pbStartPromise) return pbStartPromise;
  pbStartPromise = doStartPocketBase(serverConfig, configDataDir).finally(() => {
    pbStartPromise = null;
  });
  return pbStartPromise;
};

const doStartPocketBase = async (
  serverConfig: ServerConfig,
  configDataDir: string,
): Promise<boolean> => {
  // If PB is already running (reconfigure), stop it so we can re-upsert credentials
  if (getPbProcess()?.isRunning()) {
    loggers.pocketbase.info('Stopping PocketBase for reconfigure');
    if (getRetentionManager()) {
      getRetentionManager()!.stop();
      setRetentionManager(null);
    }
    await getPbProcess()!.stop();
  }

  try {
    const appRoot = app.isPackaged ? process.resourcesPath : process.cwd();
    const binaryName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
    const binaryPath = app.isPackaged
      ? join(process.resourcesPath, 'pocketbase', binaryName)
      : join(appRoot, 'resources', 'pocketbase', binaryName);
    const pbDataDir = join(configDataDir, 'pb_data');

    loggers.pocketbase.info('PocketBase paths', {
      binaryPath,
      pbDataDir,
      resourcesPath: process.resourcesPath,
      execPath: process.execPath,
      isPackaged: app.isPackaged,
    });

    // Upsert superuser via CLI BEFORE starting PB (no auth/server needed)
    ensureSuperuserSync(binaryPath, pbDataDir, serverConfig.secret);

    const pbProcess = new PocketBaseProcess({
      binaryPath,
      dataDir: pbDataDir,
      host: '0.0.0.0',
      port: serverConfig.port,
    });
    setPbProcess(pbProcess);

    pbProcess.onCrash((error) => {
      loggers.pocketbase.error('PocketBase crashed', { error });
      // Notify all renderer windows immediately so they can show an error
      // state without waiting for the next health check poll.
      broadcastToAllWindows('pb:crashed', { error });
    });

    await pbProcess.start();
    loggers.pocketbase.info('PocketBase started', { url: pbProcess.getUrl() });

    // Ensure app user exists for remote client auth (superuser is localhost-only)
    await ensureAppUser(pbProcess.getLocalUrl(), serverConfig.secret);

    // Ensure collections exist before returning success — the renderer
    // depends on them being available immediately after bootstrap resolves.
    const localUrl = pbProcess.getLocalUrl();
    const PocketBase = (await import('pocketbase')).default;
    const pb = new PocketBase(localUrl);
    await pb.collection('_superusers').authWithPassword('admin@relay.app', serverConfig.secret);
    await ensureCollections(pb);
    setPbClient(pb);

    // Fire-and-forget: backup and retention run in the background
    // so the UI can proceed as soon as PB is up and collections are ready.
    void (async () => {
      const backupMgr = new BackupManager(configDataDir);
      setBackupManager(backupMgr);
      try {
        backupMgr.setPocketBase(pb);
        await backupMgr.backup();
        const retentionMgr = new RetentionManager(pb);
        setRetentionManager(retentionMgr);
        retentionMgr.startSchedule();
        loggers.pocketbase.info('Backup and retention managers started');
      } catch (retErr) {
        loggers.pocketbase.error('Failed to start backup/retention managers', {
          error: retErr,
        });
      }
    })();

    return true;
  } catch (pbError) {
    loggers.pocketbase.error('Failed to start PocketBase', { error: pbError });
    return false;
  }
};
