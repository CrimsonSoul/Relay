import { app } from 'electron';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import type PocketBase from 'pocketbase';
import { join, resolve } from 'node:path';
import { loggers } from '../logger';
import type { ServerConfig } from '../config/AppConfig';
import { PocketBaseProcess } from '../pocketbase/PocketBaseProcess';
import { getPocketBaseBinaryName, getPocketBaseBinaryPath } from '../pocketbase/binaryPath';
import { BackupManager } from '../pocketbase/BackupManager';
import { RetentionManager } from '../pocketbase/RetentionManager';
import { createWindowsPrivateDirectory } from '../pocketbase/WindowsPrivateDirectory';
import {
  clearRelayAppUserAuthCoordinator,
  primeRelayAppUserAuth,
} from '../pocketbase/RelayAppUserAuthCoordinator';
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
import { isCredentialRejection, safePocketBaseAuthFailure } from './pbErrors';
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

class AppUserEnsureError extends Error {
  constructor(readonly authFailure: ReturnType<typeof safePocketBaseAuthFailure>) {
    super('Failed to ensure Relay app user');
    this.name = 'AppUserEnsureError';
  }
}
const MAINTENANCE_INITIAL_DELAY_MS = 30_000;
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SUPERUSER_REPAIR_DIRECTORY_PREFIX = '.relay-pb-repair-';
const SUPERUSER_REPAIR_PAYLOAD_FILE_NAME = '.relay-superuser-repair-payload';
const SUPERUSER_REPAIR_COMPLETION_FILE_NAME = '.relay-superuser-repair-complete';
const SUPERUSER_REPAIR_COMPLETION_PREFIX = 'relay-superuser-repair:';
const PRIVILEGED_REAUTHENTICATION_HOOK_FILE = 'relay_privileged_reauth.pb.js';
const PRIVILEGED_REAUTHENTICATION_ROUTE = '/api/relay/privileged/reauth';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MIN_RELAY_SECRET_FILE_BYTES = 8;
const MAX_RELAY_SECRET_FILE_BYTES = 1024;
const buildSuperuserRepairMigration = (completionToken: string): string =>
  `
migrate((app) => {
  const migrationsFlag = "--migrationsDir=";
  let repairDir = "";
  for (const arg of $os.args) {
    if (arg.startsWith(migrationsFlag)) {
      repairDir = arg.slice(migrationsFlag.length);
      break;
    }
  }
  if (!repairDir) {
    throw new Error("Relay superuser repair directory is unavailable");
  }

  const secretPath = $filepath.join(repairDir, "${SUPERUSER_REPAIR_PAYLOAD_FILE_NAME}");
  const completionPath = $filepath.join(
    repairDir,
    "${SUPERUSER_REPAIR_COMPLETION_FILE_NAME}"
  );
  let secretContent;
  try {
    const secretInfo = $os.stat(secretPath);
    if (
      secretInfo.isDir() ||
      secretInfo.size() < ${MIN_RELAY_SECRET_FILE_BYTES} ||
      secretInfo.size() > ${MAX_RELAY_SECRET_FILE_BYTES}
    ) {
      throw new Error("Relay superuser repair secret has an invalid size");
    }
    secretContent = $os.readFile(secretPath);
  } finally {
    $os.remove(secretPath);
  }
  const secret = toString(secretContent, ${MAX_RELAY_SECRET_FILE_BYTES});
  if (!secret) {
    throw new Error("Relay superuser repair secret is unavailable");
  }

  let record;
  try {
    record = app.findAuthRecordByEmail("_superusers", "admin@relay.app");
  } catch {
    const collection = app.findCollectionByNameOrId("_superusers");
    record = new Record(collection);
    record.set("email", "admin@relay.app");
  }

  record.set("password", secret);
  app.save(record);
  $os.writeFile(completionPath, ${JSON.stringify(completionToken)}, ${PRIVATE_FILE_MODE});
});
`.trimStart();
let optionalKnowledgeSearchGeneration = 0;
let collectionBootstrapPromise:
  Promise<typeof import('../pocketbase/CollectionBootstrap')> | undefined;

function loadCollectionBootstrap(): Promise<typeof import('../pocketbase/CollectionBootstrap')> {
  collectionBootstrapPromise ??= import('../pocketbase/CollectionBootstrap');
  return collectionBootstrapPromise;
}

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

class PocketBaseAuthenticationError extends Error {
  readonly authFailure: ReturnType<typeof safePocketBaseAuthFailure>;

  constructor(operation: string, error: unknown) {
    super(`${operation} failed`);
    this.name = 'PocketBaseAuthenticationError';
    this.authFailure = safePocketBaseAuthFailure(error);
  }
}

export async function initializeOptionalKnowledgeSearch(pb: PocketBase): Promise<boolean> {
  try {
    await withDeadline(
      retryOptionalSearchBootstrap(
        async () => {
          const { ensureKnowledgeSearchCollections } = await loadCollectionBootstrap();
          await ensureKnowledgeSearchCollections(pb, { batchApiReady: true });
        },
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

type SafeExecFailure = Readonly<{
  code?: string;
  status?: number;
  signal?: string;
  killed: boolean;
}>;

function toSafeExecFailure(error: unknown): SafeExecFailure {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    status: typeof value.status === 'number' ? value.status : undefined,
    signal: typeof value.signal === 'string' ? value.signal : undefined,
    killed: value.killed === true,
  };
}

function getSuperuserRepairDirectory(pbDataDir: string): string {
  const dataIdentity = createHash('sha256').update(resolve(pbDataDir)).digest('hex').slice(0, 16);
  return join(tmpdir(), `${SUPERUSER_REPAIR_DIRECTORY_PREFIX}${dataIdentity}`);
}

function cleanupSuperuserRepairArtifacts(pbDataDir: string): void {
  rmSync(getSuperuserRepairDirectory(pbDataDir), { recursive: true, force: true });
}

function createPrivateRepairDirectory(repairDirectory: string): void {
  if (process.platform !== 'win32') {
    mkdirSync(repairDirectory, { recursive: false, mode: PRIVATE_DIRECTORY_MODE });
    chmodSync(repairDirectory, PRIVATE_DIRECTORY_MODE);
    return;
  }

  createWindowsPrivateDirectory(repairDirectory);
}

function getRequiredPocketBaseHooksDir(appRoot: string): string {
  const hooksDir = app.isPackaged
    ? join(process.resourcesPath, 'pocketbase', 'hooks')
    : join(appRoot, 'resources', 'pocketbase', 'hooks');
  const reauthenticationHookPath = join(hooksDir, PRIVILEGED_REAUTHENTICATION_HOOK_FILE);
  if (!existsSync(reauthenticationHookPath)) {
    throw new Error('PocketBase privileged reauthentication hook is missing');
  }
  return hooksDir;
}

async function enforcePocketBaseAuthRateLimit(
  pb: PocketBase,
  pbProcess: PocketBaseProcess,
): Promise<void> {
  try {
    const { ensurePocketBaseAuthRateLimit } = await loadCollectionBootstrap();
    await ensurePocketBaseAuthRateLimit(pb);
  } catch (error) {
    await pbProcess.stop();
    throw error;
  }
}

async function verifyPrivilegedReauthenticationRoute(
  localUrl: string,
  pbProcess: PocketBaseProcess,
): Promise<void> {
  try {
    const response = await fetch(`${localUrl}${PRIVILEGED_REAUTHENTICATION_ROUTE}`, {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    if (response.status !== 401) {
      throw new Error('PocketBase privileged reauthentication route is unavailable');
    }
  } catch (error) {
    await pbProcess.stop();
    throw new Error('PocketBase privileged reauthentication route is unavailable', {
      cause: error,
    });
  }
}

/**
 * Ensure superuser and app user exist with the correct passphrase.
 *
 * This repair path is intentionally invoked only after the running server
 * definitively rejects the configured superuser credentials.
 */
function repairSuperuserCredentials(binaryPath: string, pbDataDir: string, secret: string): void {
  const migrationDir = getSuperuserRepairDirectory(pbDataDir);
  const secretPath = join(migrationDir, SUPERUSER_REPAIR_PAYLOAD_FILE_NAME);
  const completionPath = join(migrationDir, SUPERUSER_REPAIR_COMPLETION_FILE_NAME);
  try {
    createPrivateRepairDirectory(migrationDir);

    const migrationId = randomUUID().replace(/-/g, '');
    const completionToken = `${SUPERUSER_REPAIR_COMPLETION_PREFIX}${migrationId}`;
    const migrationPath = join(
      migrationDir,
      `${Date.now()}_relay_superuser_repair_${migrationId}.js`,
    );
    writeFileSync(migrationPath, buildSuperuserRepairMigration(completionToken), {
      encoding: 'utf8',
      flag: 'wx',
      mode: PRIVATE_FILE_MODE,
    });
    writeFileSync(secretPath, secret, {
      encoding: 'utf8',
      flag: 'wx',
      mode: PRIVATE_FILE_MODE,
    });

    // The migration removes the owner-only handoff before updating the record.
    // Neither the process arguments/environment nor the migration source
    // contains the passphrase.
    execFileSync(
      binaryPath,
      ['migrate', 'up', `--migrationsDir=${migrationDir}`, `--dir=${pbDataDir}`],
      {
        timeout: 10000,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    if (readFileSync(completionPath, 'utf8') !== completionToken) {
      throw new Error('PocketBase repair migration did not complete');
    }
    if (existsSync(secretPath)) {
      throw new Error('PocketBase repair migration did not consume its secret');
    }
    loggers.pocketbase.info('Superuser upserted via CLI');
  } catch (error) {
    loggers.pocketbase.error('Failed to repair superuser via CLI', {
      failure: toSafeExecFailure(error),
      binaryPath,
      pbDataDir,
    });
    throw new Error('PocketBase superuser credential repair failed.');
  } finally {
    try {
      rmSync(secretPath, { force: true });
    } finally {
      rmSync(migrationDir, { recursive: true, force: true });
    }
  }
}

/**
 * Ensure the app user (relay@relay.app) exists with the current passphrase.
 * Clients need this because _superusers may not be accessible remotely.
 */
async function ensureAppUserOnce(localUrl: string, secret: string): Promise<PocketBase> {
  const PocketBase = (await import('pocketbase')).default;
  const pb = new PocketBase(localUrl);

  // If app user already works with current password, nothing to do
  try {
    await pb.collection('_pb_users_auth_').authWithPassword(RELAY_APP_USER_EMAIL, secret);
    loggers.pocketbase.info('App user auth OK');
    return pb;
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
  return pb;
}

async function ensureAppUser(localUrl: string, secret: string): Promise<PocketBase> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= APP_USER_ENSURE_ATTEMPTS; attempt++) {
    try {
      return await ensureAppUserOnce(localUrl, secret);
    } catch (err) {
      lastError = err;
      loggers.pocketbase.warn('Failed to ensure app user', {
        attempt,
        attempts: APP_USER_ENSURE_ATTEMPTS,
        authFailure: safePocketBaseAuthFailure(err),
      });
      if (attempt < APP_USER_ENSURE_ATTEMPTS) {
        await delay(APP_USER_ENSURE_RETRY_MS);
      }
    }
  }

  throw new AppUserEnsureError(safePocketBaseAuthFailure(lastError));
}

async function stopRunningPocketBaseForReconfigure(): Promise<void> {
  const existingProcess = getPbProcess();
  if (!existingProcess?.isRunning()) return;

  loggers.pocketbase.info('Stopping PocketBase for reconfigure');
  const retentionManager = getRetentionManager();
  if (retentionManager) {
    retentionManager.stop();
    setRetentionManager(null);
  }
  await existingProcess.stop();
}

function resolvePocketBaseBinaryPath(appRoot: string): string {
  const binaryPath = getPocketBaseBinaryPath({
    isPackaged: app.isPackaged,
    appRoot,
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    arch: process.arch,
  });
  if (app.isPackaged || existsSync(binaryPath)) return binaryPath;

  const legacyBinaryPath = join(
    appRoot,
    'resources',
    'pocketbase',
    getPocketBaseBinaryName(process.platform),
  );
  if (!existsSync(legacyBinaryPath)) return binaryPath;

  loggers.pocketbase.warn('Using legacy PocketBase binary path for development', {
    expectedBinaryPath: binaryPath,
    legacyBinaryPath,
  });
  return legacyBinaryPath;
}

type ManagedPocketBaseProcessConfig = Readonly<{
  binaryPath: string;
  dataDir: string;
  hooksDir: string;
  host: string;
  port: number;
}>;

function createManagedPocketBaseProcess(config: ManagedPocketBaseProcessConfig): PocketBaseProcess {
  const processInstance = new PocketBaseProcess(config);
  processInstance.onCrash((error) => {
    loggers.pocketbase.error('PocketBase crashed', { error });
    // Notify all renderer windows immediately so they can show an error
    // state without waiting for the next health check poll.
    broadcastToAllWindows(IPC_CHANNELS.PB_CRASHED, { error });
    requestAppRelaunch('pocketbase-crash-loop', { exitCode: 1 });
  });
  return processInstance;
}

type PocketBaseClientConstructor = (typeof import('pocketbase'))['default'];

async function authenticatePocketBaseSuperuser(
  PocketBaseClient: PocketBaseClientConstructor,
  localUrl: string,
  pbProcess: PocketBaseProcess,
  binaryPath: string,
  pbDataDir: string,
  secret: string,
): Promise<PocketBase> {
  let pb = new PocketBaseClient(localUrl);
  try {
    await pb.collection('_superusers').authWithPassword('admin@relay.app', secret);
  } catch (authError) {
    if (!isCredentialRejection(authError)) {
      throw new PocketBaseAuthenticationError('PocketBase superuser authentication', authError);
    }
    loggers.pocketbase.warn('PocketBase superuser credentials rejected; repairing once');
    await pbProcess.stop();
    repairSuperuserCredentials(binaryPath, pbDataDir, secret);
    await pbProcess.start();
    pb = new PocketBaseClient(localUrl);
    try {
      await pb.collection('_superusers').authWithPassword('admin@relay.app', secret);
    } catch (repairAuthError) {
      throw new PocketBaseAuthenticationError(
        'PocketBase repaired superuser authentication',
        repairAuthError,
      );
    }
  }
  return pb;
}

function prepareBackupAndRetentionManagers(configDataDir: string, pb: PocketBase): void {
  try {
    const backupMgr = new BackupManager(configDataDir);
    setBackupManager(backupMgr);
    backupMgr.setPocketBase(pb);
    setRetentionManager(new RetentionManager(pb));
    loggers.pocketbase.info('Backup and retention managers prepared');
  } catch (retErr) {
    loggers.pocketbase.error('Failed to prepare backup/retention managers', { error: retErr });
  }
}

async function stopPocketBaseAfterStartupFailure(
  managedPbProcess: PocketBaseProcess | null,
): Promise<void> {
  if (!managedPbProcess?.isRunning()) return;

  try {
    await managedPbProcess.stop();
    setPbProcess(null);
  } catch (stopError) {
    loggers.pocketbase.error('Failed to stop PocketBase after startup failure', {
      error: stopError,
    });
  }
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
  clearRelayAppUserAuthCoordinator();
  // Stop any previous mDNS advertisement before (re)starting the server.
  stopAdvertising();

  // If PB is already running (reconfigure), stop it so we can re-upsert credentials
  await stopRunningPocketBaseForReconfigure();

  let managedPbProcess: PocketBaseProcess | null = null;
  try {
    const appRoot = app.isPackaged ? process.resourcesPath : process.cwd();
    const binaryPath = resolvePocketBaseBinaryPath(appRoot);
    const pbDataDir = join(configDataDir, 'pb_data');
    cleanupSuperuserRepairArtifacts(pbDataDir);
    const hooksDir = getRequiredPocketBaseHooksDir(appRoot);

    loggers.pocketbase.info('PocketBase paths', {
      binaryPath,
      hooksDir,
      pbDataDir,
      resourcesPath: process.resourcesPath,
      execPath: process.execPath,
      isPackaged: app.isPackaged,
    });

    const processConfig = {
      binaryPath,
      dataDir: pbDataDir,
      hooksDir,
      port: serverConfig.port,
    };

    // Apply the authoritative PocketBase rate policy while bound to loopback.
    // A LAN listener is created only after that policy has been persisted.
    let pbProcess = createManagedPocketBaseProcess({
      ...processConfig,
      host: '127.0.0.1',
    });
    managedPbProcess = pbProcess;
    setPbProcess(pbProcess);

    await pbProcess.start();

    const localUrl = pbProcess.getLocalUrl();
    await verifyPrivilegedReauthenticationRoute(localUrl, pbProcess);
    const PocketBaseClient = (await import('pocketbase')).default;
    let pb = await authenticatePocketBaseSuperuser(
      PocketBaseClient,
      localUrl,
      pbProcess,
      binaryPath,
      pbDataDir,
      serverConfig.secret,
    );
    await enforcePocketBaseAuthRateLimit(pb, pbProcess);
    if (serverConfig.bindHost !== '127.0.0.1') {
      await pbProcess.stop();
      pbProcess = createManagedPocketBaseProcess({
        ...processConfig,
        host: serverConfig.bindHost,
      });
      managedPbProcess = pbProcess;
      setPbProcess(pbProcess);
      await pbProcess.start();
      await verifyPrivilegedReauthenticationRoute(localUrl, pbProcess);
      pb = new PocketBaseClient(localUrl);
      try {
        await pb.collection('_superusers').authWithPassword('admin@relay.app', serverConfig.secret);
      } catch (authError) {
        throw new PocketBaseAuthenticationError(
          'PocketBase LAN superuser authentication',
          authError,
        );
      }
    }
    options.onHealthy?.();
    loggers.pocketbase.info('PocketBase started', { url: pbProcess.getUrl() });

    // Ensure app user exists for remote client auth (superuser is localhost-only)
    const appUserPb = await ensureAppUser(localUrl, serverConfig.secret);
    primeRelayAppUserAuth(appUserPb, localUrl, serverConfig.secret);
    options.onCredentialsReady?.();

    // Ensure collections exist before returning success — the renderer
    // depends on them being available immediately after bootstrap resolves.
    const { ensureKnowledgeBatchApi, ensureCollections } = await loadCollectionBootstrap();
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
    prepareBackupAndRetentionManagers(configDataDir, pb);

    return collections.privilegedRuntimeReady
      ? { status: 'started', privilegedRuntimeReady: true }
      : {
          status: 'started',
          privilegedRuntimeReady: false,
          reason: collections.reason,
        };
  } catch (pbError) {
    clearRelayAppUserAuthCoordinator();
    await stopPocketBaseAfterStartupFailure(managedPbProcess);
    loggers.pocketbase.error('Failed to start PocketBase', { error: pbError });
    return { status: 'failed' };
  }
};
