import { app, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import { RecoveryRepairSchema, RecoveryRollbackSchema } from '@shared/ipcValidation';
import type { RelayRecoveryState } from '@shared/recovery';
import type { RecoveryInstallationMode } from '../releases/RecoveryCatalog';
import type { RecoveryManager } from '../releases/RecoveryManager';
import type { PrivilegedAccessRuntime } from './privilegedAccessHandlers';
import { privilegedRateLimiters, rateLimiters, type KeyedRateLimiter } from '../rateLimiter';
import { assertTrustedIpcSender } from '../utils/trustedSender';
import { createWindowsPrivateDirectory } from '../pocketbase/WindowsPrivateDirectory';
import { loggers } from '../logger';

type RecoveryController = Pick<RecoveryManager, 'getState' | 'repair' | 'rollback'>;

type SimpleRateLimiter = {
  tryConsume: () => { allowed: boolean };
};

export type RecoveryHandlerRuntimeOptions = {
  getManager?: () => RecoveryController;
  getRuntime: () => PrivilegedAccessRuntime | null;
  getMode?: () => RecoveryInstallationMode;
  assertTrustedIpcSender?: (event: IpcMainInvokeEvent, channel: string) => boolean;
  reauthenticationLimiter?: KeyedRateLimiter;
  networkLimiter?: SimpleRateLimiter;
};

const UNAVAILABLE_STATE: RelayRecoveryState = {
  supported: false,
  status: 'unavailable',
  mode: 'unconfigured',
  currentBuildId: null,
  currentVersion: null,
  runningBuildId: null,
  runningVersion: null,
  fallbackActive: false,
  retainedBuilds: [],
};

async function createProductionRecoveryManager(
  getMode: () => RecoveryInstallationMode,
): Promise<RecoveryManager> {
  const { RecoveryManager } = await import('../releases/RecoveryManager');
  return new RecoveryManager({
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    localAppData: process.env.LOCALAPPDATA ?? '',
    execPath: process.execPath,
    userDataRoot: app.getPath('userData'),
    getMode,
    createPrivateDirectory: createWindowsPrivateDirectory,
    prepareRollback: (input) =>
      import('../releases/productionRecoveryRestart').then(({ prepareProductionManualRollback }) =>
        prepareProductionManualRollback(input),
      ),
    repairRuntime: (input) =>
      import('../releases/RecoveryRuntimeRepair').then(({ repairProductionRecoveryRuntime }) =>
        repairProductionRecoveryRuntime(input),
      ),
    relaunch: (options) => app.relaunch(options),
    quit: () => app.quit(),
  });
}

export function createRecoveryHandlerRuntime(options: RecoveryHandlerRuntimeOptions) {
  const trusted = options.assertTrustedIpcSender ?? assertTrustedIpcSender;
  const limiter = options.reauthenticationLimiter ?? privilegedRateLimiters.reauthentication;
  const networkLimiter = options.networkLimiter ?? rateLimiters.network;
  let productionManagerPromise: Promise<RecoveryController> | null = null;
  const getManager = () => {
    if (options.getManager) return Promise.resolve(options.getManager());
    productionManagerPromise ??= createProductionRecoveryManager(
      options.getMode ?? (() => 'unconfigured'),
    );
    return productionManagerPromise;
  };

  const getState = async (event: IpcMainInvokeEvent): Promise<RelayRecoveryState> => {
    if (!trusted(event, IPC_CHANNELS.APP_RECOVERY_GET_STATE)) return UNAVAILABLE_STATE;
    try {
      return await (await getManager()).getState();
    } catch (error) {
      loggers.main.warn('Relay recovery state unavailable', { error });
      return UNAVAILABLE_STATE;
    }
  };

  const handleOwnerAction = async (
    event: IpcMainInvokeEvent,
    input: unknown,
    channel: string,
    schema: typeof RecoveryRollbackSchema,
    action: 'repair' | 'rollback',
  ): Promise<IpcResult<boolean>> => {
    if (!trusted(event, channel)) return { success: false, error: 'untrusted-sender' };
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'invalid-input' };
    const runtime = options.getRuntime();
    const before = runtime?.getView();
    if (!runtime || before?.state !== 'active' || before.role !== 'owner' || !before.accountId) {
      return { success: false, error: 'unauthorized' };
    }
    const limiterKey = `${before.accountId}:${before.deviceId ?? 'unpaired'}`;
    if (!limiter.tryConsume(limiterKey).allowed) {
      return { success: false, error: 'rate-limited', rateLimited: true };
    }
    try {
      await runtime.reauthenticate(parsed.data.password);
      const after = runtime.getView();
      if (
        after.state !== 'active' ||
        after.role !== 'owner' ||
        after.accountId !== before.accountId
      ) {
        return { success: false, error: 'unauthorized' };
      }
    } catch {
      return { success: false, error: 'unauthorized' };
    }
    if (action === 'repair' && !networkLimiter.tryConsume().allowed) {
      return { success: false, error: 'rate-limited', rateLimited: true };
    }
    try {
      return await (await getManager())[action](parsed.data.targetBuildId);
    } catch {
      return { success: false, error: 'unavailable' };
    }
  };

  return {
    getState,
    rollback: (event: IpcMainInvokeEvent, input: unknown) =>
      handleOwnerAction(
        event,
        input,
        IPC_CHANNELS.APP_RECOVERY_ROLLBACK,
        RecoveryRollbackSchema,
        'rollback',
      ),
    repair: (event: IpcMainInvokeEvent, input: unknown) =>
      handleOwnerAction(
        event,
        input,
        IPC_CHANNELS.APP_RECOVERY_REPAIR,
        RecoveryRepairSchema,
        'repair',
      ),
  };
}
