import { isBuildId, parseIniSections, UUID_V4_PATTERN, type IniSections } from './recoveryFormat';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHA512_PATTERN = /^[0-9a-f]{128}$/u;
const MAX_CATALOG_BYTES = 128 * 1_024;
const MAX_CATALOG_PREVIOUS_BUILDS = 3;
const MAX_FAILED_RELEASE_FINGERPRINTS = 16;

type RecoveryBuildHealth = 'healthy' | 'candidate' | 'failed';
export type RecoveryInstallationMode = 'server' | 'client' | 'unconfigured';
type RecoveryTransactionKind = 'update' | 'manual-rollback' | 'repair';
type RecoveryTransactionPhase = 'prepared' | 'snapshot-ready' | 'probation' | 'restoring';

export type RecoveryBuildRecord = {
  buildId: string;
  version: string;
  releaseTag: string;
  targetCommitish: string;
  runtimeSha512: string;
  installerSha256: string | null;
  recoveryProtocol: number;
  serverDataEpoch: number;
  clientDataEpoch: number;
  installedAt: string;
  health: RecoveryBuildHealth;
  rollbackSnapshotId: string | null;
};

type RecoveryTransaction = {
  id: string;
  kind: RecoveryTransactionKind;
  phase: RecoveryTransactionPhase;
  sourceBuildId: string;
  targetBuildId: string;
  mode: RecoveryInstallationMode;
  snapshotId: string | null;
  attempts: number;
  requestedAt: string;
};

export type RecoveryCatalog = {
  protocol: 2;
  generation: number;
  currentBuildId: string;
  candidateBuildId: string | null;
  previousBuildIds: string[];
  builds: RecoveryBuildRecord[];
  transaction: RecoveryTransaction | null;
  failedReleaseFingerprints: string[];
};

export type LegacyRecoveryState = {
  currentBuildId: string;
  previousBuildId: string | null;
};

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function parseInteger(value: string | undefined): number | null {
  if (!value || !/^(0|[1-9]\d*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nullable(value: string | undefined): string | null {
  return value || null;
}

export function isRecoveryBuildRecord(value: RecoveryBuildRecord): boolean {
  return (
    isBuildId(value.buildId) &&
    VERSION_PATTERN.test(value.version) &&
    value.releaseTag === `v${value.version}` &&
    COMMIT_PATTERN.test(value.targetCommitish) &&
    SHA512_PATTERN.test(value.runtimeSha512) &&
    (value.installerSha256 === null || SHA256_PATTERN.test(value.installerSha256)) &&
    isPositiveInteger(value.recoveryProtocol) &&
    isPositiveInteger(value.serverDataEpoch) &&
    isPositiveInteger(value.clientDataEpoch) &&
    isCanonicalTimestamp(value.installedAt) &&
    (value.health === 'healthy' || value.health === 'candidate' || value.health === 'failed') &&
    (value.rollbackSnapshotId === null || UUID_V4_PATTERN.test(value.rollbackSnapshotId))
  );
}

function isRecoveryTransaction(value: RecoveryTransaction): boolean {
  return (
    UUID_V4_PATTERN.test(value.id) &&
    (value.kind === 'update' || value.kind === 'manual-rollback' || value.kind === 'repair') &&
    (value.phase === 'prepared' ||
      value.phase === 'snapshot-ready' ||
      value.phase === 'probation' ||
      value.phase === 'restoring') &&
    isBuildId(value.sourceBuildId) &&
    isBuildId(value.targetBuildId) &&
    value.sourceBuildId !== value.targetBuildId &&
    (value.mode === 'server' || value.mode === 'client' || value.mode === 'unconfigured') &&
    (value.snapshotId === null || UUID_V4_PATTERN.test(value.snapshotId)) &&
    isNonNegativeInteger(value.attempts) &&
    value.attempts <= 2 &&
    isCanonicalTimestamp(value.requestedAt)
  );
}

function parseIni(text: string): IniSections | null {
  return parseIniSections(text, {
    maximumBytes: MAX_CATALOG_BYTES,
    maximumLineLength: 4_096,
    comments: true,
    rejectCarriageReturn: true,
  });
}

function hasOnlyKeys(section: Map<string, string>, allowed: ReadonlySet<string>): boolean {
  return [...section.keys()].every((key) => allowed.has(key));
}

function parseBuild(sectionName: string, values: Map<string, string>): RecoveryBuildRecord | null {
  const buildId = sectionName.slice('Build.'.length);
  const version = values.get('version') ?? '';
  const releaseTag = values.get('releaseTag') ?? '';
  const targetCommitish = values.get('targetCommitish') ?? '';
  const runtimeSha512 = (values.get('runtimeSha512') ?? '').toLowerCase();
  const installerSha256 = nullable(values.get('installerSha256'));
  const recoveryProtocol = parseInteger(values.get('recoveryProtocol'));
  const serverDataEpoch = parseInteger(values.get('serverDataEpoch'));
  const clientDataEpoch = parseInteger(values.get('clientDataEpoch'));
  const installedAt = values.get('installedAt') ?? '';
  const health = values.get('health');
  const rollbackSnapshotId = nullable(values.get('rollbackSnapshotId'));
  const allowed = new Set([
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
  ]);

  if (
    !hasOnlyKeys(values, allowed) ||
    values.size !== allowed.size ||
    recoveryProtocol === null ||
    serverDataEpoch === null ||
    clientDataEpoch === null ||
    (health !== 'healthy' && health !== 'candidate' && health !== 'failed')
  ) {
    return null;
  }

  const build: RecoveryBuildRecord = {
    buildId,
    version,
    releaseTag,
    targetCommitish,
    runtimeSha512,
    installerSha256,
    recoveryProtocol,
    serverDataEpoch,
    clientDataEpoch,
    installedAt,
    health,
    rollbackSnapshotId,
  };
  return isRecoveryBuildRecord(build) ? build : null;
}

function parseTransaction(values: Map<string, string>): RecoveryTransaction | null {
  const allowed = new Set([
    'id',
    'kind',
    'phase',
    'sourceBuildId',
    'targetBuildId',
    'mode',
    'snapshotId',
    'attempts',
    'requestedAt',
  ]);
  const id = values.get('id') ?? '';
  const kind = values.get('kind');
  const phase = values.get('phase');
  const sourceBuildId = values.get('sourceBuildId') ?? '';
  const targetBuildId = values.get('targetBuildId') ?? '';
  const mode = values.get('mode');
  const snapshotId = nullable(values.get('snapshotId'));
  const attempts = parseInteger(values.get('attempts'));
  const requestedAt = values.get('requestedAt') ?? '';

  if (
    !hasOnlyKeys(values, allowed) ||
    values.size !== allowed.size ||
    (kind !== 'update' && kind !== 'manual-rollback' && kind !== 'repair') ||
    (phase !== 'prepared' &&
      phase !== 'snapshot-ready' &&
      phase !== 'probation' &&
      phase !== 'restoring') ||
    (mode !== 'server' && mode !== 'client' && mode !== 'unconfigured') ||
    attempts === null
  ) {
    return null;
  }

  const transaction: RecoveryTransaction = {
    id,
    kind,
    phase,
    sourceBuildId,
    targetBuildId,
    mode,
    snapshotId,
    attempts,
    requestedAt,
  };
  return isRecoveryTransaction(transaction) ? transaction : null;
}

function hasValidCatalogReferences(catalog: RecoveryCatalog): boolean {
  return !(
    catalog.protocol !== 2 ||
    !isNonNegativeInteger(catalog.generation) ||
    !isBuildId(catalog.currentBuildId) ||
    (catalog.candidateBuildId !== null && !isBuildId(catalog.candidateBuildId)) ||
    catalog.previousBuildIds.length > MAX_CATALOG_PREVIOUS_BUILDS ||
    catalog.previousBuildIds.some((buildId) => !isBuildId(buildId)) ||
    new Set(catalog.previousBuildIds).size !== catalog.previousBuildIds.length ||
    catalog.previousBuildIds.includes(catalog.currentBuildId) ||
    catalog.candidateBuildId === catalog.currentBuildId ||
    (catalog.candidateBuildId !== null &&
      catalog.previousBuildIds.includes(catalog.candidateBuildId))
  );
}

function hasValidCatalogBuilds(
  catalog: RecoveryCatalog,
  buildMap: ReadonlyMap<string, RecoveryBuildRecord>,
): boolean {
  const buildIds = catalog.builds.map((build) => build.buildId);
  if (
    catalog.builds.some((build) => !isRecoveryBuildRecord(build)) ||
    new Set(buildIds).size !== buildIds.length ||
    !buildMap.has(catalog.currentBuildId)
  ) {
    return false;
  }
  if (catalog.previousBuildIds.some((buildId) => !buildMap.has(buildId))) return false;
  if (catalog.candidateBuildId !== null && !buildMap.has(catalog.candidateBuildId)) return false;

  const expectedBuilds = new Set([
    catalog.currentBuildId,
    ...catalog.previousBuildIds,
    ...(catalog.candidateBuildId ? [catalog.candidateBuildId] : []),
  ]);
  if (catalog.builds.some((build) => !expectedBuilds.has(build.buildId))) return false;
  if (buildMap.get(catalog.currentBuildId)?.health !== 'healthy') return false;
  if (catalog.previousBuildIds.some((buildId) => buildMap.get(buildId)?.health !== 'healthy')) {
    return false;
  }
  if (
    catalog.candidateBuildId !== null &&
    buildMap.get(catalog.candidateBuildId)?.health !== 'candidate'
  ) {
    return false;
  }

  return true;
}

function hasValidCatalogTransaction(catalog: RecoveryCatalog): boolean {
  if ((catalog.transaction === null) !== (catalog.candidateBuildId === null)) return false;
  if (
    catalog.transaction &&
    (!isRecoveryTransaction(catalog.transaction) ||
      catalog.transaction.sourceBuildId !== catalog.currentBuildId ||
      catalog.transaction.targetBuildId !== catalog.candidateBuildId)
  ) {
    return false;
  }
  return true;
}

function hasValidFailedReleaseFingerprints(catalog: RecoveryCatalog): boolean {
  return (
    catalog.failedReleaseFingerprints.length <= MAX_FAILED_RELEASE_FINGERPRINTS &&
    catalog.failedReleaseFingerprints.every(
      (value, index, all) =>
        /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)@[0-9a-f]{40}$/u.test(value) &&
        all.indexOf(value) === index,
    )
  );
}

function validateCatalog(catalog: RecoveryCatalog): boolean {
  if (!hasValidCatalogReferences(catalog)) return false;
  const buildMap = new Map(catalog.builds.map((build) => [build.buildId, build]));
  return (
    hasValidCatalogBuilds(catalog, buildMap) &&
    hasValidCatalogTransaction(catalog) &&
    hasValidFailedReleaseFingerprints(catalog)
  );
}

export function parseRecoveryCatalog(text: string): RecoveryCatalog | null {
  const ini = parseIni(text);
  const relay = ini?.get('Relay');
  if (!ini || !relay) return null;
  const relayAllowed = new Set([
    'protocol',
    'generation',
    'current',
    'candidate',
    'previous0',
    'previous1',
    'previous2',
    'failedReleaseFingerprints',
  ]);
  if (!hasOnlyKeys(relay, relayAllowed) || relay.get('protocol') !== '2') return null;

  const generation = parseInteger(relay.get('generation'));
  const currentBuildId = relay.get('current') ?? '';
  const candidateBuildId = nullable(relay.get('candidate'));
  const previousBuildIds = ['previous0', 'previous1', 'previous2'].flatMap((key) => {
    const value = relay.get(key);
    return value ? [value] : [];
  });
  // Launchers released before the WordFind fix rewrote this history with repeated entries and
  // empty slots on a second automatic rollback. Those launchers stay installed until the launcher
  // protocol changes, so read the history as the set it always meant to be.
  const failedReleaseFingerprints = [
    ...new Set((relay.get('failedReleaseFingerprints') ?? '').split(',').filter(Boolean)),
  ];
  if (generation === null) return null;

  const builds: RecoveryBuildRecord[] = [];
  for (const [sectionName, values] of ini) {
    if (!sectionName.startsWith('Build.')) continue;
    const parsed = parseBuild(sectionName, values);
    if (!parsed) return null;
    builds.push(parsed);
  }
  const transactionSection = ini.get('Transaction');
  const transaction = transactionSection ? parseTransaction(transactionSection) : null;
  if (transactionSection && !transaction) return null;
  if (
    [...ini.keys()].some(
      (sectionName) =>
        sectionName !== 'Relay' &&
        sectionName !== 'Transaction' &&
        !sectionName.startsWith('Build.'),
    )
  ) {
    return null;
  }

  const catalog: RecoveryCatalog = {
    protocol: 2,
    generation,
    currentBuildId,
    candidateBuildId,
    previousBuildIds,
    builds,
    transaction,
    failedReleaseFingerprints,
  };
  return validateCatalog(catalog) ? catalog : null;
}

export function parseLegacyRecoveryState(value: string): LegacyRecoveryState | null {
  const ini = parseIni(value);
  const relay = ini?.get('Relay');
  const allowed = new Set(['protocol', 'current', 'previous']);
  if (ini?.size !== 1 || !relay || !hasOnlyKeys(relay, allowed)) return null;
  const currentBuildId = relay.get('current') ?? '';
  const previousBuildId = nullable(relay.get('previous'));
  if (
    relay.get('protocol') !== '1' ||
    !isBuildId(currentBuildId) ||
    (previousBuildId !== null && !isBuildId(previousBuildId))
  ) {
    return null;
  }
  return { currentBuildId, previousBuildId };
}
