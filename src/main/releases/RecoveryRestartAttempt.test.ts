import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readRecoveryRestartAttempt,
  writeRecoveryRestartAttempt,
  type RecoveryRestartAttempt,
} from './RecoveryRestartAttempt';

const attempt: RecoveryRestartAttempt = {
  transactionId: '11111111-2222-4333-8444-555555555555',
  sourceVersion: '1.14.0',
  targetVersion: '1.15.0',
  targetCommitish: '3'.repeat(40),
  failure: 'snapshot-changed',
};

describe('RecoveryRestartAttempt', () => {
  let userDataRoot: string;

  beforeEach(async () => {
    userDataRoot = await mkdtemp(join(tmpdir(), 'relay-restart-attempt-'));
  });

  afterEach(async () => {
    await rm(userDataRoot, { recursive: true, force: true });
  });

  it('keeps the last update restart until it is cleared', async () => {
    await expect(readRecoveryRestartAttempt(userDataRoot)).resolves.toBeNull();

    await writeRecoveryRestartAttempt(userDataRoot, attempt);
    await expect(readRecoveryRestartAttempt(userDataRoot)).resolves.toEqual(attempt);
    await writeRecoveryRestartAttempt(userDataRoot, { ...attempt, failure: null });
    await expect(readRecoveryRestartAttempt(userDataRoot)).resolves.toEqual({
      ...attempt,
      failure: null,
    });
    await expect(readdir(userDataRoot)).resolves.toEqual(['update-restart.json']);

    await writeRecoveryRestartAttempt(userDataRoot, null);
    await expect(readRecoveryRestartAttempt(userDataRoot)).resolves.toBeNull();
    await expect(readdir(userDataRoot)).resolves.toEqual([]);
  });

  it.each([
    ['damaged', '{"transactionId":'],
    ['unknown failure', JSON.stringify({ ...attempt, failure: 'something-else' })],
    ['extra field', JSON.stringify({ ...attempt, note: 'unexpected' })],
    ['oversized', JSON.stringify({ ...attempt, padding: 'x'.repeat(5_000) })],
  ])('ignores and removes a %s record', async (_label, contents) => {
    await writeFile(join(userDataRoot, 'update-restart.json'), contents);
    await expect(readRecoveryRestartAttempt(userDataRoot)).resolves.toBeNull();
    await expect(readdir(userDataRoot)).resolves.toEqual([]);
  });

  it('refuses to save an invalid record', async () => {
    await expect(
      writeRecoveryRestartAttempt(userDataRoot, { ...attempt, targetVersion: 'v1.15.0' }),
    ).rejects.toThrow();
    await expect(readdir(userDataRoot)).resolves.toEqual([]);
  });
});
