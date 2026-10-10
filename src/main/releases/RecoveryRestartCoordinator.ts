import type { RecoveryInstallationMode } from './RecoveryCatalog';
import { recoverySnapshotFailure } from './RecoverySnapshot';
import type { RecoveryUpdateRequest } from './RecoveryUpdateRequest';

type PrepareRecoveryRestartOptions = {
  transactionId: string;
  getRequest: () => Promise<RecoveryUpdateRequest | null>;
  getCurrentMode: () => RecoveryInstallationMode;
  stopServer: () => Promise<void>;
  /** Whether this process holds the client cache and queue; a probation run needs both. */
  clientDataAvailable: () => boolean;
  checkpointClient: () => boolean | Promise<boolean>;
  /** A backup restore replaces the server data, so an update restart waits until it ends. */
  restoreRunning?: () => boolean;
  createServerSnapshot: () => Promise<{ snapshotId: string }>;
  completeRequest: (transactionId: string, snapshotId: string | null) => Promise<unknown>;
  /** Receives the full error behind a restart of the current version; the result names only why. */
  reportFailure?: (failure: RecoveryRestartFailure, error: unknown) => void;
};

/** The step that stopped an update restart after teardown, so Relay reopens the current version. */
export const RECOVERY_RESTART_FAILURES = [
  'stop-services',
  'snapshot-space',
  'snapshot-changed',
  'snapshot-locked',
  'snapshot-unsupported',
  'snapshot',
  'update-request',
  'client-checkpoint',
] as const;
export type RecoveryRestartFailure = (typeof RECOVERY_RESTART_FAILURES)[number];

export type PrepareRecoveryRestartResult =
  | 'ready'
  | 'unchanged'
  | 'client-data-unavailable'
  | 'restore-running'
  | Readonly<{ status: 'restart-current'; failure: RecoveryRestartFailure }>;

type RestartStage = 'stop-services' | 'snapshot' | 'update-request' | 'client-checkpoint';

function restartFailure(stage: RestartStage, error: unknown): RecoveryRestartFailure {
  if (stage !== 'snapshot') return stage;
  const failure = recoverySnapshotFailure(error);
  return failure === 'other' ? 'snapshot' : `snapshot-${failure}`;
}

export async function prepareRecoveryRestart(
  options: PrepareRecoveryRestartOptions,
): Promise<PrepareRecoveryRestartResult> {
  // Null until teardown starts; after that a failure must restart the current version.
  let stage: RestartStage | null = null;
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
      if (options.restoreRunning?.()) return 'restore-running';
      stage = 'stop-services';
      await options.stopServer();
      stage = 'snapshot';
      const snapshot = await options.createServerSnapshot();
      stage = 'update-request';
      await options.completeRequest(options.transactionId, snapshot.snapshotId);
      return 'ready';
    }
    // The candidate's probation run fails without the local stores and would mark the release failed,
    // so refuse before teardown and leave the prepared update for a later attempt.
    if (currentMode === 'client' && !options.clientDataAvailable())
      return 'client-data-unavailable';
    if (currentMode === 'client') {
      stage = 'client-checkpoint';
      if (!(await options.checkpointClient()))
        throw new Error('Relay client data could not be checkpointed');
    }
    stage = 'update-request';
    await options.completeRequest(options.transactionId, null);
    return 'ready';
  } catch (error) {
    if (stage === null) return 'unchanged';
    const failure = restartFailure(stage, error);
    try {
      options.reportFailure?.(failure, error);
    } catch {
      // Reporting never changes the restart outcome.
    }
    return { status: 'restart-current', failure };
  }
}
