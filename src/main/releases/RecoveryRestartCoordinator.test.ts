import { describe, expect, it, vi } from 'vitest';
import type { RecoveryUpdateRequest } from './RecoveryUpdateRequest';
import { prepareRecoveryRestart } from './RecoveryRestartCoordinator';
import { RecoverySnapshotError } from './RecoverySnapshot';

const request: RecoveryUpdateRequest = {
  protocol: 2,
  transactionId: '11111111-2222-4333-8444-555555555555',
  source: {
    buildId: `r1-${'1'.repeat(40)}`,
    version: '1.6.0',
    releaseTag: 'v1.6.0',
    targetCommitish: '1'.repeat(40),
    runtimeSha512: 'a'.repeat(128),
    installerSha256: null,
    recoveryProtocol: 1,
    serverDataEpoch: 1,
    clientDataEpoch: 1,
    installedAt: '2026-08-24T15:00:00.000Z',
    health: 'healthy',
    rollbackSnapshotId: null,
  },
  targetVersion: '1.7.0',
  targetCommitish: '2'.repeat(40),
  targetInstallerSha256: 'b'.repeat(64),
  mode: 'server',
  checkpoint: 'pending',
  snapshotId: null,
  requestedAt: '2026-08-24T15:05:00.000Z',
};

describe('RecoveryRestartCoordinator', () => {
  it('refuses before teardown while a backup restore is running', async () => {
    const stopServer = vi.fn(async () => undefined);
    const completeRequest = vi.fn(async () => request);
    await expect(
      prepareRecoveryRestart({
        transactionId: request.transactionId,
        getRequest: async () => request,
        getCurrentMode: () => 'server',
        stopServer,
        clientDataAvailable: () => true,
        checkpointClient: () => true,
        restoreRunning: () => true,
        createServerSnapshot: async () => ({ snapshotId: 'unused' }),
        completeRequest,
      }),
    ).resolves.toBe('restore-running');
    expect(stopServer).not.toHaveBeenCalled();
    expect(completeRequest).not.toHaveBeenCalled();
  });

  it('stops the server before copying data and completes the matching request', async () => {
    const order: string[] = [];
    const completeRequest = vi.fn(async () => ({ ...request, checkpoint: 'complete' as const }));

    await expect(
      prepareRecoveryRestart({
        transactionId: request.transactionId,
        getRequest: async () => request,
        getCurrentMode: () => 'server',
        stopServer: async () => {
          order.push('stop');
        },
        clientDataAvailable: () => true,
        checkpointClient: () => true,
        createServerSnapshot: async () => {
          order.push('snapshot');
          return { snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
        },
        completeRequest,
      }),
    ).resolves.toBe('ready');

    expect(order).toEqual(['stop', 'snapshot']);
    expect(completeRequest).toHaveBeenCalledWith(
      request.transactionId,
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
  });

  it('flushes client cache and queue without requiring the remote server', async () => {
    const checkpointClient = vi.fn(() => true);
    const completeRequest = vi.fn(async () => ({
      ...request,
      mode: 'client' as const,
      checkpoint: 'complete' as const,
    }));

    await expect(
      prepareRecoveryRestart({
        transactionId: request.transactionId,
        getRequest: async () => ({ ...request, mode: 'client' }),
        getCurrentMode: () => 'client',
        stopServer: async () => undefined,
        clientDataAvailable: () => true,
        checkpointClient,
        createServerSnapshot: async () => {
          throw new Error('server snapshot should not run');
        },
        completeRequest,
      }),
    ).resolves.toBe('ready');

    expect(checkpointClient).toHaveBeenCalledOnce();
    expect(completeRequest).toHaveBeenCalledWith(request.transactionId, null);
  });

  it('fails closed before shutdown when the request or installation mode changed', async () => {
    const stopServer = vi.fn(async () => undefined);

    await expect(
      prepareRecoveryRestart({
        transactionId: request.transactionId,
        getRequest: async () => ({ ...request, mode: 'client' }),
        getCurrentMode: () => 'server',
        stopServer,
        clientDataAvailable: () => true,
        checkpointClient: () => true,
        createServerSnapshot: async () => ({
          snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        }),
        completeRequest: async () => request,
      }),
    ).resolves.toBe('unchanged');
    expect(stopServer).not.toHaveBeenCalled();
  });

  it.each([
    [
      'service shutdown',
      { stopServer: async () => Promise.reject(new Error('stop failed')) },
      'stop-services',
    ],
    [
      'snapshot creation',
      { createServerSnapshot: async () => Promise.reject(new Error('copy failed')) },
      'snapshot',
    ],
    [
      'snapshot copy of changing data',
      {
        createServerSnapshot: async () =>
          Promise.reject(new RecoverySnapshotError('changed', 'size changed')),
      },
      'snapshot-changed',
    ],
    [
      'snapshot copy of a locked file',
      {
        createServerSnapshot: async () =>
          Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })),
      },
      'snapshot-locked',
    ],
    [
      'request commit',
      { completeRequest: async () => Promise.reject(new Error('write failed')) },
      'update-request',
    ],
  ])(
    'requests a current-runtime relaunch after server %s fails post-stop',
    async (_label, override, failure) => {
      const reportFailure = vi.fn();
      await expect(
        prepareRecoveryRestart({
          transactionId: request.transactionId,
          getRequest: async () => request,
          getCurrentMode: () => 'server',
          stopServer: async () => undefined,
          clientDataAvailable: () => true,
          checkpointClient: () => true,
          createServerSnapshot: async () => ({
            snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          }),
          completeRequest: async () => request,
          reportFailure,
          ...override,
        }),
      ).resolves.toEqual({ status: 'restart-current', failure });
      expect(reportFailure).toHaveBeenCalledWith(failure, expect.any(Error));
    },
  );

  it('keeps the restart outcome when reporting the failure throws', async () => {
    await expect(
      prepareRecoveryRestart({
        transactionId: request.transactionId,
        getRequest: async () => request,
        getCurrentMode: () => 'server',
        stopServer: async () => undefined,
        clientDataAvailable: () => true,
        checkpointClient: () => true,
        createServerSnapshot: async () => Promise.reject(new Error('copy failed')),
        completeRequest: async () => request,
        reportFailure: () => {
          throw new Error('log unavailable');
        },
      }),
    ).resolves.toEqual({ status: 'restart-current', failure: 'snapshot' });
  });

  it.each([
    ['checkpoint', { checkpointClient: async () => false }, 'client-checkpoint'],
    [
      'request commit',
      { completeRequest: async () => Promise.reject(new Error('write failed')) },
      'update-request',
    ],
  ])(
    'requests a current-runtime relaunch after client %s fails post-teardown',
    async (_label, override, failure) => {
      await expect(
        prepareRecoveryRestart({
          transactionId: request.transactionId,
          getRequest: async () => ({ ...request, mode: 'client' }),
          getCurrentMode: () => 'client',
          stopServer: async () => undefined,
          clientDataAvailable: () => true,
          checkpointClient: async () => true,
          createServerSnapshot: async () => ({
            snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          }),
          completeRequest: async () => request,
          ...override,
        }),
      ).resolves.toEqual({ status: 'restart-current', failure });
    },
  );

  it('refuses before teardown when this client process has no local stores to test with', async () => {
    const checkpointClient = vi.fn(async () => true);
    const completeRequest = vi.fn(async () => request);

    await expect(
      prepareRecoveryRestart({
        transactionId: request.transactionId,
        getRequest: async () => ({ ...request, mode: 'client' }),
        getCurrentMode: () => 'client',
        stopServer: async () => undefined,
        clientDataAvailable: () => false,
        checkpointClient,
        createServerSnapshot: async () => ({
          snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        }),
        completeRequest,
      }),
    ).resolves.toBe('client-data-unavailable');

    expect(checkpointClient).not.toHaveBeenCalled();
    expect(completeRequest).not.toHaveBeenCalled();
  });
});
