import { join } from 'node:path';
import type { RecoveryInstallationMode } from './RecoveryCatalog';
import type { RecoveryUpdateRequest } from './RecoveryUpdateRequest';

const MANUAL_CHECKPOINT_ARGUMENT = '--relay-manual-update-checkpoint';
const TRANSACTION_PREFIX = '/relay-transaction=';
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

export function parseManualUpdateCheckpointArgument(
  argv: readonly string[],
  platform: NodeJS.Platform,
  isPackaged: boolean,
): string | null {
  if (platform !== 'win32' || !isPackaged || argv.length !== 3) return null;
  if (argv[1] !== MANUAL_CHECKPOINT_ARGUMENT || !argv[2]?.startsWith(TRANSACTION_PREFIX)) {
    return null;
  }
  const transactionId = argv[2].slice(TRANSACTION_PREFIX.length);
  return UUID_V4_PATTERN.test(transactionId) ? transactionId : null;
}

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
