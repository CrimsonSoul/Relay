import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { RecoveryInstallationMode } from './RecoveryCatalog';

const BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_REQUEST_BYTES = 16 * 1_024;
const REQUEST_FILE = 'rollback-request.ini';
const ROLLBACK_REQUEST_KEYS = new Set([
  'protocol',
  'transactionId',
  'sourceBuildId',
  'targetBuildId',
  'mode',
  'checkpoint',
  'targetSnapshotId',
  'sourceSnapshotId',
  'requestedAt',
]);
const RESERVED_WINDOWS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

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

function isBuildId(value: string): boolean {
  if (!BUILD_ID_PATTERN.test(value) || value.endsWith('.')) return false;
  return !RESERVED_WINDOWS_NAMES.has(value.split('.', 1)[0] ?? value);
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

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

function acceptRollbackLine(
  sourceLine: string,
  values: Map<string, string>,
  state: { inSection: boolean },
): boolean {
  if (sourceLine.length > 4_096) return false;
  const line = sourceLine.trim();
  if (!line) return true;
  if (line.startsWith('[') && line.endsWith(']')) {
    if (state.inSection || line !== '[RollbackRequest]') return false;
    state.inSection = true;
    return true;
  }
  if (!state.inSection) return false;
  const separator = line.indexOf('=');
  if (separator <= 0) return false;
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!ROLLBACK_REQUEST_KEYS.has(key) || values.has(key)) return false;
  values.set(key, value);
  return true;
}

function parseRollbackValues(text: string): Map<string, string> | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES || text.includes('\0')) return null;
  const values = new Map<string, string>();
  const state = { inSection: false };
  for (const sourceLine of text.split(/\r?\n/u)) {
    if (!acceptRollbackLine(sourceLine, values, state)) return null;
  }
  return state.inSection && values.size === ROLLBACK_REQUEST_KEYS.size ? values : null;
}

export function parseRecoveryRollbackRequest(text: string): RecoveryRollbackRequest | null {
  const values = parseRollbackValues(text);
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
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, requestPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return requestPath;
}

export async function readRecoveryRollbackRequest(
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
    const stats = await lstat(requestPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_REQUEST_BYTES) {
      throw new Error('Relay rollback request was redirected');
    }
    return parseRecoveryRollbackRequest(await readFile(requestPath, 'utf8'));
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
