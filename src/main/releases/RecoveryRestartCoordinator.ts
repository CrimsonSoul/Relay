import type { RecoveryInstallationMode } from './RecoveryCatalog';
import type { RecoveryUpdateRequest } from './RecoveryUpdateRequest';

type PrepareRecoveryRestartOptions = {
  transactionId: string;
  getRequest: () => Promise<RecoveryUpdateRequest | null>;
  getCurrentMode: () => RecoveryInstallationMode;
  stopServer: () => Promise<void>;
  checkpointClient: () => boolean | Promise<boolean>;
  createServerSnapshot: () => Promise<{ snapshotId: string }>;
  completeRequest: (transactionId: string, snapshotId: string | null) => Promise<unknown>;
};

export type PrepareRecoveryRestartResult = 'ready' | 'unchanged' | 'restart-current';

export async function prepareRecoveryRestart(
  options: PrepareRecoveryRestartOptions,
): Promise<PrepareRecoveryRestartResult> {
  let teardownStarted = false;
  try {
    const request = await options.getRequest();
    const currentMode = options.getCurrentMode();
    if (
      request?.transactionId !== options.transactionId ||
      request.checkpoint !== 'pending' ||
      request.mode !== currentMode
    ) {
      return 'unchanged';
    }

    if (currentMode === 'server') {
      teardownStarted = true;
      await options.stopServer();
      const snapshot = await options.createServerSnapshot();
      await options.completeRequest(options.transactionId, snapshot.snapshotId);
      return 'ready';
    }
    teardownStarted = true;
    if (currentMode === 'client' && !(await options.checkpointClient())) return 'restart-current';
    await options.completeRequest(options.transactionId, null);
    return 'ready';
  } catch {
    return teardownStarted ? 'restart-current' : 'unchanged';
  }
}
