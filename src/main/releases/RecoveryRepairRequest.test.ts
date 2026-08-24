import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseRecoveryRepairReceipt,
  parseRecoveryRepairRequest,
  readRecoveryRepairReceipt,
  serializeRecoveryRepairReceipt,
  serializeRecoveryRepairRequest,
  writeRecoveryRepairRequest,
  type RecoveryRepairReceipt,
  type RecoveryRepairRequest,
} from './RecoveryRepairRequest';

const roots: string[] = [];

const REQUEST: RecoveryRepairRequest = {
  protocol: 2,
  transactionId: '11111111-2222-4333-8444-555555555555',
  sourceBuildId: `r2-${'1'.repeat(40)}`,
  targetBuildId: `r2-${'2'.repeat(40)}`,
  targetVersion: '1.5.0',
  targetCommitish: '2'.repeat(40),
  targetInstallerSha256: 'a'.repeat(64),
  checkpoint: 'pending',
  requestedAt: '2026-08-24T15:10:00.000Z',
};

const RECEIPT: RecoveryRepairReceipt = {
  protocol: 2,
  transactionId: REQUEST.transactionId,
  buildId: REQUEST.targetBuildId,
  version: REQUEST.targetVersion,
  targetCommitish: REQUEST.targetCommitish,
  runtimeSha512: 'b'.repeat(128),
  installerSha256: REQUEST.targetInstallerSha256,
  completedAt: '2026-08-24T15:11:00.000Z',
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('RecoveryRepairRequest', () => {
  it('round-trips a strictly bounded request and native completion receipt', () => {
    expect(parseRecoveryRepairRequest(serializeRecoveryRepairRequest(REQUEST))).toEqual(REQUEST);
    expect(parseRecoveryRepairReceipt(serializeRecoveryRepairReceipt(RECEIPT))).toEqual(RECEIPT);
  });

  it.each([
    ['a path-like build id', 'targetBuildId=..'],
    ['a mutable commit identity', 'targetCommitish=main'],
    ['a shortened installer digest', `targetInstallerSha256=${'a'.repeat(63)}`],
    ['a noncanonical checkpoint', 'checkpoint=complete'],
  ])('rejects %s', (_label, replacement) => {
    const key = replacement.slice(0, replacement.indexOf('='));
    const damaged = serializeRecoveryRepairRequest(REQUEST).replace(
      new RegExp(`${key}=[^\\r\\n]*`, 'u'),
      replacement,
    );
    expect(parseRecoveryRepairRequest(damaged)).toBeNull();
  });

  it('writes only inside a real private Recovery directory and reads a safe receipt', async () => {
    const relayRoot = await mkdtemp(join(tmpdir(), 'relay-repair-request-'));
    roots.push(relayRoot);
    const requestPath = await writeRecoveryRepairRequest(relayRoot, REQUEST, (path) =>
      mkdir(path, { mode: 0o700 }),
    );
    expect(requestPath).toBe(join(await realpath(relayRoot), 'Recovery', 'repair-request.ini'));
    expect(parseRecoveryRepairRequest(await readFile(requestPath, 'utf8'))).toEqual(REQUEST);

    const receiptPath = join(relayRoot, 'Recovery', 'repair-result.ini');
    await writeFile(receiptPath, serializeRecoveryRepairReceipt(RECEIPT), { mode: 0o600 });
    await expect(readRecoveryRepairReceipt(relayRoot)).resolves.toEqual(RECEIPT);
  });

  it('refuses a redirected Recovery directory or receipt', async () => {
    const relayRoot = await mkdtemp(join(tmpdir(), 'relay-repair-request-linked-'));
    const outside = await mkdtemp(join(tmpdir(), 'relay-repair-request-outside-'));
    roots.push(relayRoot, outside);
    await symlink(outside, join(relayRoot, 'Recovery'));
    await expect(
      writeRecoveryRepairRequest(relayRoot, REQUEST, (path) => mkdir(path)),
    ).rejects.toThrow(/redirected/i);

    await rm(join(relayRoot, 'Recovery'));
    await mkdir(join(relayRoot, 'Recovery'));
    const outsideReceipt = join(outside, 'receipt.ini');
    await writeFile(outsideReceipt, serializeRecoveryRepairReceipt(RECEIPT));
    await symlink(outsideReceipt, join(relayRoot, 'Recovery', 'repair-result.ini'));
    await expect(readRecoveryRepairReceipt(relayRoot)).rejects.toThrow(/redirected/i);
  });
});
