export type RecoveryLaunchIntent = 'recovery';

const RECOVERY_CENTER_ARGUMENT = '--relay-recovery-center';

export function parseRecoveryLaunchIntent(
  argv: readonly string[] = process.argv,
  platform: NodeJS.Platform = process.platform,
  isPackaged = false,
): RecoveryLaunchIntent | null {
  if (platform !== 'win32' || !isPackaged) return null;
  const matches = argv.filter((argument) => argument === RECOVERY_CENTER_ARGUMENT);
  return matches.length === 1 ? 'recovery' : null;
}

const MANUAL_CHECKPOINT_ARGUMENT = '--relay-manual-update-checkpoint';
const MANUAL_TRANSACTION_PATTERN =
  /^\/relay-transaction=([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;

export function parseManualUpdateCheckpointArgument(
  argv: readonly string[],
  platform: NodeJS.Platform,
  isPackaged: boolean,
): string | null {
  if (platform !== 'win32' || !isPackaged || argv.length !== 3) return null;
  const transactionId = MANUAL_TRANSACTION_PATTERN.exec(argv[2] ?? '')?.[1];
  return argv[1] === MANUAL_CHECKPOINT_ARGUMENT ? (transactionId ?? null) : null;
}
