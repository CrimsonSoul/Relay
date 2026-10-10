import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { replaceFileDurably } from '../utils/durableFile';
import { RECOVERY_RESTART_FAILURES } from './RecoveryRestartCoordinator';

const ATTEMPT_FILE = 'update-restart.json';
const MAX_ATTEMPT_BYTES = 4 * 1_024;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

const attemptSchema = z.strictObject({
  transactionId: z.uuidv4(),
  sourceVersion: z.string().regex(VERSION_PATTERN),
  targetVersion: z.string().regex(VERSION_PATTERN),
  targetCommitish: z.string().regex(/^[0-9a-f]{40}$/u),
  failure: z.enum(RECOVERY_RESTART_FAILURES).nullable(),
});

/**
 * The update restart Relay last started, kept in user data so the version that opens next can tell
 * whether the update was applied and, when it was not, why.
 */
export type RecoveryRestartAttempt = z.infer<typeof attemptSchema>;

export async function readRecoveryRestartAttempt(
  userDataRoot: string,
): Promise<RecoveryRestartAttempt | null> {
  const path = join(userDataRoot, ATTEMPT_FILE);
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  try {
    if (contents.length > MAX_ATTEMPT_BYTES) throw new Error('Restart record was too large');
    return attemptSchema.parse(JSON.parse(contents));
  } catch {
    // A torn or foreign record says nothing about the last restart; remove it.
    await rm(path, { force: true }).catch(() => undefined);
    return null;
  }
}

export async function writeRecoveryRestartAttempt(
  userDataRoot: string,
  attempt: RecoveryRestartAttempt | null,
): Promise<void> {
  const path = join(userDataRoot, ATTEMPT_FILE);
  if (!attempt) {
    await rm(path, { force: true });
    return;
  }
  await replaceFileDurably(
    `${path}.${randomUUID()}.tmp`,
    path,
    JSON.stringify(attemptSchema.parse(attempt)),
    { mode: 0o600, exclusive: true },
  );
}
