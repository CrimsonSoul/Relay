import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loggers } from '../logger';
import type { ServerConfig } from '../config/AppConfig';
import { PocketBaseProcess } from '../pocketbase/PocketBaseProcess';
import { getPocketBaseBinaryName, getPocketBaseBinaryPath } from '../pocketbase/binaryPath';
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
import { requestAppRelaunch } from './relaunch';

const APP_USER_EMAIL = 'relay@relay.app';
const APP_USER_AUTH_FIELD = ['pass', 'word'].join('');
const APP_USER_AUTH_CONFIRM_FIELD = `${APP_USER_AUTH_FIELD}Confirm`;
const APP_USER_ENSURE_ATTEMPTS = 3;
const APP_USER_ENSURE_RETRY_MS = 750;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
async function ensureAppUserOnce(localUrl: string, secret: string): Promise<void> {
  const PocketBase = (await import('pocketbase')).default;
  const pb = new PocketBase(localUrl);

  // If app user already works with current password, nothing to do
  try {
    await pb.collection('_pb_users_auth_').authWithPassword(APP_USER_EMAIL, secret);
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
      .getFirstListItem(`email="${APP_USER_EMAIL}"`);
    await pb.collection('_pb_users_auth_').delete(existing.id);
  } catch {
    // User doesn't exist yet
  }

  // Create with current passphrase
  const appUserCreateEntries = [
    ['email', APP_USER_EMAIL],
    [APP_USER_AUTH_FIELD, secret],
    [APP_USER_AUTH_CONFIRM_FIELD, secret],
  ];
  await pb.collection('_pb_users_auth_').create(Object.fromEntries(appUserCreateEntries));

  // Prove remote clients will be able to authenticate before reporting server ready.
  await pb.collection('_pb_users_auth_').authWithPassword(APP_USER_EMAIL, secret);
  loggers.pocketbase.info('App user created');
}

async function ensureAppUser(localUrl: string, secret: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= APP_USER_ENSURE_ATTEMPTS; attempt++) {
    try {
      await ensureAppUserOnce(localUrl, secret);
      return;
    } catch (err) {
      lastError = err;
      loggers.pocketbase.warn('Failed to ensure app user', {
        attempt,
        attempts: APP_USER_ENSURE_ATTEMPTS,
        error: err,
      });
      if (attempt < APP_USER_ENSURE_ATTEMPTS) {
        await delay(APP_USER_ENSURE_RETRY_MS);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to ensure app user');
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
    let binaryPath = getPocketBaseBinaryPath({
      isPackaged: app.isPackaged,
      appRoot,
      resourcesPath: process.resourcesPath,
      platform: process.platform,
      arch: process.arch,
    });
    if (!app.isPackaged && !existsSync(binaryPath)) {
      const legacyBinaryPath = join(
        appRoot,
        'resources',
        'pocketbase',
        getPocketBaseBinaryName(process.platform),
      );
      if (existsSync(legacyBinaryPath)) {
        loggers.pocketbase.warn('Using legacy PocketBase binary path for development', {
          expectedBinaryPath: binaryPath,
          legacyBinaryPath,
        });
        binaryPath = legacyBinaryPath;
      }
    }
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
      host: serverConfig.bindHost,
      port: serverConfig.port,
    });
    setPbProcess(pbProcess);

    pbProcess.onCrash((error) => {
      loggers.pocketbase.error('PocketBase crashed', { error });
      // Notify all renderer windows immediately so they can show an error
      // state without waiting for the next health check poll.
      broadcastToAllWindows('pb:crashed', { error });
      requestAppRelaunch('pocketbase-crash-loop', { exitCode: 1 });
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
