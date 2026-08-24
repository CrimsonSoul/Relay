import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import {
  isRecoveryBuildRecord,
  type RecoveryBuildRecord,
  type RecoveryInstallationMode,
} from './RecoveryCatalog';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_REQUEST_BYTES = 32 * 1_024;
const REQUEST_FILE = 'update-request.ini';

export type RecoveryUpdateRequest = {
  protocol: 2;
  transactionId: string;
  source: RecoveryBuildRecord;
  targetVersion: string;
  targetCommitish: string;
  targetInstallerSha256: string;
  mode: RecoveryInstallationMode;
  checkpoint: 'pending' | 'complete';
  snapshotId: string | null;
  requestedAt: string;
};

type Ini = Map<string, Map<string, string>>;
type IniParseState = { current: Map<string, string> | null };

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function parseInteger(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function acceptIniLine(rawLine: string, sections: Ini, state: IniParseState): boolean {
  if (rawLine.length > 4_096) return false;
  const line = rawLine.trim();
  if (!line) return true;
  if (line.startsWith('[') && line.endsWith(']')) {
    const name = line.slice(1, -1);
    if (!name || sections.has(name)) return false;
    state.current = new Map();
    sections.set(name, state.current);
    return true;
  }
  if (!state.current) return false;
  const separator = line.indexOf('=');
  if (separator <= 0) return false;
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!key || state.current.has(key)) return false;
  state.current.set(key, value);
  return true;
}

function parseIni(text: string): Ini | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES || text.includes('\0')) return null;
  const sections: Ini = new Map();
  const state: IniParseState = { current: null };
  for (const rawLine of text.split(/\r?\n/u)) {
    if (!acceptIniLine(rawLine, sections, state)) return null;
  }
  return sections;
}

function hasExactKeys(section: Map<string, string>, expected: readonly string[]): boolean {
  return (
    section.size === expected.length && [...section.keys()].every((key) => expected.includes(key))
  );
}

function isRecoveryUpdateRequest(value: RecoveryUpdateRequest): boolean {
  return (
    value.protocol === 2 &&
    UUID_V4_PATTERN.test(value.transactionId) &&
    isRecoveryBuildRecord(value.source) &&
    value.source.health === 'healthy' &&
    value.source.rollbackSnapshotId === null &&
    VERSION_PATTERN.test(value.targetVersion) &&
    COMMIT_PATTERN.test(value.targetCommitish) &&
    SHA256_PATTERN.test(value.targetInstallerSha256) &&
    (value.mode === 'server' || value.mode === 'client' || value.mode === 'unconfigured') &&
    (value.checkpoint === 'pending' || value.checkpoint === 'complete') &&
    ((value.checkpoint === 'pending' && value.snapshotId === null) ||
      (value.checkpoint === 'complete' &&
        (value.mode === 'server'
          ? value.snapshotId !== null && UUID_V4_PATTERN.test(value.snapshotId)
          : value.snapshotId === null))) &&
    isCanonicalTimestamp(value.requestedAt)
  );
}

export function parseRecoveryUpdateRequest(text: string): RecoveryUpdateRequest | null {
  const ini = parseIni(text);
  const request = ini?.get('RecoveryRequest');
  const source = ini?.get('Source');
  const requestKeys = [
    'protocol',
    'transactionId',
    'targetVersion',
    'targetCommitish',
    'targetInstallerSha256',
    'mode',
    'checkpoint',
    'snapshotId',
    'requestedAt',
  ] as const;
  const sourceKeys = [
    'buildId',
    'version',
    'releaseTag',
    'targetCommitish',
    'runtimeSha512',
    'installerSha256',
    'recoveryProtocol',
    'serverDataEpoch',
    'clientDataEpoch',
    'installedAt',
    'health',
    'rollbackSnapshotId',
  ] as const;
  if (
    ini?.size !== 2 ||
    !request ||
    !source ||
    !hasExactKeys(request, requestKeys) ||
    !hasExactKeys(source, sourceKeys)
  ) {
    return null;
  }

  const recoveryProtocol = parseInteger(source.get('recoveryProtocol'));
  const serverDataEpoch = parseInteger(source.get('serverDataEpoch'));
  const clientDataEpoch = parseInteger(source.get('clientDataEpoch'));
  const mode = request.get('mode');
  const checkpoint = request.get('checkpoint');
  const health = source.get('health');
  if (
    recoveryProtocol === null ||
    serverDataEpoch === null ||
    clientDataEpoch === null ||
    (mode !== 'server' && mode !== 'client' && mode !== 'unconfigured') ||
    (checkpoint !== 'pending' && checkpoint !== 'complete') ||
    health !== 'healthy'
  ) {
    return null;
  }

  const parsed: RecoveryUpdateRequest = {
    protocol: 2,
    transactionId: request.get('transactionId') ?? '',
    source: {
      buildId: source.get('buildId') ?? '',
      version: source.get('version') ?? '',
      releaseTag: source.get('releaseTag') ?? '',
      targetCommitish: source.get('targetCommitish') ?? '',
      runtimeSha512: source.get('runtimeSha512') ?? '',
      installerSha256: source.get('installerSha256') || null,
      recoveryProtocol,
      serverDataEpoch,
      clientDataEpoch,
      installedAt: source.get('installedAt') ?? '',
      health,
      rollbackSnapshotId: source.get('rollbackSnapshotId') || null,
    },
    targetVersion: request.get('targetVersion') ?? '',
    targetCommitish: request.get('targetCommitish') ?? '',
    targetInstallerSha256: request.get('targetInstallerSha256') ?? '',
    mode,
    checkpoint,
    snapshotId: request.get('snapshotId') || null,
    requestedAt: request.get('requestedAt') ?? '',
  };
  return isRecoveryUpdateRequest(parsed) ? parsed : null;
}

export function serializeRecoveryUpdateRequest(request: RecoveryUpdateRequest): string {
  if (!isRecoveryUpdateRequest(request)) {
    throw new TypeError('Recovery update request was invalid');
  }
  const source = request.source;
  return `${[
    '[RecoveryRequest]',
    'protocol=2',
    `transactionId=${request.transactionId}`,
    `targetVersion=${request.targetVersion}`,
    `targetCommitish=${request.targetCommitish}`,
    `targetInstallerSha256=${request.targetInstallerSha256}`,
    `mode=${request.mode}`,
    `checkpoint=${request.checkpoint}`,
    `snapshotId=${request.snapshotId ?? ''}`,
    `requestedAt=${request.requestedAt}`,
    '',
    '[Source]',
    `buildId=${source.buildId}`,
    `version=${source.version}`,
    `releaseTag=${source.releaseTag}`,
    `targetCommitish=${source.targetCommitish}`,
    `runtimeSha512=${source.runtimeSha512}`,
    `installerSha256=${source.installerSha256 ?? ''}`,
    `recoveryProtocol=${source.recoveryProtocol}`,
    `serverDataEpoch=${source.serverDataEpoch}`,
    `clientDataEpoch=${source.clientDataEpoch}`,
    `installedAt=${source.installedAt}`,
    `health=${source.health}`,
    `rollbackSnapshotId=${source.rollbackSnapshotId ?? ''}`,
  ].join('\r\n')}\r\n`;
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

  const [relayRealPath, recoveryStats, recoveryRealPath] = await Promise.all([
    realpath(relayRoot),
    lstat(recoveryDirectory),
    realpath(recoveryDirectory),
  ]);
  if (
    !recoveryStats.isDirectory() ||
    recoveryStats.isSymbolicLink() ||
    !isDirectChild(relayRealPath, recoveryRealPath, 'Recovery')
  ) {
    throw new Error('Relay recovery directory was redirected');
  }
  return recoveryDirectory;
}

export async function writeRecoveryUpdateRequest(
  relayRoot: string,
  request: RecoveryUpdateRequest,
  createPrivateDirectory: (path: string) => unknown,
): Promise<string> {
  const serialized = serializeRecoveryUpdateRequest(request);
  const recoveryDirectory = await resolveRecoveryDirectory(relayRoot, createPrivateDirectory);

  const requestPath = join(recoveryDirectory, REQUEST_FILE);
  const temporaryPath = join(recoveryDirectory, `.update-request.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, requestPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return requestPath;
}

export async function readRecoveryUpdateRequest(
  relayRoot: string,
): Promise<RecoveryUpdateRequest | null> {
  let recoveryDirectory: string;
  try {
    recoveryDirectory = await resolveRecoveryDirectory(relayRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const requestPath = join(recoveryDirectory, REQUEST_FILE);
  try {
    const requestStats = await lstat(requestPath);
    if (
      !requestStats.isFile() ||
      requestStats.isSymbolicLink() ||
      requestStats.size > MAX_REQUEST_BYTES
    ) {
      throw new Error('Recovery update request was redirected');
    }
    return parseRecoveryUpdateRequest(await readFile(requestPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function completeRecoveryUpdateRequest(
  relayRoot: string,
  transactionId: string,
  snapshotId: string | null,
): Promise<RecoveryUpdateRequest> {
  const request = await readRecoveryUpdateRequest(relayRoot);
  if (request?.transactionId !== transactionId) {
    throw new Error('Recovery update transaction did not match');
  }
  const completed: RecoveryUpdateRequest = {
    ...request,
    checkpoint: 'complete',
    snapshotId,
  };
  await writeRecoveryUpdateRequest(relayRoot, completed, () => {
    throw new Error('Recovery directory disappeared');
  });
  return completed;
}
