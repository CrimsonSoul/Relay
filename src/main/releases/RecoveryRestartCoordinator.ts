import type { RecoveryInstallationMode } from './RecoveryCatalog';
import type { RecoveryUpdateRequest } from './RecoveryUpdateRequest';

type PrepareRecoveryRestartOptions = {
  transactionId: string;
  getRequest: () => Promise<RecoveryUpdateRequest | null>;
  getCurrentMode: () => RecoveryInstallationMode;
  stopServer: () => Promise<void>;
  /** Whether this process holds the client cache and queue; a probation run needs both. */
  clientDataAvailable: () => boolean;
  checkpointClient: () => boolean | Promise<boolean>;
  createServerSnapshot: () => Promise<{ snapshotId: string }>;
  completeRequest: (transactionId: string, snapshotId: string | null) => Promise<unknown>;
};

export type PrepareRecoveryRestartResult =
  'ready' | 'unchanged' | 'restart-current' | 'client-data-unavailable';

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
    // The candidate's probation run fails without the local stores and would mark the release failed,
    // so refuse before teardown and leave the prepared update for a later attempt.
    if (currentMode === 'client' && !options.clientDataAvailable())
      return 'client-data-unavailable';
    teardownStarted = true;
    if (currentMode === 'client' && !(await options.checkpointClient())) return 'restart-current';
    await options.completeRequest(options.transactionId, null);
    return 'ready';
  } catch {
    return teardownStarted ? 'restart-current' : 'unchanged';
  }
}
