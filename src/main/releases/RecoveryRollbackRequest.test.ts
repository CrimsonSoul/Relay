import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  completeRecoveryRollbackRequest,
  parseRecoveryRollbackRequest,
  serializeRecoveryRollbackRequest,
  writeRecoveryRollbackRequest,
  type RecoveryRollbackRequest,
} from './RecoveryRollbackRequest';

const roots: string[] = [];

function serverRequest(checkpoint: 'pending' | 'complete'): RecoveryRollbackRequest {
  return {
    protocol: 2,
    transactionId: '11111111-2222-4333-8444-555555555555',
    sourceBuildId: 'r2-current',
    targetBuildId: 'r2-previous',
    mode: 'server',
    checkpoint,
    targetSnapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    sourceSnapshotId: checkpoint === 'complete' ? '99999999-8888-4777-8666-555555555555' : null,
    requestedAt: '2026-08-24T15:10:00.000Z',
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('RecoveryRollbackRequest', () => {
  it('round-trips server and client requests with checkpoint-specific snapshots', () => {
    const pending = serverRequest('pending');
    const complete = serverRequest('complete');
    const client: RecoveryRollbackRequest = {
      ...complete,
      mode: 'client',
      targetSnapshotId: null,
      sourceSnapshotId: null,
    };

    expect(parseRecoveryRollbackRequest(serializeRecoveryRollbackRequest(pending))).toEqual(
      pending,
    );
    expect(parseRecoveryRollbackRequest(serializeRecoveryRollbackRequest(complete))).toEqual(
      complete,
    );
    expect(parseRecoveryRollbackRequest(serializeRecoveryRollbackRequest(client))).toEqual(client);
  });

  it('rejects path-like build ids and snapshot combinations that do not match the mode', () => {
    const valid = serializeRecoveryRollbackRequest(serverRequest('complete'));

    expect(
      parseRecoveryRollbackRequest(valid.replace('targetBuildId=r2-previous', 'targetBuildId=..')),
    ).toBeNull();
    expect(
      parseRecoveryRollbackRequest(
        valid.replace('sourceSnapshotId=99999999-8888-4777-8666-555555555555', ''),
      ),
    ).toBeNull();
    expect(
      parseRecoveryRollbackRequest(valid.replace('mode=server', 'mode=unconfigured')),
    ).toBeNull();
  });

  it('writes atomically only inside the real Recovery directory and completes a matching request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'relay-rollback-request-'));
    roots.push(root);
    const createPrivateDirectory = (path: string) => mkdir(path, { mode: 0o700 });

    const requestPath = await writeRecoveryRollbackRequest(
      root,
      serverRequest('pending'),
      createPrivateDirectory,
    );
    await completeRecoveryRollbackRequest(
      root,
      '11111111-2222-4333-8444-555555555555',
      '99999999-8888-4777-8666-555555555555',
    );

    expect(requestPath).toBe(join(await realpath(root), 'Recovery', 'rollback-request.ini'));
    expect(parseRecoveryRollbackRequest(await readFile(requestPath, 'utf8'))).toEqual(
      serverRequest('complete'),
    );

    const redirectedRoot = await mkdtemp(join(tmpdir(), 'relay-rollback-request-linked-'));
    roots.push(redirectedRoot);
    const outside = await mkdtemp(join(tmpdir(), 'relay-rollback-request-outside-'));
    roots.push(outside);
    await symlink(outside, join(redirectedRoot, 'Recovery'));
    await expect(
      writeRecoveryRollbackRequest(
        redirectedRoot,
        serverRequest('pending'),
        createPrivateDirectory,
      ),
    ).rejects.toThrow(/redirected/i);
  });
});
