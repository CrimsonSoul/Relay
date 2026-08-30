import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import {
  runManualUpdateCheckpoint,
  type ManualUpdateCheckpointOptions,
} from './ManualUpdateCheckpoint';
import { startManualUpdateCheckpointProcess } from './ManualUpdateCheckpointProcess';
import { parseManualUpdateCheckpointArgument } from './RecoveryLaunchIntent';
import type { RecoveryUpdateRequest } from './RecoveryUpdateRequest';

const TRANSACTION_ID = '11111111-2222-4333-8444-555555555555';
const SNAPSHOT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function pendingRequest(): RecoveryUpdateRequest {
  return {
    protocol: 2,
    transactionId: TRANSACTION_ID,
    source: {
      buildId: 'r1-1111111111111111111111111111111111111111',
      version: '1.9.6',
      releaseTag: 'v1.9.6',
      targetCommitish: '1'.repeat(40),
      runtimeSha512: 'a'.repeat(128),
      installerSha256: 'b'.repeat(64),
      recoveryProtocol: 2,
      serverDataEpoch: 1,
      clientDataEpoch: 1,
      installedAt: '2026-08-30T05:56:00.000Z',
      health: 'healthy',
      rollbackSnapshotId: null,
    },
    targetVersion: '1.9.7',
    targetCommitish: '2'.repeat(40),
    targetInstallerSha256: 'c'.repeat(64),
    mode: 'unconfigured',
    checkpoint: 'pending',
    snapshotId: null,
    requestedAt: '2026-08-30T06:00:00.000Z',
  };
}

function options(mode: 'server' | 'client' | 'unconfigured'): ManualUpdateCheckpointOptions {
  return {
    transactionId: TRANSACTION_ID,
    relayRoot: 'C:/Relay',
    userDataRoot: 'C:/RelayData',
    readRequest: vi.fn(async () => pendingRequest()),
    loadConfiguration: vi.fn((): ReturnType<ManualUpdateCheckpointOptions['loadConfiguration']> =>
      mode === 'unconfigured' ? { status: 'absent' } : { status: 'loaded', mode },
    ),
    checkpointClient: vi.fn(() => true),
    createServerSnapshot: vi.fn(async () => ({ snapshotId: SNAPSHOT_ID })),
    completeRequest: vi.fn(async () => undefined),
  };
}

describe('ManualUpdateCheckpoint', () => {
  it('starts the checkpoint after readiness without blocking entry evaluation', async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    let checkpointRuns = 0;
    const exitCodes: number[] = [];
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    const result = startManualUpdateCheckpointProcess({
      whenReady: () => ready,
      runCheckpoint: async () => {
        checkpointRuns += 1;
      },
      exit: (code) => {
        exitCodes.push(code);
        resolveExit();
      },
      reportFailure: () => undefined,
      timeoutMs: 10_000,
    });

    expect(result).toBeUndefined();
    expect(checkpointRuns).toBe(0);

    resolveReady();
    await exited;

    expect(checkpointRuns).toBe(1);
    expect(exitCodes).toEqual([0]);
  });

  it('exits with failure when readiness exceeds the checkpoint deadline', async () => {
    vi.useFakeTimers();
    try {
      const failures: unknown[] = [];
      const exitCodes: number[] = [];

      startManualUpdateCheckpointProcess({
        whenReady: () => new Promise(() => undefined),
        runCheckpoint: async () => undefined,
        exit: (code) => exitCodes.push(code),
        reportFailure: (error) => failures.push(error),
        timeoutMs: 195_000,
      });

      await vi.advanceTimersByTimeAsync(194_999);
      expect(exitCodes).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);

      expect(exitCodes).toEqual([1]);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toEqual(new Error('Manual update checkpoint timed out'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts only an exact packaged Windows checkpoint transaction', () => {
    expect(
      parseManualUpdateCheckpointArgument(
        ['Relay.exe', '--relay-manual-update-checkpoint', `/relay-transaction=${TRANSACTION_ID}`],
        'win32',
        true,
      ),
    ).toBe(TRANSACTION_ID);
    expect(
      parseManualUpdateCheckpointArgument(
        ['Relay.exe', '--relay-manual-update-checkpoint', '/relay-transaction=bad'],
        'win32',
        true,
      ),
    ).toBeNull();
    expect(
      parseManualUpdateCheckpointArgument(
        ['Relay.exe', '--relay-manual-update-checkpoint', `/relay-transaction=${TRANSACTION_ID}`],
        'linux',
        true,
      ),
    ).toBeNull();
  });

  it('snapshots stopped server data before completing the request', async () => {
    const input = options('server');

    await expect(runManualUpdateCheckpoint(input)).resolves.toBeUndefined();

    expect(input.createServerSnapshot).toHaveBeenCalledWith({
      userDataRoot: 'C:/RelayData',
      dataDirectory: join('C:/RelayData', 'data'),
      transactionId: TRANSACTION_ID,
      sourceBuildId: pendingRequest().source.buildId,
      dataEpoch: 1,
    });
    expect(input.completeRequest).toHaveBeenCalledWith('server', SNAPSHOT_ID);
    expect(input.checkpointClient).not.toHaveBeenCalled();
  });

  it('checkpoints client stores before completing without a server snapshot', async () => {
    const input = options('client');

    await runManualUpdateCheckpoint(input);

    expect(input.checkpointClient).toHaveBeenCalledWith(join('C:/RelayData', 'data', 'cache.db'));
    expect(input.createServerSnapshot).not.toHaveBeenCalled();
    expect(input.completeRequest).toHaveBeenCalledWith('client', null);
  });

  it('refuses an unreadable configured workspace before data preparation', async () => {
    const input = options('server');
    input.loadConfiguration = () => ({
      status: 'unreadable',
      reason: 'config could not be decrypted',
    });

    await expect(runManualUpdateCheckpoint(input)).rejects.toThrow(/could not be decrypted/i);
    expect(input.createServerSnapshot).not.toHaveBeenCalled();
    expect(input.checkpointClient).not.toHaveBeenCalled();
    expect(input.completeRequest).not.toHaveBeenCalled();
  });

  it('refuses a mismatched or already completed transaction', async () => {
    const input = options('server');
    input.readRequest = async () => ({
      ...pendingRequest(),
      checkpoint: 'complete',
      snapshotId: SNAPSHOT_ID,
      mode: 'server',
    });

    await expect(runManualUpdateCheckpoint(input)).rejects.toThrow(/pending transaction/i);
    expect(input.completeRequest).not.toHaveBeenCalled();
  });
});
