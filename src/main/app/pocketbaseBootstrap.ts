import { app } from 'electron';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type PocketBase from 'pocketbase';
import { join } from 'node:path';
import { loggers } from '../logger';
import type { ServerConfig } from '../config/AppConfig';
import { PocketBaseProcess } from '../pocketbase/PocketBaseProcess';
import { getPocketBaseBinaryName, getPocketBaseBinaryPath } from '../pocketbase/binaryPath';
import { BackupManager } from '../pocketbase/BackupManager';
import { RetentionManager } from '../pocketbase/RetentionManager';
import {
  ensureCollections,
  ensureKnowledgeBatchApi,
  ensureKnowledgeSearchCollections,
} from '../pocketbase/CollectionBootstrap';
import {
  getPbProcess,
  getPbClient,
  getBackupManager,
  setPbProcess,
  getRetentionManager,
  setRetentionManager,
  setBackupManager,
  setPbClient,
} from './appState';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import { requestAppRelaunch } from './relaunch';
import { startAdvertising, stopAdvertising } from '../discovery/RelayDiscovery';
import { IPC_CHANNELS, RELAY_APP_USER_EMAIL } from '@shared/ipc';
import { isCredentialRejection } from './pbErrors';
import {
  restartKnowledgeSearchRuntime,
  stopKnowledgeSearchRuntime,
} from '../knowledge/knowledgeSearchRuntime';

const APP_USER_AUTH_FIELD = ['pass', 'word'].join('');
const APP_USER_AUTH_CONFIRM_FIELD = `${APP_USER_AUTH_FIELD}Confirm`;
const APP_USER_ENSURE_ATTEMPTS = 3;
const APP_USER_ENSURE_RETRY_MS = 750;
const OPTIONAL_SEARCH_BOOTSTRAP_ATTEMPTS = 2;
const OPTIONAL_SEARCH_BOOTSTRAP_RETRY_MS = 250;
const OPTIONAL_SEARCH_BOOTSTRAP_DEADLINE_MS = 3_000;
const MAINTENANCE_INITIAL_DELAY_MS = 30_000;
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
let optionalKnowledgeSearchGeneration = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withDeadline<T>(operation: Promise<T>, deadlineMs: number): Promise<T> {
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(
      () => reject(new Error(`Optional Wiki search storage exceeded its ${deadlineMs}ms deadline`)),
      deadlineMs,
    );
  });

  return Promise.race([operation, deadline]).finally(() => {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  });
}

async function retryOptionalSearchBootstrap(
  operation: () => Promise<void>,
  options: { attempts: number; delayMs: number },
): Promise<void> {
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    for (let attempt = 1; attempt <= options.attempts; attempt++) {
      try {
        await operation();
        return;
      } catch (error) {
        if (attempt === options.attempts) throw error;
        await new Promise<void>((resolve) => {
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            resolve();
          }, options.delayMs);
        });
      }
    }
  } finally {
    if (retryTimer) clearTimeout(retryTimer);
  }
}

export async function initializeOptionalKnowledgeSearch(pb: PocketBase): Promise<boolean> {
  try {
    await withDeadline(
      retryOptionalSearchBootstrap(
        () => ensureKnowledgeSearchCollections(pb, { batchApiReady: true }),
        {
          attempts: OPTIONAL_SEARCH_BOOTSTRAP_ATTEMPTS,
          delayMs: OPTIONAL_SEARCH_BOOTSTRAP_RETRY_MS,
        },
      ),
      OPTIONAL_SEARCH_BOOTSTRAP_DEADLINE_MS,
    );
    return true;
  } catch (error) {
    loggers.pocketbase.warn('Optional Wiki search storage is unavailable', { error });
    return false;
  }
}

export function startPocketBaseMaintenanceSchedule(serverConfig: ServerConfig): boolean {
  const pb = getPbClient();
  const backupManager = getBackupManager();
  const retentionManager = getRetentionManager();
  if (!pb || !backupManager || !retentionManager) {
    loggers.pocketbase.warn('PocketBase maintenance managers are unavailable after startup');
    return false;
  }

  retentionManager.startSchedule(
    MAINTENANCE_INTERVAL_MS,
    async () => {
      await pb.collection('_superusers').authWithPassword('admin@relay.app', serverConfig.secret);
      await backupManager.backupIfDue();
    },
    MAINTENANCE_INITIAL_DELAY_MS,
  );
  loggers.pocketbase.info('Backup and retention schedule started');
  return true;
}

export function cancelDeferredPocketBaseServices(): void {
  optionalKnowledgeSearchGeneration += 1;
}

export function startDeferredPocketBaseServices(serverConfig: ServerConfig): () => void {
  startPocketBaseMaintenanceSchedule(serverConfig);
  const pb = getPbClient();
  const generation = optionalKnowledgeSearchGeneration + 1;
  optionalKnowledgeSearchGeneration = generation;
  if (pb) {
    void initializeOptionalKnowledgeSearch(pb).then((ready) => {
      if (generation !== optionalKnowledgeSearchGeneration || pb !== getPbClient()) return;
      return ready ? restartKnowledgeSearchRuntime() : stopKnowledgeSearchRuntime();
    });
  }
  return () => {
    if (generation === optionalKnowledgeSearchGeneration) {
      optionalKnowledgeSearchGeneration += 1;
    }
  };
}

/**
 * Ensure superuser and app user exist with the correct passphrase.
 *
 * This repair path is intentionally invoked only after the running server
 * definitively rejects the configured superuser credentials.
 */
function repairSuperuserCredentials(binaryPath: string, pbDataDir: string, secret: string): void {
  try {
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
    loggers.pocketbase.error('Failed to repair superuser via CLI', {
      error: err,
      binaryPath,
      pbDataDir,
    });
    throw new Error('PocketBase superuser credential repair failed.', { cause: err });
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
    await pb.collection('_pb_users_auth_').authWithPassword(RELAY_APP_USER_EMAIL, secret);
    loggers.pocketbase.info('App user auth OK');
    return;
  } catch (authErr) {
    // Recreate only on a definitive credential rejection; transient errors
    // bubble up to the retry wrapper instead of destroying the user.
    if (!isCredentialRejection(authErr)) throw authErr;
  }

  // Auth as superuser to manage users
  await pb.collection('_superusers').authWithPassword('admin@relay.app', secret);

  // Delete the existing app user if present (recreate with correct password)
  try {
    const existing = await pb
      .collection('_pb_users_auth_')
      .getFirstListItem(`email="${RELAY_APP_USER_EMAIL}"`);
    await pb.collection('_pb_users_auth_').delete(existing.id);
  } catch {
    // User doesn't exist yet
  }

  // Create with current passphrase
  const appUserCreateEntries = [
    ['email', RELAY_APP_USER_EMAIL],
    [APP_USER_AUTH_FIELD, secret],
    [APP_USER_AUTH_CONFIRM_FIELD, secret],
  ];
  await pb.collection('_pb_users_auth_').create(Object.fromEntries(appUserCreateEntries));

  // Prove remote clients will be able to authenticate before reporting server ready.
  await pb.collection('_pb_users_auth_').authWithPassword(RELAY_APP_USER_EMAIL, secret);
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

export type PocketBaseStartResult =
  | { status: 'failed' }
  | { status: 'started'; privilegedRuntimeReady: true }
  | { status: 'started'; privilegedRuntimeReady: false; reason: string };

export type PocketBaseStartOptions = Readonly<{
  onHealthy?: () => void;
  onCredentialsReady?: () => void;
  onSchemaReady?: () => void;
}>;

// Guard against concurrent invocations (e.g. rapid reconfigure clicks).
let pbStartPromise: Promise<PocketBaseStartResult> | null = null;

/**
 * Start (or restart) PocketBase in server mode.
 * Deduplicates concurrent calls — only one start runs at a time.
 */
export const startPocketBase = (
  serverConfig: ServerConfig,
  configDataDir: string,
  options: PocketBaseStartOptions = {},
): Promise<PocketBaseStartResult> => {
  if (pbStartPromise) return pbStartPromise;
  pbStartPromise = doStartPocketBase(serverConfig, configDataDir, options).finally(() => {
    pbStartPromise = null;
  });
  return pbStartPromise;
};

const doStartPocketBase = async (
  serverConfig: ServerConfig,
  configDataDir: string,
  options: PocketBaseStartOptions,
): Promise<PocketBaseStartResult> => {
  // Stop any previous mDNS advertisement before (re)starting the server.
  stopAdvertising();

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
      broadcastToAllWindows(IPC_CHANNELS.PB_CRASHED, { error });
      requestAppRelaunch('pocketbase-crash-loop', { exitCode: 1 });
    });

    await pbProcess.start();

    const localUrl = pbProcess.getLocalUrl();
    const PocketBase = (await import('pocketbase')).default;
    let pb = new PocketBase(localUrl);
    try {
      await pb.collection('_superusers').authWithPassword('admin@relay.app', serverConfig.secret);
    } catch (authError) {
      if (!isCredentialRejection(authError)) throw authError;
      loggers.pocketbase.warn('PocketBase superuser credentials rejected; repairing once');
      await pbProcess.stop();
      repairSuperuserCredentials(binaryPath, pbDataDir, serverConfig.secret);
      await pbProcess.start();
      pb = new PocketBase(localUrl);
      await pb.collection('_superusers').authWithPassword('admin@relay.app', serverConfig.secret);
    }
    options.onHealthy?.();
    loggers.pocketbase.info('PocketBase started', { url: pbProcess.getUrl() });

    // Ensure app user exists for remote client auth (superuser is localhost-only)
    await ensureAppUser(localUrl, serverConfig.secret);
    options.onCredentialsReady?.();

    // Ensure collections exist before returning success — the renderer
    // depends on them being available immediately after bootstrap resolves.
    await ensureKnowledgeBatchApi(pb);
    const collections = await ensureCollections(pb);
    options.onSchemaReady?.();
    setPbClient(pb);

    // Advertise on the LAN so client setup can discover this server (best-effort).
    if (serverConfig.bindHost === '0.0.0.0') {
      startAdvertising(serverConfig.port);
    }

    // Construct managers now so manual backup/restore is ready with the
    // workspace. Automatic database work is scheduled only after global ready.
    try {
      const backupMgr = new BackupManager(configDataDir);
      setBackupManager(backupMgr);
      backupMgr.setPocketBase(pb);
      setRetentionManager(new RetentionManager(pb));
      loggers.pocketbase.info('Backup and retention managers prepared');
    } catch (retErr) {
      loggers.pocketbase.error('Failed to prepare backup/retention managers', { error: retErr });
    }

    return collections.privilegedRuntimeReady
      ? { status: 'started', privilegedRuntimeReady: true }
      : {
          status: 'started',
          privilegedRuntimeReady: false,
          reason: collections.reason,
        };
  } catch (pbError) {
    loggers.pocketbase.error('Failed to start PocketBase', { error: pbError });
    return { status: 'failed' };
  }
};
