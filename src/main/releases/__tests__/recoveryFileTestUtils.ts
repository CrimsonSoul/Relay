import {
  parseRecoveryCatalog,
  type RecoveryBuildRecord,
  type RecoveryCatalog,
} from '../RecoveryCatalog';
import { parseRecoveryRepairReceipt, type RecoveryRepairReceipt } from '../RecoveryRepairRequest';

/**
 * Fixture writers for files only the native recovery bootstrap produces in production
 * (`state.ini` and `Recovery/repair-result.ini`). Each output is checked against the
 * production parser, so a fixture the app would reject fails loudly with a TypeError.
 */

function buildLines(build: RecoveryBuildRecord): string[] {
  return [
    '',
    `[Build.${build.buildId}]`,
    `version=${build.version}`,
    `releaseTag=${build.releaseTag}`,
    `targetCommitish=${build.targetCommitish}`,
    `runtimeSha512=${build.runtimeSha512}`,
    `installerSha256=${build.installerSha256 ?? ''}`,
    `recoveryProtocol=${build.recoveryProtocol}`,
    `serverDataEpoch=${build.serverDataEpoch}`,
    `clientDataEpoch=${build.clientDataEpoch}`,
    `installedAt=${build.installedAt}`,
    `health=${build.health}`,
    `rollbackSnapshotId=${build.rollbackSnapshotId ?? ''}`,
  ];
}

export function serializeRecoveryCatalog(catalog: RecoveryCatalog): string {
  const lines = [
    '[Relay]',
    'protocol=2',
    `generation=${catalog.generation}`,
    `current=${catalog.currentBuildId}`,
    `candidate=${catalog.candidateBuildId ?? ''}`,
    `previous0=${catalog.previousBuildIds[0] ?? ''}`,
    `previous1=${catalog.previousBuildIds[1] ?? ''}`,
    `previous2=${catalog.previousBuildIds[2] ?? ''}`,
    `failedReleaseFingerprints=${catalog.failedReleaseFingerprints.join(',')}`,
    ...catalog.builds.flatMap(buildLines),
  ];
  const transaction = catalog.transaction;
  if (transaction) {
    lines.push(
      '',
      '[Transaction]',
      `id=${transaction.id}`,
      `kind=${transaction.kind}`,
      `phase=${transaction.phase}`,
      `sourceBuildId=${transaction.sourceBuildId}`,
      `targetBuildId=${transaction.targetBuildId}`,
      `mode=${transaction.mode}`,
      `snapshotId=${transaction.snapshotId ?? ''}`,
      `attempts=${transaction.attempts}`,
      `requestedAt=${transaction.requestedAt}`,
    );
  }
  const text = `${lines.join('\r\n')}\r\n`;
  if (!parseRecoveryCatalog(text)) throw new TypeError('Recovery catalog was invalid');
  return text;
}

export function serializeRecoveryRepairReceipt(receipt: RecoveryRepairReceipt): string {
  const text = `${[
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
  if (!parseRecoveryRepairReceipt(text)) throw new TypeError('Recovery repair receipt was invalid');
  return text;
}
