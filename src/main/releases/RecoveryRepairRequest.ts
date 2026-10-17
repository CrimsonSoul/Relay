import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { isCanonicalTimestamp } from './RecoveryCatalog';
import { replaceFileDurably } from '../utils/durableFile';
import { isBuildId, isDirectChild, parseExactIniSection, UUID_V4_PATTERN } from './recoveryFormat';
import { readRegularFile } from '../utils/regularFile';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHA512_PATTERN = /^[0-9a-f]{128}$/u;
const MAX_FILE_BYTES = 16 * 1_024;
const REQUEST_FILE = 'repair-request.ini';
const RECEIPT_FILE = 'repair-result.ini';

export type RecoveryRepairRequest = {
  protocol: 2;
  transactionId: string;
  sourceBuildId: string;
  targetBuildId: string;
  targetVersion: string;
  targetCommitish: string;
  targetInstallerSha256: string;
  checkpoint: 'pending';
  requestedAt: string;
};

export type RecoveryRepairReceipt = {
  protocol: 2;
  transactionId: string;
  buildId: string;
  version: string;
  targetCommitish: string;
  runtimeSha512: string;
  installerSha256: string;
  completedAt: string;
};

function isValidRequest(value: RecoveryRepairRequest): boolean {
  return (
    value.protocol === 2 &&
    UUID_V4_PATTERN.test(value.transactionId) &&
    isBuildId(value.sourceBuildId) &&
    isBuildId(value.targetBuildId) &&
    value.sourceBuildId !== value.targetBuildId &&
    VERSION_PATTERN.test(value.targetVersion) &&
    COMMIT_PATTERN.test(value.targetCommitish) &&
    SHA256_PATTERN.test(value.targetInstallerSha256) &&
    value.checkpoint === 'pending' &&
    isCanonicalTimestamp(value.requestedAt)
  );
}

function isValidReceipt(value: RecoveryRepairReceipt): boolean {
  return (
    value.protocol === 2 &&
    UUID_V4_PATTERN.test(value.transactionId) &&
    isBuildId(value.buildId) &&
    VERSION_PATTERN.test(value.version) &&
    COMMIT_PATTERN.test(value.targetCommitish) &&
    SHA512_PATTERN.test(value.runtimeSha512) &&
    SHA256_PATTERN.test(value.installerSha256) &&
    isCanonicalTimestamp(value.completedAt)
  );
}

function parseSection(
  text: string,
  sectionName: string,
  expectedKeys: readonly string[],
): Map<string, string> | null {
  return parseExactIniSection(text, sectionName, expectedKeys, MAX_FILE_BYTES);
}

export function serializeRecoveryRepairRequest(request: RecoveryRepairRequest): string {
  if (!isValidRequest(request)) throw new TypeError('Recovery repair request was invalid');
  return `${[
    '[RepairRequest]',
    'protocol=2',
    `transactionId=${request.transactionId}`,
    `sourceBuildId=${request.sourceBuildId}`,
    `targetBuildId=${request.targetBuildId}`,
    `targetVersion=${request.targetVersion}`,
    `targetCommitish=${request.targetCommitish}`,
    `targetInstallerSha256=${request.targetInstallerSha256}`,
    `checkpoint=${request.checkpoint}`,
    `requestedAt=${request.requestedAt}`,
  ].join('\r\n')}\r\n`;
}

export function parseRecoveryRepairRequest(text: string): RecoveryRepairRequest | null {
  const values = parseSection(text, 'RepairRequest', [
    'protocol',
    'transactionId',
    'sourceBuildId',
    'targetBuildId',
    'targetVersion',
    'targetCommitish',
    'targetInstallerSha256',
    'checkpoint',
    'requestedAt',
  ]);
  if (values?.get('protocol') !== '2' || values.get('checkpoint') !== 'pending') {
    return null;
  }
  const request: RecoveryRepairRequest = {
    protocol: 2,
    transactionId: values.get('transactionId') ?? '',
    sourceBuildId: values.get('sourceBuildId') ?? '',
    targetBuildId: values.get('targetBuildId') ?? '',
    targetVersion: values.get('targetVersion') ?? '',
    targetCommitish: values.get('targetCommitish') ?? '',
    targetInstallerSha256: values.get('targetInstallerSha256') ?? '',
    checkpoint: 'pending',
    requestedAt: values.get('requestedAt') ?? '',
  };
  return isValidRequest(request) ? request : null;
}

export function parseRecoveryRepairReceipt(text: string): RecoveryRepairReceipt | null {
  const values = parseSection(text, 'RepairResult', [
    'protocol',
    'transactionId',
    'buildId',
    'version',
    'targetCommitish',
    'runtimeSha512',
    'installerSha256',
    'completedAt',
  ]);
  if (values?.get('protocol') !== '2') return null;
  const receipt: RecoveryRepairReceipt = {
    protocol: 2,
    transactionId: values.get('transactionId') ?? '',
    buildId: values.get('buildId') ?? '',
    version: values.get('version') ?? '',
    targetCommitish: values.get('targetCommitish') ?? '',
    runtimeSha512: values.get('runtimeSha512')!.toLowerCase(),
    installerSha256: values.get('installerSha256') ?? '',
    completedAt: values.get('completedAt') ?? '',
  };
  return isValidReceipt(receipt) ? receipt : null;
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
  const [realRelayRoot, stats, realRecoveryDirectory] = await Promise.all([
    realpath(relayRoot),
    lstat(recoveryDirectory),
    realpath(recoveryDirectory),
  ]);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !isDirectChild(realRelayRoot, realRecoveryDirectory, 'Recovery')
  ) {
    throw new Error('Relay recovery directory was redirected');
  }
  return realRecoveryDirectory;
}

export async function writeRecoveryRepairRequest(
  relayRoot: string,
  request: RecoveryRepairRequest,
  createPrivateDirectory: (path: string) => unknown,
): Promise<string> {
  const contents = serializeRecoveryRepairRequest(request);
  const recoveryDirectory = await resolveRecoveryDirectory(relayRoot, createPrivateDirectory);
  const requestPath = join(recoveryDirectory, REQUEST_FILE);
  const temporaryPath = join(recoveryDirectory, `.repair-request.${randomUUID()}.tmp`);
  await replaceFileDurably(temporaryPath, requestPath, contents, { mode: 0o600, exclusive: true });
  return requestPath;
}

export async function readRecoveryRepairReceipt(
  relayRoot: string,
): Promise<RecoveryRepairReceipt | null> {
  let recoveryDirectory: string;
  try {
    recoveryDirectory = await resolveRecoveryDirectory(relayRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const receiptPath = join(recoveryDirectory, RECEIPT_FILE);
  try {
    const receipt = await readRegularFile(receiptPath, { maxBytes: MAX_FILE_BYTES });
    if (!receipt) throw new Error('Relay repair receipt was redirected');
    return parseRecoveryRepairReceipt(receipt.toString('utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function recoveryRepairArtifactPaths(relayRoot: string): {
  requestPath: string;
  receiptPath: string;
} {
  const recoveryDirectory = join(relayRoot, 'Recovery');
  return {
    requestPath: join(recoveryDirectory, REQUEST_FILE),
    receiptPath: join(recoveryDirectory, RECEIPT_FILE),
  };
}
