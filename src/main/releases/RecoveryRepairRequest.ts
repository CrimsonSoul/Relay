import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

const BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHA512_PATTERN = /^[0-9a-f]{128}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_FILE_BYTES = 16 * 1_024;
const REQUEST_FILE = 'repair-request.ini';
const RECEIPT_FILE = 'repair-result.ini';
const RESERVED_WINDOWS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

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

function isBuildId(value: string): boolean {
  if (!BUILD_ID_PATTERN.test(value) || value.endsWith('.')) return false;
  return !RESERVED_WINDOWS_NAMES.has(value.split('.', 1)[0] ?? value);
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

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

function acceptSectionLine(
  sourceLine: string,
  sectionName: string,
  expectedKeys: ReadonlySet<string>,
  values: Map<string, string>,
  state: { inSection: boolean },
): boolean {
  if (sourceLine.length > 4_096) return false;
  const line = sourceLine.trim();
  if (!line) return true;
  if (line.startsWith('[') && line.endsWith(']')) {
    if (state.inSection || line !== `[${sectionName}]`) return false;
    state.inSection = true;
    return true;
  }
  if (!state.inSection) return false;
  const separator = line.indexOf('=');
  if (separator <= 0) return false;
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!expectedKeys.has(key) || values.has(key)) return false;
  values.set(key, value);
  return true;
}

function parseSection(
  text: string,
  sectionName: string,
  expectedKeys: readonly string[],
): Map<string, string> | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES || text.includes('\0')) return null;
  const values = new Map<string, string>();
  const expected = new Set(expectedKeys);
  const state = { inSection: false };
  for (const sourceLine of text.split(/\r?\n/u)) {
    if (!acceptSectionLine(sourceLine, sectionName, expected, values, state)) return null;
  }
  return state.inSection && values.size === expectedKeys.length ? values : null;
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

export function serializeRecoveryRepairReceipt(receipt: RecoveryRepairReceipt): string {
  if (!isValidReceipt(receipt)) throw new TypeError('Recovery repair receipt was invalid');
  return `${[
    '[RepairResult]',
    'protocol=2',
    `transactionId=${receipt.transactionId}`,
    `buildId=${receipt.buildId}`,
    `version=${receipt.version}`,
    `targetCommitish=${receipt.targetCommitish}`,
    `runtimeSha512=${receipt.runtimeSha512}`,
    `installerSha256=${receipt.installerSha256}`,
    `completedAt=${receipt.completedAt}`,
  ].join('\r\n')}\r\n`;
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
    runtimeSha512: values.get('runtimeSha512') ?? '',
    installerSha256: values.get('installerSha256') ?? '',
    completedAt: values.get('completedAt') ?? '',
  };
  return isValidReceipt(receipt) ? receipt : null;
}

function isDirectChild(parent: string, child: string, expectedName: string): boolean {
  const childRelative = relative(parent, child);
  return !isAbsolute(childRelative) && childRelative === expectedName;
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
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, requestPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
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
    const stats = await lstat(receiptPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_FILE_BYTES) {
      throw new Error('Relay repair receipt was redirected');
    }
    return parseRecoveryRepairReceipt(await readFile(receiptPath, 'utf8'));
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
