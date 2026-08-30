import { join } from 'node:path';
import type { RecoveryInstallationMode } from './RecoveryCatalog';
import type { RecoveryUpdateRequest } from './RecoveryUpdateRequest';

type ManualCheckpointMode = RecoveryInstallationMode;

export type ManualUpdateCheckpointOptions = {
  transactionId: string;
  relayRoot: string;
  userDataRoot: string;
  readRequest: () => Promise<RecoveryUpdateRequest | null>;
  loadConfiguration: () =>
    | { status: 'absent' }
    | { status: 'loaded'; mode: ManualCheckpointMode }
    | { status: 'unreadable'; reason: string };
  checkpointClient: (databasePath: string) => boolean | Promise<boolean>;
  createServerSnapshot: (input: {
    userDataRoot: string;
    dataDirectory: string;
    transactionId: string;
    sourceBuildId: string;
    dataEpoch: number;
  }) => Promise<{ snapshotId: string }>;
  completeRequest: (mode: ManualCheckpointMode, snapshotId: string | null) => Promise<unknown>;
};

export async function runManualUpdateCheckpoint(
  options: ManualUpdateCheckpointOptions,
): Promise<void> {
  const request = await options.readRequest();
  if (
    request?.transactionId !== options.transactionId ||
    request.checkpoint !== 'pending' ||
    request.mode !== 'unconfigured'
  ) {
    throw new Error('Manual update did not match one pending transaction');
  }

  const configuration = options.loadConfiguration();
  if (configuration.status === 'unreadable') {
    throw new Error(configuration.reason);
  }
  const mode = configuration.status === 'loaded' ? configuration.mode : 'unconfigured';
  let snapshotId: string | null = null;
  if (mode === 'server') {
    const snapshot = await options.createServerSnapshot({
      userDataRoot: options.userDataRoot,
      dataDirectory: join(options.userDataRoot, 'data'),
      transactionId: options.transactionId,
      sourceBuildId: request.source.buildId,
      dataEpoch: request.source.serverDataEpoch,
    });
    snapshotId = snapshot.snapshotId;
  } else if (mode === 'client') {
    const checkpointed = await options.checkpointClient(
      join(options.userDataRoot, 'data', 'cache.db'),
    );
    if (!checkpointed) throw new Error('Relay client data could not be checkpointed');
  }

  await options.completeRequest(mode, snapshotId);
}
