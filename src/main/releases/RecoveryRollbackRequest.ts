import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { isCanonicalTimestamp, type RecoveryInstallationMode } from './RecoveryCatalog';
import { replaceFileDurably } from '../utils/durableFile';
import { isBuildId, isDirectChild, parseExactIniSection, UUID_V4_PATTERN } from './recoveryFormat';
import { readRegularFile } from '../utils/regularFile';

const MAX_REQUEST_BYTES = 16 * 1_024;
const REQUEST_FILE = 'rollback-request.ini';
const ROLLBACK_REQUEST_KEYS = [
  'protocol',
  'transactionId',
  'sourceBuildId',
  'targetBuildId',
  'mode',
  'checkpoint',
  'targetSnapshotId',
  'sourceSnapshotId',
  'requestedAt',
] as const;

export type RecoveryRollbackRequest = {
  protocol: 2;
  transactionId: string;
  sourceBuildId: string;
  targetBuildId: string;
  mode: Exclude<RecoveryInstallationMode, 'unconfigured'>;
  checkpoint: 'pending' | 'complete';
  targetSnapshotId: string | null;
  sourceSnapshotId: string | null;
  requestedAt: string;
};

function isValidRequest(value: RecoveryRollbackRequest): boolean {
  const validIdentity =
    value.protocol === 2 &&
    UUID_V4_PATTERN.test(value.transactionId) &&
    isBuildId(value.sourceBuildId) &&
    isBuildId(value.targetBuildId) &&
    value.sourceBuildId !== value.targetBuildId &&
    (value.mode === 'server' || value.mode === 'client') &&
    (value.checkpoint === 'pending' || value.checkpoint === 'complete') &&
    isCanonicalTimestamp(value.requestedAt);
  if (!validIdentity) return false;
  if (value.mode === 'client') {
    return value.targetSnapshotId === null && value.sourceSnapshotId === null;
  }
  return (
    value.targetSnapshotId !== null &&
    UUID_V4_PATTERN.test(value.targetSnapshotId) &&
    (value.checkpoint === 'pending'
      ? value.sourceSnapshotId === null
      : value.sourceSnapshotId !== null && UUID_V4_PATTERN.test(value.sourceSnapshotId))
  );
}

export function serializeRecoveryRollbackRequest(request: RecoveryRollbackRequest): string {
  if (!isValidRequest(request)) throw new TypeError('Recovery rollback request was invalid');
  return `${[
    '[RollbackRequest]',
    'protocol=2',
    `transactionId=${request.transactionId}`,
    `sourceBuildId=${request.sourceBuildId}`,
    `targetBuildId=${request.targetBuildId}`,
    `mode=${request.mode}`,
    `checkpoint=${request.checkpoint}`,
    `targetSnapshotId=${request.targetSnapshotId ?? ''}`,
    `sourceSnapshotId=${request.sourceSnapshotId ?? ''}`,
    `requestedAt=${request.requestedAt}`,
  ].join('\r\n')}\r\n`;
}

export function parseRecoveryRollbackRequest(text: string): RecoveryRollbackRequest | null {
  const values = parseExactIniSection(
    text,
    'RollbackRequest',
    ROLLBACK_REQUEST_KEYS,
    MAX_REQUEST_BYTES,
  );
  if (!values) return null;
  const mode = values.get('mode');
  const checkpoint = values.get('checkpoint');
  if (
    values.get('protocol') !== '2' ||
    (mode !== 'server' && mode !== 'client') ||
    (checkpoint !== 'pending' && checkpoint !== 'complete')
  ) {
    return null;
  }
  const request: RecoveryRollbackRequest = {
    protocol: 2,
    transactionId: values.get('transactionId') ?? '',
    sourceBuildId: values.get('sourceBuildId') ?? '',
    targetBuildId: values.get('targetBuildId') ?? '',
    mode,
    checkpoint,
    targetSnapshotId: values.get('targetSnapshotId') || null,
    sourceSnapshotId: values.get('sourceSnapshotId') || null,
    requestedAt: values.get('requestedAt') ?? '',
  };
  return isValidRequest(request) ? request : null;
}

async function resolveRecoveryDirectory(
  relayRoot: string,
  createPrivateDirectory?: (path: string) => unknown,
): Promise<string> {
  const recoveryDirectory = join(relayRoot, 'Recovery');
  try {
    await lstat(recoveryDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !createPrivateDirectory) throw error;
    await createPrivateDirectory(recoveryDirectory);
  }
  const [realRelayRoot, stats, resolvedRecoveryDirectory] = await Promise.all([
    realpath(relayRoot),
    lstat(recoveryDirectory),
    realpath(recoveryDirectory),
  ]);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !isDirectChild(realRelayRoot, resolvedRecoveryDirectory, 'Recovery')
  ) {
    throw new Error('Relay recovery directory was redirected');
  }
  return resolvedRecoveryDirectory;
}

export async function writeRecoveryRollbackRequest(
  relayRoot: string,
  request: RecoveryRollbackRequest,
  createPrivateDirectory: (path: string) => unknown,
): Promise<string> {
  const contents = serializeRecoveryRollbackRequest(request);
  const recoveryDirectory = await resolveRecoveryDirectory(relayRoot, createPrivateDirectory);
  const requestPath = join(recoveryDirectory, REQUEST_FILE);
  const temporaryPath = join(recoveryDirectory, `.rollback-request.${randomUUID()}.tmp`);
  await replaceFileDurably(temporaryPath, requestPath, contents, { mode: 0o600, exclusive: true });
  return requestPath;
}

async function readRecoveryRollbackRequest(
  relayRoot: string,
): Promise<RecoveryRollbackRequest | null> {
  let recoveryDirectory: string;
  try {
    recoveryDirectory = await resolveRecoveryDirectory(relayRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const requestPath = join(recoveryDirectory, REQUEST_FILE);
  try {
    const request = await readRegularFile(requestPath, { maxBytes: MAX_REQUEST_BYTES });
    if (!request) throw new Error('Relay rollback request was redirected');
    return parseRecoveryRollbackRequest(request.toString('utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function completeRecoveryRollbackRequest(
  relayRoot: string,
  transactionId: string,
  sourceSnapshotId: string | null,
): Promise<RecoveryRollbackRequest> {
  const request = await readRecoveryRollbackRequest(relayRoot);
  if (request?.transactionId !== transactionId || request.checkpoint !== 'pending') {
    throw new Error('Recovery rollback transaction did not match');
  }
  const completed: RecoveryRollbackRequest = {
    ...request,
    checkpoint: 'complete',
    sourceSnapshotId,
  };
  await writeRecoveryRollbackRequest(relayRoot, completed, () => {
    throw new Error('Recovery directory disappeared');
  });
  return completed;
}
