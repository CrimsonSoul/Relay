import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDirectoryRedirect } from '../__tests__/filesystemTestUtils';
import { serializeRecoveryCatalog, type RecoveryCatalog } from './RecoveryCatalog';
import {
  createRecoveryProbationController,
  parseRecoveryProbationArgument,
  resolveRecoveryProbationContext,
  writeRecoveryProbationReceipt,
} from './RecoveryProbation';

const TRANSACTION_ID = '123e4567-e89b-42d3-a456-426614174000';
const SOURCE_BUILD = `r1-${'a'.repeat(40)}`;
const TARGET_BUILD = `r2-${'b'.repeat(40)}`;
const SHA512 = 'c'.repeat(128);
const SHA256 = 'd'.repeat(64);
const roots: string[] = [];

function catalog(): RecoveryCatalog {
  return {
    protocol: 2,
    generation: 2,
    currentBuildId: SOURCE_BUILD,
    candidateBuildId: TARGET_BUILD,
    previousBuildIds: [],
    failedReleaseFingerprints: [],
    builds: [
      {
        buildId: SOURCE_BUILD,
        version: '1.6.0',
        releaseTag: 'v1.6.0',
        targetCommitish: 'a'.repeat(40),
        runtimeSha512: SHA512,
        installerSha256: null,
        recoveryProtocol: 2,
        serverDataEpoch: 1,
        clientDataEpoch: 1,
        installedAt: '2026-08-24T12:00:00.000Z',
        health: 'healthy',
        rollbackSnapshotId: null,
      },
      {
        buildId: TARGET_BUILD,
        version: '1.7.0',
        releaseTag: 'v1.7.0',
        targetCommitish: 'b'.repeat(40),
        runtimeSha512: SHA512,
        installerSha256: SHA256,
        recoveryProtocol: 2,
        serverDataEpoch: 1,
        clientDataEpoch: 1,
        installedAt: '2026-08-24T12:01:00.000Z',
        health: 'candidate',
        rollbackSnapshotId: null,
      },
    ],
    transaction: {
      id: TRANSACTION_ID,
      kind: 'update',
      phase: 'probation',
      sourceBuildId: SOURCE_BUILD,
      targetBuildId: TARGET_BUILD,
      mode: 'server',
      snapshotId: '123e4567-e89b-42d3-a456-426614174001',
      attempts: 1,
      requestedAt: '2026-08-24T12:00:30.000Z',
    },
  };
}

async function makeInstallation() {
  const relayRoot = await mkdtemp(join(tmpdir(), 'relay-probation-'));
  roots.push(relayRoot);
  const runtime = join(relayRoot, 'Runtime', TARGET_BUILD);
  await mkdir(runtime, { recursive: true });
  const execPath = join(runtime, 'Relay.exe');
  await writeFile(execPath, 'binary');
  await mkdir(join(relayRoot, 'Recovery'));
  await writeFile(join(relayRoot, 'state.ini'), serializeRecoveryCatalog(catalog()));
  return { relayRoot, execPath };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.useRealTimers();
});

describe('recovery probation', () => {
  it('recognizes exactly one canonical probation transaction argument', () => {
    expect(
      parseRecoveryProbationArgument(['Relay.exe', `--relay-recovery-probation=${TRANSACTION_ID}`]),
    ).toEqual({ requested: true, transactionId: TRANSACTION_ID });
    expect(parseRecoveryProbationArgument(['Relay.exe'])).toEqual({ requested: false });
    expect(
      parseRecoveryProbationArgument([
        'Relay.exe',
        `--relay-recovery-probation=${TRANSACTION_ID}`,
        `--relay-recovery-probation=${TRANSACTION_ID}`,
      ]),
    ).toEqual({ requested: true, transactionId: null });
    expect(
      parseRecoveryProbationArgument(['Relay.exe', '--relay-recovery-probation=../bad']),
    ).toEqual({ requested: true, transactionId: null });
  });

  it('binds probation to the exact candidate, transaction, and executing runtime', async () => {
    const installation = await makeInstallation();
    const realRelayRoot = await realpath(installation.relayRoot);
    await expect(
      resolveRecoveryProbationContext({
        ...installation,
        transactionId: TRANSACTION_ID,
      }),
    ).resolves.toEqual({
      transactionId: TRANSACTION_ID,
      buildId: TARGET_BUILD,
      relayRoot: realRelayRoot,
      resultPath: join(realRelayRoot, 'Recovery', 'probation-result.ini'),
    });

    await expect(
      resolveRecoveryProbationContext({
        ...installation,
        transactionId: '123e4567-e89b-42d3-a456-426614174099',
      }),
    ).rejects.toThrow('did not match');
  });

  it('rejects a redirected Recovery directory before accepting probation', async () => {
    const installation = await makeInstallation();
    const outside = await mkdtemp(join(tmpdir(), 'relay-probation-outside-'));
    roots.push(outside);
    const { rm } = await import('node:fs/promises');
    await rm(join(installation.relayRoot, 'Recovery'), { recursive: true });
    await createDirectoryRedirect(outside, join(installation.relayRoot, 'Recovery'));

    await expect(
      resolveRecoveryProbationContext({
        ...installation,
        transactionId: TRANSACTION_ID,
      }),
    ).rejects.toThrow('redirected');
  });

  it('reports health only after both milestones remain healthy for sixty seconds', async () => {
    vi.useFakeTimers();
    const writeHealthyReceipt = vi.fn().mockResolvedValue(undefined);
    const complete = vi.fn();
    let healthy = true;
    const controller = createRecoveryProbationController({
      durationMs: 60_000,
      isHealthy: () => healthy,
      writeHealthyReceipt,
      complete,
      now: () => Date.now(),
    });

    controller.markRendererMounted();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writeHealthyReceipt).not.toHaveBeenCalled();

    controller.markLocalStartupComplete();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(writeHealthyReceipt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(writeHealthyReceipt).toHaveBeenCalledWith(60_000);
    expect(complete).toHaveBeenCalledWith(true);

    const failed = createRecoveryProbationController({
      durationMs: 60_000,
      isHealthy: () => healthy,
      writeHealthyReceipt,
      complete,
      now: () => Date.now(),
    });
    failed.markRendererMounted();
    failed.markLocalStartupComplete();
    healthy = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(complete).toHaveBeenLastCalledWith(false);
  });

  it('fails closed when startup never reaches both probation milestones', async () => {
    vi.useFakeTimers();
    const complete = vi.fn();
    createRecoveryProbationController({
      durationMs: 60_000,
      startupDeadlineMs: 120_000,
      isHealthy: () => true,
      writeHealthyReceipt: vi.fn(),
      complete,
    });

    await vi.advanceTimersByTimeAsync(119_999);
    expect(complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(complete).toHaveBeenCalledWith(false);
  });

  it('writes a canonical probation receipt atomically', async () => {
    const installation = await makeInstallation();
    const context = await resolveRecoveryProbationContext({
      ...installation,
      transactionId: TRANSACTION_ID,
    });
    await writeRecoveryProbationReceipt(context, 60_250);

    await expect(readFile(context.resultPath, 'utf8')).resolves.toBe(
      `${[
        '[Probation]',
        'protocol=2',
        `transactionId=${TRANSACTION_ID}`,
        `buildId=${TARGET_BUILD}`,
        'status=healthy',
        'durationMs=60250',
      ].join('\r\n')}\r\n`,
    );
  });
});
