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

export async function prepareRecoveryRestart(
  options: PrepareRecoveryRestartOptions,
): Promise<boolean> {
  try {
    const request = await options.getRequest();
    const currentMode = options.getCurrentMode();
    if (
      !request ||
      request.transactionId !== options.transactionId ||
      request.checkpoint !== 'pending' ||
      request.mode !== currentMode
    ) {
      return false;
    }

    if (currentMode === 'server') {
      await options.stopServer();
      const snapshot = await options.createServerSnapshot();
      await options.completeRequest(options.transactionId, snapshot.snapshotId);
      return true;
    }
    if (currentMode === 'client' && !(await options.checkpointClient())) return false;
    await options.completeRequest(options.transactionId, null);
    return true;
  } catch {
    return false;
  }
}
