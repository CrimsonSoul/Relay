import { app } from 'electron';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { loggers } from '../logger';
import type { ServerConfig } from '../config/AppConfig';
import { PocketBaseProcess } from '../pocketbase/PocketBaseProcess';
import { BackupManager } from '../pocketbase/BackupManager';
import { RetentionManager } from '../pocketbase/RetentionManager';
import { state } from './appState';

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

/** Find the pb_migrations directory — tries multiple candidate paths for packaged builds. */
function resolveMigrationsDir(_pbDataDir: string): string {
  const appRoot = app.isPackaged ? process.resourcesPath : process.cwd();
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'pb_migrations'),
        join(process.resourcesPath, 'data', 'pb_migrations'),
        join(dirname(process.execPath), 'resources', 'pb_migrations'),
        join(dirname(process.execPath), 'pb_migrations'),
      ]
    : [join(appRoot, 'resources', 'pb_migrations')];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      loggers.pocketbase.info('Found migrations', { path: candidate });
      return candidate;
    }
  }

  // Fallback: copy to pb_data if none found (shouldn't happen if build is correct)
  loggers.pocketbase.warn('No migrations directory found in expected locations', {
    candidates,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath,
  });
  return candidates[0]; // Return first candidate even if missing — PB will log its own error
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
  if (state.pbProcess?.isRunning()) {
    loggers.pocketbase.info('Stopping PocketBase for reconfigure');
    if (state.retentionManager) {
      state.retentionManager.stop();
      state.retentionManager = null;
    }
    await state.pbProcess.stop();
  }

  try {
    const appRoot = app.isPackaged ? process.resourcesPath : process.cwd();
    const binaryName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
    const binaryPath = app.isPackaged
      ? join(process.resourcesPath, 'pocketbase', binaryName)
      : join(appRoot, 'resources', 'pocketbase', binaryName);
    const pbDataDir = join(configDataDir, 'pb_data');
    const migrationsDir = resolveMigrationsDir(pbDataDir);

    loggers.pocketbase.info('PocketBase paths', {
      binaryPath,
      pbDataDir,
      migrationsDir,
      migrationsExists: existsSync(migrationsDir),
      resourcesPath: process.resourcesPath,
      execPath: process.execPath,
      isPackaged: app.isPackaged,
    });

    // Upsert superuser via CLI BEFORE starting PB (no auth/server needed)
    ensureSuperuserSync(binaryPath, pbDataDir, serverConfig.secret);

    state.pbProcess = new PocketBaseProcess({
      binaryPath,
      dataDir: pbDataDir,
      migrationsDir,
      host: '0.0.0.0',
      port: serverConfig.port,
    });

    state.pbProcess.onCrash((error) => {
      loggers.pocketbase.error('PocketBase crashed', { error });
    });

    await state.pbProcess.start();
    loggers.pocketbase.info('PocketBase started', { url: state.pbProcess.getUrl() });

    // Ensure app user exists for remote client auth (superuser is localhost-only)
    await ensureAppUser(state.pbProcess.getLocalUrl(), serverConfig.secret);

    // Fire-and-forget: backup and retention run in the background
    // so the UI can proceed as soon as PB is up and the app user is ready.
    const localUrl = state.pbProcess.getLocalUrl();
    void (async () => {
      state.backupManager = new BackupManager(configDataDir);
      try {
        const PocketBase = (await import('pocketbase')).default;
        const pb = new PocketBase(localUrl);
        await pb.collection('_superusers').authWithPassword('admin@relay.app', serverConfig.secret);
        state.backupManager.setPocketBase(pb);
        await state.backupManager.backup();
        state.retentionManager = new RetentionManager(pb);
        state.retentionManager.startSchedule();
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
