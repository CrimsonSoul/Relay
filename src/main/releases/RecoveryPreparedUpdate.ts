import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { hasExactRecoveryKeys, parseRecoveryIni } from './RecoveryUpdateRequest';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHA512_PATTERN = /^[0-9a-f]{128}$/u;
const BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_PREPARED_BYTES = 32 * 1_024;
const PREPARED_FILE = 'prepared.ini';

export type RecoveryPreparedUpdate = Readonly<{
  protocol: 2;
  transactionId: string;
  buildId: string;
  version: string;
  releaseTag: string;
  targetCommitish: string;
  runtimeSha512: string;
  installerSha256: string;
  recoveryProtocol: number;
  serverDataEpoch: number;
  clientDataEpoch: number;
  preparedAt: string;
  health: 'candidate';
}>;

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function parseRecoveryPreparedUpdate(text: string): RecoveryPreparedUpdate | null {
  const sections = parseRecoveryIni(text, MAX_PREPARED_BYTES);
  const prepared = sections?.get('Prepared');
  const expectedKeys = [
    'protocol',
    'transactionId',
    'buildId',
    'version',
    'releaseTag',
    'targetCommitish',
    'runtimeSha512',
    'installerSha256',
    'recoveryProtocol',
    'serverDataEpoch',
    'clientDataEpoch',
    'preparedAt',
    'health',
  ] as const;
  if (sections?.size !== 1 || !prepared || !hasExactRecoveryKeys(prepared, expectedKeys)) {
    return null;
  }

  const transactionId = prepared.get('transactionId') ?? '';
  const buildId = prepared.get('buildId') ?? '';
  const version = prepared.get('version') ?? '';
  const releaseTag = prepared.get('releaseTag') ?? '';
  const targetCommitish = prepared.get('targetCommitish') ?? '';
  const runtimeSha512 = prepared.get('runtimeSha512')!.toLowerCase();
  const installerSha256 = prepared.get('installerSha256') ?? '';
  const recoveryProtocol = parsePositiveInteger(prepared.get('recoveryProtocol'));
  const serverDataEpoch = parsePositiveInteger(prepared.get('serverDataEpoch'));
  const clientDataEpoch = parsePositiveInteger(prepared.get('clientDataEpoch'));
  const preparedAt = prepared.get('preparedAt') ?? '';
  if (
    prepared.get('protocol') !== '2' ||
    !UUID_V4_PATTERN.test(transactionId) ||
    !BUILD_ID_PATTERN.test(buildId) ||
    !VERSION_PATTERN.test(version) ||
    releaseTag !== `v${version}` ||
    !COMMIT_PATTERN.test(targetCommitish) ||
    !SHA512_PATTERN.test(runtimeSha512) ||
    !SHA256_PATTERN.test(installerSha256) ||
    recoveryProtocol === null ||
    serverDataEpoch === null ||
    clientDataEpoch === null ||
    !isCanonicalTimestamp(preparedAt) ||
    prepared.get('health') !== 'candidate'
  ) {
    return null;
  }

  return {
    protocol: 2,
    transactionId,
    buildId,
    version,
    releaseTag,
    targetCommitish,
    runtimeSha512,
    installerSha256,
    recoveryProtocol,
    serverDataEpoch,
    clientDataEpoch,
    preparedAt,
    health: 'candidate',
  };
}

export async function readRecoveryPreparedUpdate(
  relayRoot: string,
): Promise<RecoveryPreparedUpdate | null> {
  const recoveryDirectory = join(relayRoot, 'Recovery');
  let realRecoveryDirectory: string;
  try {
    const [relayStats, recoveryStats, resolvedRelayRoot, resolvedRecoveryDirectory] =
      await Promise.all([
        lstat(relayRoot),
        lstat(recoveryDirectory),
        realpath(relayRoot),
        realpath(recoveryDirectory),
      ]);
    if (
      !relayStats.isDirectory() ||
      relayStats.isSymbolicLink() ||
      !recoveryStats.isDirectory() ||
      recoveryStats.isSymbolicLink() ||
      relative(resolvedRelayRoot, resolvedRecoveryDirectory) !== 'Recovery'
    ) {
      throw new Error('Relay recovery directory was redirected');
    }
    realRecoveryDirectory = resolvedRecoveryDirectory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const preparedPath = join(recoveryDirectory, PREPARED_FILE);
  try {
    const [preparedStats, resolvedPreparedPath] = await Promise.all([
      lstat(preparedPath),
      realpath(preparedPath),
    ]);
    const preparedRelativePath = relative(realRecoveryDirectory, resolvedPreparedPath);
    if (
      !preparedStats.isFile() ||
      preparedStats.isSymbolicLink() ||
      preparedStats.size <= 0 ||
      preparedStats.size > MAX_PREPARED_BYTES ||
      preparedRelativePath !== PREPARED_FILE
    ) {
      throw new Error('Relay prepared receipt was redirected or invalid');
    }
    return parseRecoveryPreparedUpdate(await readFile(resolvedPreparedPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
