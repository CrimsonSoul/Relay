import { describe, expect, it, vi } from 'vitest';
import type { RecoveryUpdateRequest } from './RecoveryUpdateRequest';
import { prepareRecoveryRestart } from './RecoveryRestartCoordinator';

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
        checkpointClient: () => true,
        createServerSnapshot: async () => {
          order.push('snapshot');
          return { snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
        },
        completeRequest,
      }),
    ).resolves.toBe(true);

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
        checkpointClient,
        createServerSnapshot: async () => {
          throw new Error('server snapshot should not run');
        },
        completeRequest,
      }),
    ).resolves.toBe(true);

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
        checkpointClient: () => true,
        createServerSnapshot: async () => ({
          snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        }),
        completeRequest: async () => request,
      }),
    ).resolves.toBe(false);
    expect(stopServer).not.toHaveBeenCalled();
  });
});
